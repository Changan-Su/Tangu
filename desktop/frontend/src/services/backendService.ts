/**
 * M3 数据 API 薄封装(sessions/models/memory/skills/tools/workspace)。
 * 统一 Bearer + JSON 错误,错误信息抛 Error(detail)。
 */
import type {
  AgentConfig, MessageRecord, ModelsResponse, SessionRecord, SkillInfo,
  TanguDesktopConfig, ToolsResponse, WorkspaceFileMeta,
} from '../types'

function headers(token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

async function request<T>(cfg: TanguDesktopConfig, path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${cfg.backendUrl}${path}`, { ...init, headers: headers(cfg.token) })
  if (!r.ok) {
    let detail = `HTTP ${r.status}`
    try { detail = (await r.json())?.detail || detail } catch { /* keep */ }
    throw new Error(detail)
  }
  return r.json() as Promise<T>
}

// ── 会话 ──
export const listSessions = (cfg: TanguDesktopConfig, archived = false) =>
  request<{ sessions: SessionRecord[] }>(cfg, `/agent/sessions?archived=${archived}`).then((r) => r.sessions)

export const createSession = (cfg: TanguDesktopConfig, init?: { title?: string; model_id?: string; emoji?: string }) =>
  request<{ session: SessionRecord }>(cfg, '/agent/sessions', {
    method: 'POST',
    body: JSON.stringify(init || {}),
  }).then((r) => r.session)

export const updateSession = (
  cfg: TanguDesktopConfig,
  id: string,
  patch: { title?: string; archived?: boolean; model_id?: string; emoji?: string | null },
) =>
  request<{ session: SessionRecord }>(cfg, `/agent/sessions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  }).then((r) => r.session)

export const deleteSession = (cfg: TanguDesktopConfig, id: string) =>
  request<{ ok: boolean }>(cfg, `/agent/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })

export const listMessages = (cfg: TanguDesktopConfig, sessionId: string, limit = 200) =>
  request<{ messages: MessageRecord[] }>(
    cfg, `/agent/sessions/${encodeURIComponent(sessionId)}/messages?limit=${limit}`,
  ).then((r) => r.messages)

export const getSessionConfig = (cfg: TanguDesktopConfig, sessionId: string) =>
  request<{ agent_config: AgentConfig }>(
    cfg, `/agent/sessions/${encodeURIComponent(sessionId)}/config`,
  ).then((r) => r.agent_config || {})

export const putSessionConfig = (cfg: TanguDesktopConfig, sessionId: string, config: AgentConfig) =>
  request<{ agent_config: AgentConfig }>(cfg, `/agent/sessions/${encodeURIComponent(sessionId)}/config`, {
    method: 'PUT',
    body: JSON.stringify(config),
  }).then((r) => r.agent_config)

// ── 模型 / 技能 / 工具 ──
export const listModels = (cfg: TanguDesktopConfig) => request<ModelsResponse>(cfg, '/agent/models')

export const listSkills = (cfg: TanguDesktopConfig) =>
  request<{ skills: SkillInfo[] }>(cfg, '/agent/skills').then((r) => r.skills)

export const listTools = (cfg: TanguDesktopConfig) => request<ToolsResponse>(cfg, '/agent/tools')

// ── 记忆 / 日志 ──
export const getMemory = (cfg: TanguDesktopConfig) =>
  request<{ content: string; updatedAt: any }>(cfg, '/agent/memory')

export const appendMemory = (cfg: TanguDesktopConfig, text: string) =>
  request<{ appended: boolean; reason?: string }>(cfg, '/agent/memory', {
    method: 'POST',
    body: JSON.stringify({ text }),
  })

export const getLog = (cfg: TanguDesktopConfig, date?: string) =>
  request<{ date: string; content: string; updatedAt: any }>(
    cfg, `/agent/log${date ? `?date=${encodeURIComponent(date)}` : ''}`,
  )

export const appendLog = (cfg: TanguDesktopConfig, text: string) =>
  request<{ date: string; time: string }>(cfg, '/agent/log', {
    method: 'POST',
    body: JSON.stringify({ text }),
  })

// ── 工作区 ──
export const listWorkspace = (cfg: TanguDesktopConfig, sessionId: string) =>
  request<{ files: WorkspaceFileMeta[] }>(
    cfg, `/agent/workspace/list?sessionId=${encodeURIComponent(sessionId)}`,
  ).then((r) => r.files)

export const readWorkspaceFile = (cfg: TanguDesktopConfig, sessionId: string, path: string) =>
  request<{ path: string; mimeType: string; content: string; encoding: 'base64'; size: number }>(
    cfg, `/agent/workspace/read?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`,
  )

export const workspaceDownloadUrl = (cfg: TanguDesktopConfig, sessionId: string, path: string) =>
  `${cfg.backendUrl}/agent/workspace/download?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`

/** 下载工作区文件(fetch 带 Bearer → blob → 触发保存)。 */
export async function downloadWorkspaceFile(cfg: TanguDesktopConfig, sessionId: string, path: string): Promise<void> {
  const r = await fetch(workspaceDownloadUrl(cfg, sessionId, path), { headers: headers(cfg.token) })
  if (!r.ok) throw new Error(`下载失败 (${r.status})`)
  const blob = await r.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = path.split('/').filter(Boolean).pop() || 'file'
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

export const uploadWorkspaceFiles = (
  cfg: TanguDesktopConfig,
  sessionId: string,
  files: Array<{ path: string; content: string; encoding?: 'base64'; mimeType?: string }>,
) =>
  request<{ success: boolean; saved: number; total: number; errors: string[] }>(cfg, '/agent/workspace/upload', {
    method: 'POST',
    body: JSON.stringify({ sessionId, files }),
  })

export const deleteWorkspaceFile = (cfg: TanguDesktopConfig, sessionId: string, path: string) =>
  request<{ ok: boolean }>(cfg, '/agent/workspace/delete', {
    method: 'POST',
    body: JSON.stringify({ sessionId, path }),
  })
