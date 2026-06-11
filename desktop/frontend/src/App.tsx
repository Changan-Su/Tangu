/**
 * Tangu Desktop 应用壳:侧栏(多会话)+ 聊天流 + 输入区 + 设置 + 右侧面板。
 * run 流式:startRun → SSE 归约进对应 assistant 消息(后台会话照常跑,完成标未读)。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AgentConfig, AgentRunEvent, Attachment, ModelsResponse, SessionRecord, TanguDesktopConfig, UiMessage,
} from './types'
import * as api from './services/backendService'
import { abortRun, listActiveRuns, resolveApproval, startRun, subscribeRunEvents, testConnection } from './services/agentRunService'
import { Sidebar } from './components/Sidebar'
import { ChatHeader } from './components/ChatHeader'
import { ChatArea } from './components/ChatArea'
import { MessageInput } from './components/MessageInput'
import { SettingsModal } from './components/SettingsModal'
import { RightPanel } from './components/RightPanel'
import { ProjectPicker, type ProjectChoice } from './components/ProjectPicker'
import { OnboardingWizard, ONBOARDING_DISMISS_KEY } from './components/OnboardingWizard'
import { resolveInitialMode, resolveInitialPreset } from './theme/registry'

const UNREAD_KEY = 'forsion_tangu_unread_sessions'

function loadUnread(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(UNREAD_KEY) || '[]')) } catch { return new Set() }
}
function saveUnread(s: Set<string>): void {
  try { localStorage.setItem(UNREAD_KEY, JSON.stringify([...s])) } catch { /* ignore */ }
}

/** 历史行 → UI 消息(tool_calls/tool_results 配对成 toolEvents)。 */
function recordToUi(r: any): UiMessage {
  const role = r.role === 'model' || r.role === 'assistant' ? 'assistant' : 'user'
  const msg: UiMessage = {
    id: r.id,
    role,
    content: r.content || '',
    reasoning: r.reasoning || undefined,
    attachments: r.attachments || undefined,
    status: 'done',
    timestamp: Number(r.timestamp) || 0,
  }
  if (role === 'assistant' && Array.isArray(r.tool_calls) && r.tool_calls.length) {
    const results = new Map<string, any>(
      (Array.isArray(r.tool_results) ? r.tool_results : []).map((t: any) => [t.tool_call_id, t]),
    )
    msg.toolEvents = r.tool_calls.map((c: any) => {
      const res = results.get(c.id)
      return {
        id: c.id,
        name: c.function?.name || c.name || 'tool',
        arguments: c.function?.arguments,
        result: res ? String(res.content ?? '') : undefined,
        isError: res?.isError || false,
        done: true,
      }
    })
  }
  if (r.is_error) msg.status = 'error'
  return msg
}

