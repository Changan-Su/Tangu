/** 收藏 / 最近(每 vault 一份,localStorage):渲染时对 pages 过滤 → 已删除的自然消失。
 *  ponytail: 重命名/移动不做路径重映射(条目失效即自动隐藏),需要时再补 remap。 */
import { create } from 'zustand'
import { usePageStore } from '@amadeus/store/pageStore'

interface Prefs { starred: string[]; recents: string[] }
interface PrefsState extends Prefs {
  toggleStar(path: string): void
  pushRecent(path: string): void
}

const RECENT_CAP = 20

const storageKey = (): string | null => {
  const r = usePageStore.getState().vaultRoot
  return r ? `amadeus_prefs:${r}` : null
}
const load = (): Prefs => {
  try {
    const k = storageKey()
    const v = k && localStorage.getItem(k)
    if (v) {
      const p = JSON.parse(v) as Partial<Prefs>
      return { starred: Array.isArray(p.starred) ? p.starred : [], recents: Array.isArray(p.recents) ? p.recents : [] }
    }
  } catch { /* ignore */ }
  return { starred: [], recents: [] }
}
const persist = (p: Prefs): void => {
  try {
    const k = storageKey()
    if (k) localStorage.setItem(k, JSON.stringify(p))
  } catch { /* ignore */ }
}

export const useAmadeusPrefs = create<PrefsState>((set, get) => ({
  starred: [],
  recents: [],
  toggleStar: (path) => {
    const starred = get().starred.includes(path) ? get().starred.filter((p) => p !== path) : [...get().starred, path]
    set({ starred })
    persist({ starred, recents: get().recents })
  },
  pushRecent: (path) => {
    const recents = [path, ...get().recents.filter((p) => p !== path)].slice(0, RECENT_CAP)
    set({ recents })
    persist({ starred: get().starred, recents })
  },
}))

// vault 切换 → 载入该 vault 的偏好;笔记切换 → 记最近。
usePageStore.subscribe((s, p) => {
  if (s.vaultRoot !== p.vaultRoot) useAmadeusPrefs.setState(load())
  if (s.activePage && s.activePage !== p.activePage) useAmadeusPrefs.getState().pushRecent(s.activePage)
})
