/**
 * 右侧面板:工作区文件 / 技能·工具 / 记忆·日志 三个 tab(对标 openhanako Desk 的右栏形态)。
 */
import React, { useCallback, useEffect, useState } from 'react'
import {
  FolderOpen, Wrench, BookOpen, Download, Trash2, Upload, RefreshCw, FileText, Image as ImageIcon, Loader2,
} from 'lucide-react'
import type { AgentConfig, SkillInfo, TanguDesktopConfig, ToolsResponse, WorkspaceFileMeta } from '../types'
import * as api from '../services/backendService'
import { Markdown } from './Markdown'

type Tab = 'workspace' | 'assets' | 'memory'

export const RightPanel: React.FC<{
  cfg: TanguDesktopConfig
  sessionId: string
  sessionConfig: AgentConfig
  running: boolean
  onConfigChange: (c: AgentConfig) => void
  onToast: (text: string, error?: boolean) => void
}> = (p) => {
  const [tab, setTab] = useState<Tab>('workspace')
  return (
    <aside className="right-panel">
      <div className="right-panel-tabs">
        <button className={tab === 'workspace' ? 'active' : ''} onClick={() => setTab('workspace')}>
          <FolderOpen size={13} /> 工作区
        </button>
        <button className={tab === 'assets' ? 'active' : ''} onClick={() => setTab('assets')}>
          <Wrench size={13} /> 技能·工具
        </button>
        <button className={tab === 'memory' ? 'active' : ''} onClick={() => setTab('memory')}>
          <BookOpen size={13} /> 记忆
        </button>
      </div>
      <div className="right-panel-body">
        {tab === 'workspace' && <WorkspaceTab {...p} />}
        {tab === 'assets' && <AssetsTab {...p} />}
        {tab === 'memory' && <MemoryTab {...p} />}
      </div>
    </aside>
  )
}

// ── 工作区 ──────────────────────────────────────────────────────────────────

