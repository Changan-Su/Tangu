/** 按条目云同步的渲染端状态:注册表镜像 + 每绑定最新引擎状态(status 事件按 binding 键分存)。
 *  数据源 = window.amadeusSync.entrySync*(仅桌面;web/mobile 缺位时一切 UI 优雅隐藏)。 */
import { create } from 'zustand'
import type { AmadeusEntrySyncVault, AmadeusSyncStatus } from '../types'

interface EntrySyncStore {
  vaults: AmadeusEntrySyncVault[]
  activeRoot: string | null
  /** binding(vault 根绝对路径)→ 该条目绑定引擎的最新状态。 */
  status: Record<string, AmadeusSyncStatus>
  refresh(): Promise<void>
}

export const useEntrySync = create<EntrySyncStore>((set) => ({
  vaults: [],
  activeRoot: null,
  status: {},
  async refresh() {
    const api = window.amadeusSync
    if (!api?.entrySyncGet) return
    try {
      const st = await api.entrySyncGet()
      set({ vaults: st.vaults, activeRoot: st.activeRoot })
    } catch {
      /* 旧主进程构建无此接口:保持空 */
    }
  },
}))

let subscribed = false
/** 幂等订阅注册表变更 + 绑定状态事件(首个消费组件挂载时调一次)。 */
export function ensureEntrySyncSubscribed(): void {
  if (subscribed) return
  subscribed = true
  const api = window.amadeusSync
  void useEntrySync.getState().refresh()
  api?.onEntrySyncChange?.(() => void useEntrySync.getState().refresh())
  api?.onStatus?.((s) => {
    const b = (s as AmadeusSyncStatus).binding
    if (b) useEntrySync.setState((st) => ({ status: { ...st.status, [b]: s as AmadeusSyncStatus } }))
  })
}

/** path 是否已是当前 vault 的显式同步条目(精确匹配;子树覆盖不算)。 */
export function isSyncedEntry(vaultRoot: string | null, path: string): boolean {
  if (!vaultRoot) return false
  const rec = useEntrySync.getState().vaults.find((v) => v.vaultRoot === vaultRoot)
  const p = path.replace(/\\/g, '/').normalize('NFC')
  return !!rec?.entries.some((e) => e.path === p)
}
