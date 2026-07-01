/** 主面板导航历史(Workbench 级,浏览器式前进/后退)。**与具体 view 无关** —— 各 feature
 *  (对话会话 / Amadeus 笔记 / 特殊视图)在其「页面」变化时调 recordNav();前进后退调 restore 闭包。
 *  箭头由引擎在主区标签栏左上角常驻渲染(见 WorkspaceHost.prefixActions),故只要页面在主面板就有。 */
import { create } from 'zustand'

export interface NavEntry {
  /** 去重键(同一页面不重复记),如 `chat:<id>` / `amadeus:<path>`。 */
  key: string
  /** 前进/后退到此项时执行(可异步:如 loadPage)。 */
  restore: () => unknown
}

interface NavState {
  entries: NavEntry[]
  idx: number
  record(entry: NavEntry): void
  back(): void
  forward(): void
}

let navigating = false // back/forward 期间置真 → restore 引发的页面变化不被重新记录

function go(get: () => NavState, set: (p: Partial<NavState>) => void, j: number): void {
  const { entries, idx } = get()
  if (j === idx || j < 0 || j >= entries.length) return
  set({ idx: j })
  navigating = true
  Promise.resolve(entries[j].restore()).finally(() => { navigating = false })
}

export const useNav = create<NavState>((set, get) => ({
  entries: [],
  idx: -1,
  record(entry) {
    if (navigating) return
    const { entries, idx } = get()
    if (entries[idx]?.key === entry.key) return // 同页去重
    const next = [...entries.slice(0, idx + 1), entry].slice(-100) // 截断 forward + 压入 + 封顶 100
    set({ entries: next, idx: next.length - 1 })
  },
  back() { go(get, set, get().idx - 1) },
  forward() { go(get, set, get().idx + 1) },
}))

/** feature 在其主面板「页面」切换时调用。key 去重,restore 供前进/后退复原。 */
export const recordNav = (key: string, restore: () => unknown): void => useNav.getState().record({ key, restore })
