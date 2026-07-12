/**
 * 用户活动日志 —— renderer 埋点门面(桌面 main 落盘 ~/.forsion/activity/<date>.log,供后台 Muse
 * 的 read_activity 工具与触发器消费;web/无桥形态自动 no-op)。
 *
 * 依赖铁律(镜像 achievements):本模块零依赖、fire-and-forget、绝不抛——核心代码只加一行 act()。
 * 拼行/消毒全在 main 侧 electron/activityLog.ts(这里只传结构化 {event, detail});事件名点号命名
 * 空间(如 chat.send / note.create),detail 里 `text` 键=尾部内容片段(main 截 40 字符)。
 */

function bridge(): ((event: string, detail?: Record<string, unknown>) => void) | undefined {
  try {
    return (window as any).tangu?.act
  } catch {
    return undefined
  }
}

/** 记一条事件。 */
export function act(event: string, detail?: Record<string, unknown>): void {
  try {
    bridge()?.(event, detail)
  } catch {
    /* 装饰性数据,绝不拖累调用方 */
  }
}

const THROTTLE_WINDOW_MS = 5 * 60_000
const lastSent = new Map<string, number>()

/** 节流版(停留类事件,如 view.open):同 key 5 分钟内只记第一次。key 缺省 = event+detail 序列化。 */
export function actThrottled(event: string, detail?: Record<string, unknown>, key?: string): void {
  try {
    const k = key || `${event}|${JSON.stringify(detail || {})}`
    const now = Date.now()
    const last = lastSent.get(k) || 0
    if (now - last < THROTTLE_WINDOW_MS) return
    lastSent.set(k, now)
    if (lastSent.size > 500) lastSent.clear() // ponytail: 粗暴防泄漏,500 键直接清零重来
    act(event, detail)
  } catch { /* 同上 */ }
}

/** DB 格值 → 日志短值:undefined/null=省略(读者视作清空),数组逗号连接,截 40(main 侧再消毒截 80)。 */
export const shortVal = (v: unknown): string | undefined =>
  v === undefined || v === null ? undefined : String(Array.isArray(v) ? v.join(',') : v).slice(0, 40)

const DEBOUNCE_MS = 10_000
const pending = new Map<string, ReturnType<typeof setTimeout>>()

/** 防抖版(逐次编辑取末态,如 task.name):同 key 静默 10s 后记**最后一次**的 detail。 */
export function actDebounced(event: string, detail: Record<string, unknown>, key: string): void {
  try {
    const k = `${event}|${key}`
    const prev = pending.get(k)
    if (prev) clearTimeout(prev)
    pending.set(
      k,
      setTimeout(() => {
        pending.delete(k)
        act(event, detail)
      }, DEBOUNCE_MS),
    )
  } catch { /* 同上 */ }
}