const WorkspaceTab: React.FC<{
  cfg: TanguDesktopConfig
  sessionId: string
  running: boolean
  onToast: (t: string, e?: boolean) => void
}> = ({ cfg, sessionId, running, onToast }) => {
  const [files, setFiles] = useState<WorkspaceFileMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<{ path: string; mimeType: string; content: string } | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setFiles(await api.listWorkspace(cfg, sessionId))
    } catch (e: any) {
      onToast(`工作区加载失败:${e?.message || e}`, true)
    } finally {
      setLoading(false)
    }
  }, [cfg, sessionId, onToast])

  useEffect(() => {
    void refresh()
  }, [refresh, running]) // run 结束(running 变化)后刷新,看到新产物

  const open = async (f: WorkspaceFileMeta) => {
    try {
      const r = await api.readWorkspaceFile(cfg, sessionId, f.path)
      setPreview({ path: f.path, mimeType: r.mimeType, content: r.content })
    } catch (e: any) {
      onToast(`读取失败:${e?.message || e}`, true)
    }
  }

  const upload = async (list: FileList | null) => {
    if (!list?.length) return
    const payload = await Promise.all(
      Array.from(list).map(async (f) => {
        const buf = new Uint8Array(await f.arrayBuffer())
        let bin = ''
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
        return { path: f.name, content: btoa(bin), encoding: 'base64' as const, mimeType: f.type }
      }),
    )
    try {
      const r = await api.uploadWorkspaceFiles(cfg, sessionId, payload)
      onToast(`已上传 ${r.saved}/${r.total} 个文件`)
      void refresh()
    } catch (e: any) {
      onToast(`上传失败:${e?.message || e}`, true)
    }
  }

  const isText = (m: string) => m.startsWith('text/') || /json|xml|javascript|csv/.test(m)
  const isImage = (m: string) => m.startsWith('image/')

  if (preview) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <button className="btn ghost sm" onClick={() => setPreview(null)}>← 返回</button>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {preview.path}
          </span>
        </div>
        {isImage(preview.mimeType) ? (
          <img src={`data:${preview.mimeType};base64,${preview.content}`} style={{ maxWidth: '100%', borderRadius: 'var(--radius-md)' }} />
        ) : isText(preview.mimeType) ? (
          <pre style={{
            fontSize: 11.5, fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            background: 'var(--bg-card)', border: 'var(--border-width) solid var(--border)',
            borderRadius: 'var(--radius-md)', padding: 10, maxHeight: '70vh', overflowY: 'auto',
          }}>
            {safeAtobUtf8(preview.content)}
          </pre>
        ) : (
          <div className="panel-note">二进制文件,请下载查看。</div>
        )}
      </div>
    )
  }

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        void upload(e.dataTransfer.files)
      }}
    >
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        <span className="panel-section-title" style={{ flex: 1, padding: 0 }}>会话文件</span>
        <label className="icon-btn" style={{ width: 24, height: 24 }} title="上传文件">
          <Upload size={13} />
          <input type="file" multiple hidden onChange={(e) => { void upload(e.target.files); e.target.value = '' }} />
        </label>
        <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => void refresh()} title="刷新">
          {loading ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
        </button>
      </div>
      {files.length === 0 && <div className="panel-note">暂无文件。agent 产出与拖入的文件都会出现在这里。</div>}
      {files.map((f) => (
        <div className="file-row" key={f.path} onClick={() => void open(f)} role="button" tabIndex={0}>
          {f.mimeType.startsWith('image/') ? <ImageIcon size={13} /> : <FileText size={13} />}
          <span className="file-name">{f.path.replace(/^\//, '')}</span>
          <span className="file-size">{fmtSize(f.size)}</span>
          <span className="file-act">
            <button
              className="icon-btn"
              style={{ width: 22, height: 22 }}
              title="下载"
              onClick={(e) => {
                e.stopPropagation()
                void api.downloadWorkspaceFile(cfg, sessionId, f.path).catch((err) => onToast(err.message, true))
              }}
            >
              <Download size={12} />
            </button>
            <button
              className="icon-btn"
              style={{ width: 22, height: 22 }}
              title="删除"
              onClick={(e) => {
                e.stopPropagation()
                void api.deleteWorkspaceFile(cfg, sessionId, f.path).then(() => refresh()).catch((err) => onToast(err.message, true))
              }}
            >
              <Trash2 size={12} />
            </button>
          </span>
        </div>
      ))}
    </div>
  )
}

// ── 技能·工具 ────────────────────────────────────────────────────────────────

const AssetsTab: React.FC<{
  cfg: TanguDesktopConfig
  sessionConfig: AgentConfig
  onConfigChange: (c: AgentConfig) => void
  onToast: (t: string, e?: boolean) => void
}> = ({ cfg, sessionConfig, onConfigChange, onToast }) => {
  const [skills, setSkills] = useState<SkillInfo[] | null>(null)
  const [tools, setTools] = useState<ToolsResponse | null>(null)

  useEffect(() => {
    void api.listSkills(cfg).then(setSkills).catch(() => setSkills([]))
    void api.listTools(cfg).then(setTools).catch((e) => onToast(`工具列表加载失败:${e?.message || e}`, true))
  }, [cfg, onToast])

  const enabledSkills = new Set(sessionConfig.enabledSkillIds || [])
  const enabledTools = new Set(sessionConfig.enabledToolIds || [])

  const toggleSkill = (id: string) => {
    const next = new Set(enabledSkills)
    next.has(id) ? next.delete(id) : next.add(id)
    onConfigChange({ ...sessionConfig, enabledSkillIds: [...next] })
  }
  const toggleTool = (id: string) => {
    const next = new Set(enabledTools)
    next.has(id) ? next.delete(id) : next.add(id)
    onConfigChange({ ...sessionConfig, enabledToolIds: [...next] })
  }

  return (
    <div>
      <div className="panel-section-title">技能(本会话启用)</div>
      {skills === null && <div className="panel-note">加载中…</div>}
      {skills?.length === 0 && <div className="panel-note">云端暂无可用技能目录(需要云端 brain-api 支持)。</div>}
      {skills?.map((s) => (
        <label className="check-row" key={s.id}>
          <input type="checkbox" checked={enabledSkills.has(s.id)} onChange={() => toggleSkill(s.id)} />
          <span>
            <div className="check-name">{s.icon ? `${s.icon} ` : ''}{s.name}</div>
            {s.description && <div className="check-desc">{s.description}</div>}
          </span>
        </label>
      ))}

      <div className="panel-section-title" style={{ marginTop: 10 }}>自定义工具</div>
      {tools?.custom.length === 0 && <div className="panel-note">无自定义工具。</div>}
      {tools?.custom.map((t) => (
        <label className="check-row" key={t.id}>
          <input type="checkbox" checked={enabledTools.has(t.id)} onChange={() => toggleTool(t.id)} />
          <span>
            <div className="check-name">{t.name} <span style={{ color: 'var(--text-ghost)', fontSize: 11 }}>({t.executor})</span></div>
            {t.description && <div className="check-desc">{t.description}</div>}
          </span>
        </label>
      ))}

      <div className="panel-section-title" style={{ marginTop: 10 }}>内置工具(随执行环境自动可用)</div>
      {tools?.builtins.map((t) => (
        <div className="check-row" key={t.name} style={{ cursor: 'default' }}>
          <span style={{ width: 13 }} />
          <span>
            <div className="check-name" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              {t.name}
              <span style={{ color: 'var(--text-ghost)', fontSize: 10.5, marginLeft: 5 }}>
                {t.mode === 'sandbox' ? '云沙箱' : t.mode === 'host' ? '本机' : ''}
              </span>
            </div>
          </span>
        </div>
      ))}
    </div>
  )
}

// ── 记忆·日志 ────────────────────────────────────────────────────────────────

const MemoryTab: React.FC<{
  cfg: TanguDesktopConfig
  onToast: (t: string, e?: boolean) => void
}> = ({ cfg, onToast }) => {
  const [memory, setMemory] = useState<string | null>(null)
  const [log, setLog] = useState<{ date: string; content: string } | null>(null)
  const [logDate, setLogDate] = useState('')
  const [draft, setDraft] = useState('')

  const refresh = useCallback(async () => {
    try {
      const m = await api.getMemory(cfg)
      setMemory(m.content || '')
    } catch (e: any) {
      setMemory(null)
      onToast(`记忆加载失败:${e?.message || e}`, true)
    }
    try {
      const l = await api.getLog(cfg, logDate || undefined)
      setLog({ date: l.date, content: l.content || '' })
    } catch { /* log 可选 */ }
  }, [cfg, logDate, onToast])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const append = async () => {
    const text = draft.trim()
    if (!text) return
    try {
      const r = await api.appendMemory(cfg, text)
      onToast(r.appended ? '已记入长期记忆' : '未写入(重复或已满)')
      setDraft('')
      void refresh()
    } catch (e: any) {
      onToast(`写入失败:${e?.message || e}`, true)
    }
  }

  return (
    <div>
      <div className="panel-section-title">长期记忆</div>
      {memory === null && <div className="panel-note">(未连接云端大脑)</div>}
      {memory !== null && (
        memory ? (
          <div style={{ fontSize: 12.5, padding: '0 8px' }} className="msg-content">
            <Markdown content={memory} />
          </div>
        ) : (
          <div className="panel-note">还没有记忆。对话中说「记住…」或在下方手动追加。</div>
        )
      )}
      <div style={{ display: 'flex', gap: 6, padding: '8px 8px 0' }}>
        <input
          type="text"
          value={draft}
          placeholder="追加一条记忆…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void append()}
          style={{
            flex: 1, fontSize: 12.5, padding: '5px 8px', background: 'var(--bg-card)',
            border: 'var(--border-width) solid var(--border)', borderRadius: 'var(--radius-sm)', outline: 'none',
          }}
        />
        <button className="btn ghost sm" onClick={() => void append()}>追加</button>
      </div>

      <div className="panel-section-title" style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
        活动日志
        <input
          type="date"
          value={logDate}
          onChange={(e) => setLogDate(e.target.value)}
          style={{
            fontSize: 11, background: 'var(--bg-card)', color: 'var(--text-muted)',
            border: 'var(--border-width) solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '1px 4px',
          }}
        />
      </div>
      {log && (
        log.content ? (
          <div style={{ fontSize: 12.5, padding: '0 8px' }} className="msg-content">
            <Markdown content={log.content} />
          </div>
        ) : (
          <div className="panel-note">({log.date} 暂无日志)</div>
        )
      )}
    </div>
  )
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** base64 → UTF-8 文本(atob 直接转会乱码)。 */
function safeAtobUtf8(b64: string): string {
  try {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new TextDecoder().decode(bytes)
  } catch {
    return '(解码失败)'
  }
}
