/**
 * 主进程 SSE 客户端(fetch 流式解析)。主进程能带 Authorization 头,不走 web 端 ?token= 变体。
 * 重连:指数退避 1s→30s + 抖动(参数对齐 web/src/amadeus/cloudEvents.ts);每次(重)连带 since=cursor,
 * 服务端窗口够则重放、不够发 reset —— 追赶语义都在服务端,客户端只透传事件。
 */

export interface SseEvents {
  onHello: (seq: number) => void
  onChange: (data: any) => void
  onReset: () => void
  /** 连接建立(含重连成功)。 */
  onOpen: () => void
  /** 断开(将自动重连)。 */
  onDown: (err?: unknown) => void
  /** 每次重连前取 since 游标。 */
  getSince: () => number
  /** P2 presence(可选):增量事件 / 连上时全量名册。 */
  onPresence?: (data: any) => void
  onPresenceRoster?: (data: any) => void
}

export interface SseHandle {
  stop: () => void
}

export function startSse(
  cfg: { baseUrl: string; vaultId: string; token: string },
  ev: SseEvents,
): SseHandle {
  let stopped = false
  let attempt = 0
  let abort: AbortController | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null

  const url = (): string =>
    `${cfg.baseUrl.replace(/\/+$/, '')}/api/amadeus/vaults/${cfg.vaultId}/events?since=${ev.getSince()}`

  const scheduleRetry = (err?: unknown): void => {
    if (stopped) return
    ev.onDown(err)
    const delay = Math.min(30_000, 1000 * 2 ** attempt) * (0.7 + Math.random() * 0.6)
    attempt++
    retryTimer = setTimeout(() => void connect(), delay)
  }

  const connect = async (): Promise<void> => {
    if (stopped) return
    abort = new AbortController()
    let res: Response
    try {
      res = await fetch(url(), {
        headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'text/event-stream' },
        signal: abort.signal,
      })
    } catch (e) {
      scheduleRetry(e)
      return
    }
    if (!res.ok || !res.body) {
      scheduleRetry(new Error(`sse http ${res.status}`))
      return
    }
    attempt = 0
    ev.onOpen()

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let eventName = ''
    let dataLines: string[] = []

    const dispatch = (): void => {
      if (!dataLines.length && !eventName) return
      const data = dataLines.join('\n')
      const name = eventName || 'message'
      eventName = ''
      dataLines = []
      let parsed: any = null
      try {
        parsed = data ? JSON.parse(data) : null
      } catch {
        return
      }
      if (name === 'hello') ev.onHello(Number(parsed?.seq ?? 0))
      else if (name === 'change') ev.onChange(parsed)
      else if (name === 'reset') ev.onReset()
      else if (name === 'presence') ev.onPresence?.(parsed)
      else if (name === 'presence-roster') ev.onPresenceRoster?.(parsed)
    }

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        for (;;) {
          const nl = buf.indexOf('\n')
          if (nl < 0) break
          const line = buf.slice(0, nl).replace(/\r$/, '')
          buf = buf.slice(nl + 1)
          if (line === '') dispatch()
          else if (line.startsWith(':')) continue // ping/注释
          else if (line.startsWith('event:')) eventName = line.slice(6).trim()
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
          // id: 行忽略 —— 游标由引擎在事件应用后自己推进(getSince)。
        }
      }
    } catch (e) {
      if (!stopped) scheduleRetry(e)
      return
    }
    scheduleRetry(new Error('sse stream ended'))
  }

  void connect()
  return {
    stop: () => {
      stopped = true
      if (retryTimer) clearTimeout(retryTimer)
      abort?.abort()
    },
  }
}
