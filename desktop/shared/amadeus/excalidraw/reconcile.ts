/** Excalidraw 场景的元素级合并 —— 白板跨端(桌面云端镜像 ↔ web)并发编辑的收敛核。
 *
 *  规则与 Excalidraw 官方 collab reconciliation 相同:按元素 id 取并集,同 id 时
 *  version 高者胜、平局 versionNonce 小者胜;isDeleted 是墓碑,天然参与合并(删除会传播,
 *  但对面在删除后又画高一版的同 id 元素会复活 —— 与官方语义一致)。
 *  两端改**不同**元素 → 无损合并;改**同一**元素 → 元素级 LWW。相比整文件后写胜,
 *  冲突面从「整块白板」缩到「单个图形」。
 *
 *  刻意零依赖(不 import @excalidraw/excalidraw):渲染端 drawingStore 在启动 bundle 里,
 *  那个 1MB 包必须只活在 lazy chunk(见 ExcalidrawCanvas);这里对元素只按
 *  { id, version, versionNonce, index, isDeleted } 的鸭子型操作。
 */

export interface SceneElement {
  id: string
  version?: number
  versionNonce?: number
  /** fractional index(Excalidraw 用它定 z 序,字符串字典序即大小序)。 */
  index?: string | null
  isDeleted?: boolean
  [k: string]: unknown
}

export interface SceneLike {
  elements?: SceneElement[]
  appState?: Record<string, unknown> | null
  files?: Record<string, unknown> | null
  [k: string]: unknown
}

/** a 是否压过 b(同 id 竞争):version 高者胜,平局 versionNonce 小者胜(官方规则)。 */
const wins = (a: SceneElement, b: SceneElement): boolean => {
  const av = a.version ?? 0
  const bv = b.version ?? 0
  if (av !== bv) return av > bv
  return (a.versionNonce ?? 0) <= (b.versionNonce ?? 0)
}

/** 无 index 的老元素排到末尾并保持相对位序(Excalidraw 载入时会自愈索引)。 */
const idx = (e: SceneElement): string => (typeof e.index === 'string' ? e.index : '￿')

export function reconcileElements(local: SceneElement[], remote: SceneElement[]): SceneElement[] {
  const out = new Map<string, SceneElement>()
  for (const el of remote) {
    if (el && typeof el.id === 'string') out.set(el.id, el)
  }
  for (const el of local) {
    if (!el || typeof el.id !== 'string') continue
    const r = out.get(el.id)
    if (!r || wins(el, r)) out.set(el.id, el)
  }
  // Map 保持插入序 → sort 稳定性保证同 index 的相对位序不乱跳。
  return [...out.values()].sort((a, b) => (idx(a) < idx(b) ? -1 : idx(a) > idx(b) ? 1 : 0))
}

/** 两个场景是否已收敛(id→version/versionNonce 全同)——用来斩断「合并→写→回声→合并」链:
 *  收敛后 applier 零动作,不再触发 onChange/写盘。 */
export function sameElements(a: SceneElement[], b: SceneElement[]): boolean {
  if (a.length !== b.length) return false
  const m = new Map(a.map((e) => [e.id, e]))
  for (const e of b) {
    const o = m.get(e.id)
    if (!o || (o.version ?? 0) !== (e.version ?? 0) || (o.versionNonce ?? 0) !== (e.versionNonce ?? 0)) return false
  }
  return true
}

/** 场景级合并:elements 走 reconcile;files(内嵌图片,内容寻址)取并集;appState 本地优先
 *  (视口/网格偏好,冲突只有观感差异);顶层其余键(type/version/source)本地优先。 */
export function mergeScenes(local: SceneLike, remote: SceneLike): SceneLike {
  return {
    ...remote,
    ...local,
    elements: reconcileElements(local.elements ?? [], remote.elements ?? []),
    appState: local.appState ?? remote.appState ?? {},
    files: { ...(remote.files ?? {}), ...(local.files ?? {}) },
  }
}
