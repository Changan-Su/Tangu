/** standalone /agent 契约的前端类型(与包内 routes/eventBus 一致)。 */

export interface TanguDesktopConfig {
  backendUrl: string
  token: string
  modelId: string
}

export interface StartRunResult {
  runId: string
  assistantMessageId: string
  userMessageId: string
}

/** SSE 事件:{ seq, type, payload }。type ∈ token/reasoning/tool_call/tool_result/tool_stream/status/usage/approval_request/approval_result/done/error。 */
export interface AgentRunEvent {
  seq: number
  type: string
  payload?: any
}

// ── M3 数据 API 形状 ──────────────────────────────────────────────────────────

export interface SessionRecord {
  id: string
  title: string | null
  model_id: string | null
  archived: boolean
  emoji: string | null
  agent_config: AgentConfig | null
  created_at: string
  updated_at: string
}

export interface AgentConfig {
  systemPrompt?: string
  maxIterations?: number
  thinkingLevel?: 'off' | 'low' | 'medium' | 'high'
  enabledSkillIds?: string[]
  enabledToolIds?: string[]
  execMode?: 'sandbox' | 'host'
  cwd?: string
  approvalMode?: 'readonly' | 'auto-edit' | 'full-auto'
}

export interface MessageRecord {
  id: string
  role: 'user' | 'model' | 'assistant' | string
  content: string | null
  reasoning: string | null
  tool_calls: any[] | null
  tool_results: any[] | null
  attachments: any[] | null
  timestamp: number
  model_id: string | null
  is_error: boolean
}

export interface ModelInfo {
  id: string
  name: string
  provider: string
  source: 'forsion' | 'direct'
}

export interface ModelsResponse {
  models: ModelInfo[]
  directProviders: Array<{ providerId: string; modelIds?: string[] }>
  defaultModelId: string | null
  /** 云端托管面诊断:empty=可达但 admin 没配模型;error=不可达/未授权/未部署 brain-api。 */
  forsion?: { status: 'ok' | 'empty' | 'error'; detail: string | null }
}

export interface SkillInfo {
  id: string
  name: string
  description: string
  icon: string | null
  category: string | null
}

export interface ToolsResponse {
  builtins: Array<{ name: string; description: string; mode: 'sandbox' | 'host' | 'both' }>
  custom: Array<{ id: string; name: string; description: string; executor: string }>
}

export interface WorkspaceFileMeta {
  path: string
  size: number
  mimeType: string
  updatedAt: number
}

export interface Attachment {
  name: string
  mimeType: string
  /** base64(无 dataURL 前缀) */
  data: string
  size: number
}

// ── 聊天流 UI 模型(由历史 + SSE 事件归约) ─────────────────────────────────────

export interface ToolEvent {
  id: string
  name: string
  arguments?: string
  result?: string
  isError?: boolean
  done: boolean
}

export interface ApprovalRequest {
  approvalId: string
  runId: string
  name: string
  arguments?: string
  preview: string
  status: 'pending' | 'approved' | 'rejected' | 'expired'
}

export interface UiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  toolEvents?: ToolEvent[]
  approvals?: ApprovalRequest[]
  attachments?: Attachment[]
  status?: 'streaming' | 'done' | 'error'
  error?: string
  timestamp: number
}

// ── Electron 托管后端(managed 模式) ──────────────────────────────────────────

export interface BackendStatusInfo {
  state: 'stopped' | 'starting' | 'ready' | 'crashed'
  url: string | null
  pid: number | null
  lastError: string | null
  /** dev:dist 重建于子进程启动之后 → 跑的是旧代码,需重启后端。 */
  staleDist?: boolean
}

/** 主进程持久化的完整配置;getConfig 返回时 backendUrl/token 已折算为有效值(managed 就绪=托管子进程的)。 */
export interface StoredDesktopConfig extends TanguDesktopConfig {
  mode: 'managed' | 'external'
  cloudUrl: string
  cloudToken: string
  sandbox: 'auto' | 'docker' | 'none'
  backendState?: BackendStatusInfo
  /** 主进程附带的用户主目录(本机模式 cwd 兜底)。 */
  homeDir?: string
}

export interface AuthStatusInfo {
  loggedIn: boolean
  cloudUrl: string
  username: string | null
  tokenSource: 'config' | 'tangu-login' | null
}

/** preload 注入的 window.tangu(浏览器内调试时缺省,backend/auth 能力按需探测)。 */
declare global {
  interface Window {
    tangu?: {
      getConfig(): Promise<StoredDesktopConfig>
      setConfig(patch: Partial<StoredDesktopConfig>): Promise<StoredDesktopConfig>
      backendStatus?(): Promise<BackendStatusInfo>
      backendLogs?(): Promise<string[]>
      backendRestart?(): Promise<BackendStatusInfo>
      onBackendStatus?(cb: (st: BackendStatusInfo) => void): () => void
      authStatus?(): Promise<AuthStatusInfo>
      forsionLogin?(cloudUrl?: string): Promise<{ ok: boolean; cloudUrl: string }>
      forsionLogout?(): Promise<{ ok: boolean }>
      authProviders?(): Promise<Array<{ id: string; loggedIn: boolean }>>
      providerLogin?(id: string): Promise<{ ok: boolean; id: string }>
      onAuthDevice?(cb: (info: { url: string; userCode: string }) => void): () => void
      pickDirectory?(): Promise<string | null>
    }
  }
}