export function App(): React.JSX.Element {
  const [cfg, setCfg] = useState<TanguDesktopConfig>({ backendUrl: 'http://localhost:8787', token: '', modelId: '' })
  const [cfgLoaded, setCfgLoaded] = useState(false)
  const [connState, setConnState] = useState<'idle' | 'ok' | 'err'>('idle')
  const [connMessage, setConnMessage] = useState('')
  // managed(本机托管)后端 → 新会话默认本机执行(与 TUI 对齐);homeDir 作 cwd 兜底。
  const desktopMode = useRef<'managed' | 'external' | null>(null)
  const homeDirRef = useRef<string | undefined>(undefined)

  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [archivedSessions, setArchivedSessions] = useState<SessionRecord[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [modelsResp, setModelsResp] = useState<ModelsResponse | null>(null)
  const [messagesBySession, setMessagesBySession] = useState<Record<string, UiMessage[]>>({})
  const [configBySession, setConfigBySession] = useState<Record<string, AgentConfig>>({})
  const [runningBySession, setRunningBySession] = useState<Record<string, string>>({})
  const [unread, setUnread] = useState<Set<string>>(loadUnread)

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [rightOpen, setRightOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)
  const [onboarding, setOnboarding] = useState(false)
  const [themePreset, setThemePreset] = useState(resolveInitialPreset)
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>(resolveInitialMode)
  const [glassOn, setGlassOn] = useState(() => {
    try { return localStorage.getItem('forsion_glass') !== 'off' } catch { return true }
  })
  const [toasts, setToasts] = useState<Array<{ id: number; text: string; error?: boolean }>>([])

  const cfgRef = useRef(cfg)
  cfgRef.current = cfg
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId
  const runAborts = useRef(new Map<string, AbortController>())
  const subscribedRuns = useRef(new Set<string>())
  const loadedHistory = useRef(new Set<string>())

  const toast = useCallback((text: string, error = false) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text, error }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200)
  }, [])

  // ── 消息更新助手 ──
  const patchMessage = useCallback((sessionId: string, messageId: string, fn: (m: UiMessage) => UiMessage) => {
    setMessagesBySession((prev) => {
      const list = prev[sessionId]
      if (!list) return prev
      const i = list.findIndex((m) => m.id === messageId)
      if (i < 0) return prev
      const next = list.slice()
      next[i] = fn(next[i])
      return { ...prev, [sessionId]: next }
    })
  }, [])

  const endRun = useCallback((sessionId: string, runId: string) => {
    runAborts.current.delete(runId)
    subscribedRuns.current.delete(runId)
    setRunningBySession((prev) => {
      if (prev[sessionId] !== runId) return prev
      const next = { ...prev }
      delete next[sessionId]
      return next
    })
    if (activeIdRef.current !== sessionId) {
      setUnread((prev) => {
        const next = new Set(prev)
        next.add(sessionId)
        saveUnread(next)
        return next
      })
    }
  }, [])

  // ── SSE 事件归约 ──
  const reduceEvent = useCallback((sessionId: string, runId: string, assistantId: string, ev: AgentRunEvent) => {
    const pl = ev.payload || {}
    switch (ev.type) {
      case 'token':
        patchMessage(sessionId, assistantId, (m) => ({ ...m, content: m.content + (pl.delta || '') }))
        break
      case 'reasoning':
        patchMessage(sessionId, assistantId, (m) => ({ ...m, reasoning: (m.reasoning || '') + (pl.delta || '') }))
        break
      case 'tool_stream':
        patchMessage(sessionId, assistantId, (m) => {
          const evs = (m.toolEvents || []).slice()
          const i = evs.findIndex((t) => t.id === pl.id)
          if (i >= 0) evs[i] = { ...evs[i], arguments: (evs[i].arguments || '') + (pl.delta || '') }
          else evs.push({ id: pl.id, name: pl.name || 'tool', arguments: pl.delta || '', done: false })
          return { ...m, toolEvents: evs }
        })
        break
      case 'tool_call':
        patchMessage(sessionId, assistantId, (m) => {
          const evs = (m.toolEvents || []).slice()
          const i = evs.findIndex((t) => t.id === pl.id)
          const item = { id: pl.id, name: pl.name, arguments: pl.arguments, done: false }
          if (i >= 0) evs[i] = { ...evs[i], ...item }
          else evs.push(item)
          return { ...m, toolEvents: evs }
        })
        break
      case 'tool_result':
        patchMessage(sessionId, assistantId, (m) => {
          const evs = (m.toolEvents || []).slice()
          const i = evs.findIndex((t) => t.id === pl.id)
          if (i >= 0) evs[i] = { ...evs[i], result: String(pl.result ?? ''), isError: !!pl.isError, done: true }
          return { ...m, toolEvents: evs }
        })
        break
      case 'approval_request':
        patchMessage(sessionId, assistantId, (m) => ({
          ...m,
          approvals: [
            ...(m.approvals || []),
            {
              approvalId: pl.approvalId, runId, name: pl.name,
              arguments: pl.arguments, preview: pl.preview || '', status: 'pending' as const,
            },
          ],
        }))
        break
      case 'approval_result':
        patchMessage(sessionId, assistantId, (m) => ({
          ...m,
          approvals: (m.approvals || []).map((a) =>
            a.approvalId === pl.approvalId
              ? { ...a, status: pl.action === 'reject' ? ('rejected' as const) : ('approved' as const) }
              : a,
          ),
        }))
        break
      case 'done':
        patchMessage(sessionId, assistantId, (m) => ({
          ...m,
          content: pl.content || m.content,
          status: 'done' as const,
          approvals: (m.approvals || []).map((a) => (a.status === 'pending' ? { ...a, status: 'expired' as const } : a)),
        }))
        endRun(sessionId, runId)
        break
      case 'error':
        patchMessage(sessionId, assistantId, (m) => ({
          ...m,
          status: 'error' as const,
          error: pl.error || 'error',
          approvals: (m.approvals || []).map((a) => (a.status === 'pending' ? { ...a, status: 'expired' as const } : a)),
        }))
        endRun(sessionId, runId)
        break
      default:
        break
    }
  }, [patchMessage, endRun])

  const subscribeRun = useCallback(
    (sessionId: string, runId: string, assistantId: string) => {
      if (subscribedRuns.current.has(runId)) return
      subscribedRuns.current.add(runId)
      const ac = new AbortController()
      runAborts.current.set(runId, ac)
      setRunningBySession((prev) => ({ ...prev, [sessionId]: runId }))
      void subscribeRunEvents(cfgRef.current, runId, (ev) => reduceEvent(sessionId, runId, assistantId, ev), ac.signal)
        .catch((e) => {
          patchMessage(sessionId, assistantId, (m) => ({ ...m, status: 'error', error: e?.message || '事件流中断' }))
          endRun(sessionId, runId)
        })
    },
    [reduceEvent, endRun, patchMessage],
  )

  // ── 启动:配置 → 连接 → 会话列表 ──
  const refreshSessions = useCallback(async (c: TanguDesktopConfig) => {
    const [act, arch] = await Promise.all([api.listSessions(c, false), api.listSessions(c, true)])
    setSessions(act)
    setArchivedSessions(arch)
    return act
  }, [])

  const connect = useCallback(async (c: TanguDesktopConfig) => {
    const r = await testConnection(c)
    setConnState(r.ok ? 'ok' : 'err')
    setConnMessage(r.message)
    if (!r.ok) return
    try {
      const act = await refreshSessions(c)
      setActiveId((cur) => (cur && act.some((s) => s.id === cur) ? cur : (act[0]?.id ?? null)))
    } catch (e: any) {
      toast(`会话列表加载失败:${e?.message || e}`, true)
    }
    // 模型目录(输入栏会话内切换器用);失败静默,选择器自动隐藏。
    void api.listModels(c).then(setModelsResp).catch(() => setModelsResp(null))
  }, [refreshSessions, toast])

  useEffect(() => {
    void (async () => {
      const stored = await window.tangu?.getConfig()
      desktopMode.current = stored?.mode ?? null
      homeDirRef.current = stored?.homeDir
      const merged = {
        backendUrl: stored?.backendUrl || cfgRef.current.backendUrl,
        token: stored?.token ?? cfgRef.current.token,
        modelId: stored?.modelId ?? cfgRef.current.modelId,
      }
      setCfg(merged)
      setCfgLoaded(true)
      if (merged.token || stored?.mode === 'managed') void connect(merged)
      // 首启引导:桌面端「从未配置」(无云端地址/凭证/直连 provider,且未跳过过)→ 进向导。
      if (stored && window.tangu?.envCheck) {
        try {
          if (!localStorage.getItem(ONBOARDING_DISMISS_KEY)
            && !stored.cloudUrl && !stored.cloudToken && !stored.token) {
            const [auth, provs] = await Promise.all([
              window.tangu.authStatus?.().catch(() => null) ?? null,
              window.tangu.listProviders?.().catch(() => []) ?? [],
            ])
            if (!auth?.loggedIn && !(provs && provs.length)) setOnboarding(true)
          }
        } catch { /* 引导判定失败不阻断 */ }
      }
    })()
    // managed 后端状态推送:就绪 → 取折算配置重连;崩溃 → 标离线。
    const off = window.tangu?.onBackendStatus?.((st) => {
      if (st.state === 'ready') {
        void window.tangu!.getConfig().then((c) => {
          const eff = { backendUrl: c.backendUrl, token: c.token, modelId: c.modelId }
          setCfg(eff)
          void connect(eff)
        })
      } else if (st.state === 'crashed') {
        setConnState('err')
        setConnMessage(st.lastError || '托管后端已退出')
      }
    })
    return () => off?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── 选中会话:懒加载历史 + 恢复在飞 run + 清未读 ──
  useEffect(() => {
    if (!activeId || connState !== 'ok') return
    setUnread((prev) => {
      if (!prev.has(activeId)) return prev
      const next = new Set(prev)
      next.delete(activeId)
      saveUnread(next)
      return next
    })
    if (loadedHistory.current.has(activeId)) return
    loadedHistory.current.add(activeId)
    void (async () => {
      try {
        const [records, config, active] = await Promise.all([
          api.listMessages(cfgRef.current, activeId),
          api.getSessionConfig(cfgRef.current, activeId).catch(() => ({} as AgentConfig)),
          listActiveRuns(cfgRef.current, activeId),
        ])
        setConfigBySession((prev) => ({ ...prev, [activeId]: config }))
        setMessagesBySession((prev) => {
          // SSE 已在写的消息(本地比远端新)保留
          const existing = prev[activeId] || []
          const ui = records.map(recordToUi)
          const byId = new Map(ui.map((m) => [m.id, m] as const))
          for (const m of existing) byId.set(m.id, m)
          return { ...prev, [activeId]: [...byId.values()].sort((a, b) => a.timestamp - b.timestamp) }
        })
        // 恢复订阅在飞 run(刷新/重启后)
        for (const run of active) {
          if ((run.status === 'running' || run.status === 'queued') && run.assistant_message_id) {
            const amid = run.assistant_message_id
            setMessagesBySession((prev) => {
              const list = prev[activeId] || []
              if (list.some((m) => m.id === amid)) return prev
              return {
                ...prev,
                [activeId]: [...list, { id: amid, role: 'assistant', content: '', status: 'streaming', timestamp: Date.now() }],
              }
            })
            subscribeRun(activeId, run.id, amid)
          }
        }
      } catch (e: any) {
        loadedHistory.current.delete(activeId)
        toast(`历史加载失败:${e?.message || e}`, true)
      }
    })()
  }, [activeId, connState, subscribeRun, toast])

  // ── 会话操作 ──
  /** managed(本机托管)后端的新会话默认本机执行,cwd=主目录——与 TUI host 模式对齐。 */
  const defaultSessionConfig = useCallback((): AgentConfig => {
    if (desktopMode.current === 'managed' && homeDirRef.current) {
      return { execMode: 'host', approvalMode: 'auto-edit', cwd: homeDirRef.current }
    }
    return {}
  }, [])

  /** 实际创建会话(可带项目)。项目会话:host 模式 + cwd=项目目录 + 自动编辑审批档。 */
  const createSessionWith = useCallback(async (choice: ProjectChoice | null) => {
    try {
      const s = await api.createSession(cfgRef.current, choice?.path
        ? { project_path: choice.path, project_name: choice.name || undefined }
        : undefined)
      setSessions((prev) => [s, ...prev])
      setActiveId(s.id)
      loadedHistory.current.add(s.id)
      setMessagesBySession((prev) => ({ ...prev, [s.id]: [] }))
      const init: AgentConfig = choice?.path
        ? { execMode: 'host', approvalMode: 'auto-edit', cwd: choice.path }
        : defaultSessionConfig()
      if (Object.keys(init).length) {
        setConfigBySession((prev) => ({ ...prev, [s.id]: init }))
        void api.putSessionConfig(cfgRef.current, s.id, init).catch(() => {})
      }
    } catch (e: any) {
      toast(`新建失败:${e?.message || e}`, true)
    }
  }, [toast, defaultSessionConfig])

  /** 新建入口:本机托管模式弹项目选择(Codex 式);external/云后端直接建(平铺)。 */
  const newSession = useCallback(async () => {
    if (desktopMode.current === 'managed') {
      setProjectPickerOpen(true)
      return
    }
    await createSessionWith(null)
  }, [createSessionWith])

  /** 最近项目(活跃+归档会话的 distinct project_path,按 updated_at 新→旧)。 */
  const recentProjects = useMemo(() => {
    const seen = new Map<string, string>()
    for (const s of [...sessions, ...archivedSessions]) {
      if (s.project_path && !seen.has(s.project_path)) {
        seen.set(s.project_path, s.project_name || s.project_path.split('/').filter(Boolean).pop() || s.project_path)
      }
    }
    return [...seen.entries()].slice(0, 8).map(([path, name]) => ({ path, name }))
  }, [sessions, archivedSessions])

  const renameSession = useCallback(async (id: string, title: string) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)))
    setArchivedSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)))
    try {
      await api.updateSession(cfgRef.current, id, { title })
    } catch (e: any) {
      toast(`重命名失败:${e?.message || e}`, true)
    }
  }, [toast])

  const archiveSession = useCallback(async (id: string, archived: boolean) => {
    try {
      await api.updateSession(cfgRef.current, id, { archived })
      await refreshSessions(cfgRef.current)
      if (archived && activeIdRef.current === id) setActiveId(null)
    } catch (e: any) {
      toast(`操作失败:${e?.message || e}`, true)
    }
  }, [refreshSessions, toast])

  const deleteSession = useCallback(async (id: string) => {
    try {
      await api.deleteSession(cfgRef.current, id)
      setSessions((prev) => prev.filter((s) => s.id !== id))
      setArchivedSessions((prev) => prev.filter((s) => s.id !== id))
      loadedHistory.current.delete(id)
      if (activeIdRef.current === id) setActiveId(null)
    } catch (e: any) {
      toast(`删除失败:${e?.message || e}`, true)
    }
  }, [toast])

  // ── 发送 / 停止 / 审批 ──
  const send = useCallback(async (text: string, attachments: Attachment[]): Promise<boolean> => {
    let sid = activeIdRef.current
    let implicitInit: AgentConfig | null = null
    if (!sid) {
      const s = await api.createSession(cfgRef.current).catch(() => null)
      if (!s) {
        toast('无法创建会话', true)
        return false
      }
      setSessions((prev) => [s, ...prev])
      setActiveId(s.id)
      loadedHistory.current.add(s.id)
      sid = s.id
      implicitInit = defaultSessionConfig()
      if (Object.keys(implicitInit).length) {
        setConfigBySession((prev) => ({ ...prev, [s.id]: implicitInit! }))
        void api.putSessionConfig(cfgRef.current, s.id, implicitInit).catch(() => {})
      }
    }
    const sessionId = sid
    const agentConfig = { ...(implicitInit || configBySession[sessionId] || {}) }
    // 会话级模型(输入栏切换器持久化在 session.model_id)优先于全局默认。
    const sessionModelId = sessions.find((s) => s.id === sessionId)?.model_id || undefined
    try {
      const r = await startRun(cfgRef.current, { sessionId, message: text, modelId: sessionModelId, attachments, agentConfig })
      setMessagesBySession((prev) => ({
        ...prev,
        [sessionId]: [
          ...(prev[sessionId] || []),
          { id: r.userMessageId, role: 'user', content: text, attachments, status: 'done', timestamp: Date.now() },
          { id: r.assistantMessageId, role: 'assistant', content: '', status: 'streaming', timestamp: Date.now() + 1 },
        ],
      }))
      subscribeRun(sessionId, r.runId, r.assistantMessageId)
      // 自动命名:首条消息给 New Chat 改名
      const sess = sessions.find((s) => s.id === sessionId)
      if (sess && (!sess.title || sess.title === 'New Chat')) {
        void renameSession(sessionId, text.slice(0, 30))
      }
      return true
    } catch (e: any) {
      toast(`发送失败:${e?.message || e}`, true)
      return false
    }
  }, [configBySession, sessions, subscribeRun, renameSession, toast])

  const stop = useCallback(() => {
    const sid = activeIdRef.current
    if (!sid) return
    const runId = runningBySession[sid]
    if (runId) void abortRun(cfgRef.current, runId)
  }, [runningBySession])

  const decideApproval = useCallback(
    async (messageId: string, approvalId: string, action: 'approve' | 'approve_always' | 'reject', argsOverride?: Record<string, any>) => {
      const sid = activeIdRef.current
      if (!sid) return
      // runId 取自审批对象本身(approval_request 事件已带),不依赖易失的 runningBySession
      // (run 结束/切会话后仍可兑现,服务端对过期审批回 410)。
      const approval = (messagesBySession[sid] || [])
        .find((m) => m.id === messageId)
        ?.approvals?.find((a) => a.approvalId === approvalId)
      if (!approval?.runId) return
      const r = await resolveApproval(cfgRef.current, approval.runId, approvalId, action, argsOverride)
      if (r.gone) {
        patchMessage(sid, messageId, (m) => ({
          ...m,
          approvals: (m.approvals || []).map((a) => (a.approvalId === approvalId ? { ...a, status: 'expired' as const } : a)),
        }))
      }
    },
    [messagesBySession, patchMessage],
  )

  const setExecConfig = useCallback((patch: Pick<AgentConfig, 'execMode' | 'approvalMode' | 'cwd'>) => {
    const sid = activeIdRef.current
    if (!sid) return
    setConfigBySession((prev) => {
      const next = { ...(prev[sid] || {}), ...patch }
      void api.putSessionConfig(cfgRef.current, sid, next).catch(() => {})
      return { ...prev, [sid]: next }
    })
  }, [])

  /** 会话内模型切换:持久化到 session.model_id;无会话时改全局默认。 */
  const setSessionModel = useCallback((modelId: string) => {
    const sid = activeIdRef.current
    if (!sid) {
      setCfg((prev) => {
        void window.tangu?.setConfig({ modelId })
        return { ...prev, modelId }
      })
      return
    }
    setSessions((prev) => prev.map((s) => (s.id === sid ? { ...s, model_id: modelId } : s)))
    setArchivedSessions((prev) => prev.map((s) => (s.id === sid ? { ...s, model_id: modelId } : s)))
    void api.updateSession(cfgRef.current, sid, { model_id: modelId }).catch((e) => {
      toast(`模型切换保存失败:${e?.message || e}`, true)
    })
  }, [toast])

  /** 会话内思考深度切换:合并进 agent_config.thinkingLevel(agentLoop 每轮 run 读取)。 */
  const setSessionThinking = useCallback((level: NonNullable<AgentConfig['thinkingLevel']>) => {
    const sid = activeIdRef.current
    if (!sid) return
    setConfigBySession((prev) => {
      const next = { ...(prev[sid] || {}), thinkingLevel: level }
      void api.putSessionConfig(cfgRef.current, sid, next).catch(() => {})
      return { ...prev, [sid]: next }
    })
  }, [])

  // ── 设置 ──
  const patchConfig = useCallback((patch: Partial<TanguDesktopConfig>) => {
    setCfg((prev) => {
      const merged = { ...prev, ...patch }
      void window.tangu?.setConfig(patch)
      return merged
    })
  }, [])

  const onGlassChange = useCallback((on: boolean) => {
    setGlassOn(on)
    document.documentElement.dataset.glass = on ? 'on' : 'off'
    try { localStorage.setItem('forsion_glass', on ? 'on' : 'off') } catch { /* ignore */ }
  }, [])

  // 快捷键:Cmd/Ctrl+N 新会话,Cmd/Ctrl+, 设置
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (e.key === 'n') {
        e.preventDefault()
        void newSession()
      }
      if (e.key === ',') {
        e.preventDefault()
        setSettingsOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newSession])

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeId) || archivedSessions.find((s) => s.id === activeId) || null,
    [sessions, archivedSessions, activeId],
  )
  const activeMessages = (activeId && messagesBySession[activeId]) || []
  const running = !!(activeId && runningBySession[activeId])
  const runningIds = useMemo(() => new Set(Object.keys(runningBySession)), [runningBySession])
  const execConfig = (activeId && configBySession[activeId]) || {}

  if (!cfgLoaded) return <div className="app" />

  return (
    <div className="app">
      <Sidebar
        collapsed={sidebarCollapsed}
        sessions={sessions}
        archivedSessions={archivedSessions}
        activeId={activeId}
        runningIds={runningIds}
        unreadIds={unread}
        onSelect={setActiveId}
        onNew={() => void newSession()}
        onRename={(id, t) => void renameSession(id, t)}
        onArchive={(id, a) => void archiveSession(id, a)}
        onDelete={(id) => void deleteSession(id)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <main className="main">
        <ChatHeader
          title={activeSession?.title || 'Tangu Agent'}
          modelId={activeSession?.model_id || cfg.modelId}
          connState={connState}
          connMessage={connMessage}
          sidebarCollapsed={sidebarCollapsed}
          rightOpen={rightOpen}
          onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
          onToggleRight={() => setRightOpen(!rightOpen)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {onboarding ? (
            <OnboardingWizard
              onReconnect={() => {
                desktopMode.current = 'managed'
                void window.tangu?.getConfig().then((c) => {
                  const eff = { backendUrl: c.backendUrl, token: c.token, modelId: c.modelId }
                  setCfg(eff)
                  void connect(eff)
                })
              }}
              onFinish={() => {
                setOnboarding(false)
                void window.tangu?.getConfig().then((c) => {
                  const eff = { backendUrl: c.backendUrl, token: c.token, modelId: c.modelId }
                  setCfg(eff)
                  void connect(eff)
                })
              }}
            />
          ) : (
            <>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <ChatArea
                  messages={activeMessages}
                  onApproval={(mid, aid, action, args) => void decideApproval(mid, aid, action, args)}
                />
                <MessageInput
                  disabled={connState !== 'ok'}
                  running={running}
                  execConfig={execConfig}
                  homeDir={homeDirRef.current}
                  models={modelsResp?.models ?? null}
                  modelId={activeSession?.model_id || cfg.modelId || modelsResp?.defaultModelId || ''}
                  onModelChange={setSessionModel}
                  thinkingLevel={execConfig.thinkingLevel}
                  onThinkingChange={setSessionThinking}
                  onExecConfigChange={setExecConfig}
                  onSend={send}
                  onStop={stop}
                />
              </div>
              {rightOpen && activeId && (
                <RightPanel
                  cfg={cfg}
                  sessionId={activeId}
                  sessionConfig={execConfig}
                  running={running}
                  onConfigChange={(c) => {
                    setConfigBySession((prev) => ({ ...prev, [activeId]: c }))
                    void api.putSessionConfig(cfgRef.current, activeId, c).catch(() => {})
                  }}
                  onToast={toast}
                />
              )}
            </>
          )}
        </div>
      </main>

      <ProjectPicker
        open={projectPickerOpen}
        recents={recentProjects}
        onClose={() => setProjectPickerOpen(false)}
        onChoose={(c) => {
          setProjectPickerOpen(false)
          void createSessionWith(c)
        }}
      />

      <SettingsModal
        open={settingsOpen}
        cfg={cfg}
        themePreset={themePreset}
        themeMode={themeMode}
        glassOn={glassOn}
        onClose={() => setSettingsOpen(false)}
        onConfigChange={patchConfig}
        onThemeChange={(preset, mode) => {
          setThemePreset(preset)
          setThemeMode(mode)
        }}
        onGlassChange={onGlassChange}
        onReconnect={(patch) => void connect({ ...cfgRef.current, ...(patch || {}) })}
      />

      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.error ? ' error' : ''}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  )
}
