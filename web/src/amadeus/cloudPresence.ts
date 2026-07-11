/**
 * presence 汇流器:cloudEvents(SSE)推入,UI 订阅名册。
 * 独立小模块,避免 cloudBridge ↔ cloudCollab 循环依赖。TTL 剪枝与服务端一致(70s)。
 */

export interface PresenceUser {
  userId: string
  username: string
  page: string | null
  at: number
}

const TTL_MS = 70_000
const roster = new Map<string, PresenceUser>()
const subs = new Set<(list: PresenceUser[]) => void>()

function snapshot(): PresenceUser[] {
  const now = Date.now()
  for (const [k, p] of roster) if (now - p.at > TTL_MS) roster.delete(k)
  return [...roster.values()]
}

function fire(): void {
  const list = snapshot()
  for (const fn of subs) {
    try { fn(list) } catch { /* ignore */ }
  }
}

export function pushPresence(p: unknown): void {
  const u = p as PresenceUser | null
  if (!u || typeof u.userId !== 'string') return
  roster.set(u.userId, { userId: u.userId, username: String(u.username ?? 'user'), page: typeof u.page === 'string' ? u.page : null, at: Number(u.at) || Date.now() })
  fire()
}

export function setRoster(list: unknown): void {
  roster.clear()
  if (Array.isArray(list)) for (const p of list) {
    const u = p as PresenceUser
    if (u && typeof u.userId === 'string') roster.set(u.userId, u)
  }
  fire()
}

export function subscribePresence(fn: (list: PresenceUser[]) => void): () => void {
  subs.add(fn)
  fn(snapshot())
  return () => { subs.delete(fn) }
}
