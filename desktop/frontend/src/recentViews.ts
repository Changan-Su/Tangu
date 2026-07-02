/** 「最近使用」精准视图登记:某篇笔记 / 某个会话的快捷跳转,喂给新建标签页启动器。
 *  只记带身份参数的主区视图(chat:sessionId / note:notePath),localStorage 持久化,LRU 去重。 */
import { create } from 'zustand'

export interface RecentView {
  /** 去重键:'chat:<sessionId>' | 'note:<notePath>' */
  key: string
  kind: 'chat' | 'note'
  /** sessionId 或 vault 相对笔记路径 */
  id: string
  /** 记录时的标题快照;渲染端可用实时标题覆盖 */
  title: string
  ts: number
}

const LS_KEY = 'forsion_tangu_recent_views'
const CAP = 24

function load(): RecentView[] {
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY) || '[]') as RecentView[]
    return Array.isArray(v) ? v.filter((i) => i && i.key && i.id) : []
  } catch {
    return []
  }
}

export const useRecentViews = create<{
  items: RecentView[]
  record(v: Omit<RecentView, 'ts'>): void
  remove(key: string): void
}>((set) => ({
  items: load(),
  record: (v) =>
    set((s) => {
      const items = [{ ...v, ts: Date.now() }, ...s.items.filter((i) => i.key !== v.key)].slice(0, CAP)
      try { localStorage.setItem(LS_KEY, JSON.stringify(items)) } catch { /* private mode */ }
      return { items }
    }),
  remove: (key) =>
    set((s) => {
      const items = s.items.filter((i) => i.key !== key)
      try { localStorage.setItem(LS_KEY, JSON.stringify(items)) } catch { /* private mode */ }
      return { items }
    }),
}))
