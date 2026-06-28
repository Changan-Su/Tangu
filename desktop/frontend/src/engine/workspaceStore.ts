/**
 * Workspace store(≈ Obsidian workspace)。在已集成的 Dockview 之上建薄 API:
 * openView / getActiveLeaf / splitActive / toggleSidebar / saveLayout↔restore / 命名布局。
 * 单个 Dockview 实例托管三区:左侧栏 / 主区 / 右侧栏,由 panel.params.__loc 标记区分。
 * 视图「参数驱动可重建」:panel 存 {component:type, params} → 刷新/恢复时 Dockview 据此重建。
 */
import { create } from 'zustand'
import type { DockviewApi, IDockviewPanel } from 'dockview-react'
import type { Leaf, ViewLocation } from './types'
import { getView } from './viewRegistry'
import { label } from './types'
import {
  LAYOUT_KEY, saveLayout, loadLayout, clearLayout, saveNamedLayout, loadNamedLayout, listNamedLayouts,
  type LayoutEnvelopeV4, type PersistedPanel,
} from './layoutPersist'

/** Dockview panel.params 里引擎私有字段(双下划线避免与视图 params 撞名)。 */
interface PanelMeta {
  __loc?: ViewLocation
  __type?: string
}

/** 恢复布局后也必须扫描现有 id；模块级 seq 会在重启后回零并撞上 chat#1。 */
export function nextPanelId(ids: Iterable<string>, type: string): string {
  const used = new Set(ids)
  let n = 1
  while (used.has(`${type}#${n}`)) n++
  return `${type}#${n}`
}

function nextId(api: DockviewApi, type: string): string {
  return nextPanelId(api.panels.map((p) => p.id), type)
}

/** 黄金分割默认:中间 0.618,两侧每侧 0.382/2 = 0.191(= 1 - 0.618 平分)。 */
const SIDE_FRACTION = 0.191

/** 侧栏开合补间动画期间,pinSides 跳过该侧 —— 让 tween 独占其宽度,免被钉宽 setSize 打断。 */
const sidebarAnimating: Record<'left' | 'right', boolean> = { left: false, right: false }

/** 某侧栏的黄金分割目标宽(与 pinSides 同样钳制)。 */
function sideTargetWidth(api: DockviewApi, loc: 'left' | 'right'): number {
  const min = loc === 'left' ? 220 : 240
  const max = loc === 'left' ? 280 : 300
  return Math.round(Math.min(max, Math.max(min, api.width * SIDE_FRACTION)))
}

type SizableGroup = { api: { setSize: (s: { width: number }) => void; width?: number; setConstraints?: (c: { minimumWidth?: number; maximumWidth?: number }) => void } }

/** 收起一侧期间临时锁住另一侧宽度(min=max=目标宽),让 close 释放的空白只被中间主区吸收。
 *  否则另一侧会瞬间吞掉空白「突然变宽」再被 pinSides 弹回 = 收栏闪屏。返回释放函数(沉降后调)。 */
function lockOtherSide(api: DockviewApi, side: 'left' | 'right'): () => void {
  const other = side === 'left' ? 'right' : 'left'
  const og = (panelsAt(api, other)[0] as { group?: SizableGroup } | undefined)?.group
  if (!og) return () => {}
  const w = sideTargetWidth(api, other)
  try { og.api.setConstraints?.({ minimumWidth: w, maximumWidth: w }) } catch { /* 跨版本兜底 */ }
  return () => { try { og.api.setConstraints?.({ minimumWidth: 0, maximumWidth: Number.MAX_SAFE_INTEGER }) } catch { /* ignore */ } }
}

/** rAF 把某组宽度从 from 平滑补间到 to(ease-out cubic),done 收尾。无 rAF(测试)时直接收尾。 */
function tweenGroupWidth(group: SizableGroup, from: number, to: number, done: () => void): void {
  if (typeof requestAnimationFrame !== 'function') { try { group.api.setSize({ width: to }) } catch { /* ignore */ } done(); return }
  const DURATION = 200
  const ease = (k: number): number => 1 - Math.pow(1 - k, 3)
  let startTs = 0
  const step = (ts: number): void => {
    if (!startTs) startTs = ts
    const k = Math.min(1, (ts - startTs) / DURATION)
    try { group.api.setSize({ width: Math.round(from + (to - from) * ease(k)) }) } catch { /* 跨版本兜底 */ }
    if (k < 1) requestAnimationFrame(step)
    else done()
  }
  requestAnimationFrame(step)
}

/** 把**两侧**侧栏组宽度都钉为 0.191×容器宽(黄金分割;中间自得 0.618)。
 *  必须两侧一起钉:只钉一侧时,另一侧 toggle 释放/重建会让这一侧吃掉空白而漂移(0.191→0.333)。
 *  Dockview split/setSize 异步竞争 → rAF + setTimeout 双重兜底,在布局沉降后再钉。
 *  正在补间动画的一侧跳过(sidebarAnimating),避免钉宽打断丝滑过渡。 */
function pinSides(api: DockviewApi): void {
  const apply = (): void => {
    const W = api.width
    if (!W) return
    for (const loc of ['left', 'right'] as const) {
      if (sidebarAnimating[loc]) continue
      try { panelsAt(api, loc)[0]?.group.api.setSize({ width: sideTargetWidth(api, loc) }) } catch { /* 跨版本兜底 */ }
    }
  }
  const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (f: () => void) => f()
  raf(() => raf(apply))
  setTimeout(apply, 60) // Dockview 布局沉降后再钉一次(rAF 偶尔早于其内部 resize)
}

/** 读 panel 的视图类型:优先 params.__type(可靠),回退 Dockview 的 component(跨版本不保证暴露,
 *  曾因其 undefined 导致 toggle 暂存出空 type → 重开 addPanel('') 报错+白屏)。 */
function panelType(p: IDockviewPanel): string {
  const t = ((p.params ?? {}) as PanelMeta).__type
  return t || (p as { component?: string }).component || ''
}

/** 把一个 Dockview panel 包装为引擎 Leaf。 */
function makeLeaf(panel: IDockviewPanel): Leaf {
  const raw = (panel.params ?? {}) as Record<string, unknown>
  const { __loc, __type, ...userParams } = raw as PanelMeta & Record<string, unknown>
  void __loc
  void __type
  return {
    id: panel.id,
    type: panelType(panel),
    params: userParams,
    setTitle: (t) => panel.api.setTitle(t),
    setParams: (p) => panel.api.updateParameters({ ...(panel.params ?? {}), ...p }),
    close: () => panel.api.close(),
  }
}

function panelsAt(api: DockviewApi, loc: ViewLocation): IDockviewPanel[] {
  return api.panels.filter((p) => ((p.params ?? {}) as PanelMeta).__loc === loc)
}

/** 给某 location 计算新 panel 的放置位置。 */
function positionFor(api: DockviewApi, loc: ViewLocation): Record<string, unknown> | undefined {
  const sameLoc = panelsAt(api, loc)
  if (sameLoc.length) return { referencePanel: sameLoc[0].id, direction: 'within' }
  if (loc === 'main') return undefined // 首个主区 panel
  const main = panelsAt(api, 'main')[0] ?? api.panels[0]
  if (main) return { referencePanel: main.id, direction: loc === 'left' ? 'left' : 'right' }
  return undefined
}

type Stashed = PersistedPanel

function envelope(api: DockviewApi, state: Pick<WorkspaceState, 'leftVisible' | 'rightVisible' | 'stash'>): LayoutEnvelopeV4 {
  return {
    version: 4,
    dockview: api.toJSON(),
    sidebars: {
      // 真实 panel 是唯一真源；状态事件可能落后于 Dockview 的异步布局沉降。
      left: { visible: panelsAt(api, 'left').length > 0, stash: state.stash.left },
      right: { visible: panelsAt(api, 'right').length > 0, stash: state.stash.right },
    },
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
export function scheduleWorkspaceSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    useWorkspace.getState().saveCurrent()
  }, 100)
}

/** 主区 leaf 的轻量快照,供顶栏内嵌标签条渲染(Obsidian 式单行标签)。 */
export interface MainTab {
  id: string
  type: string
  title: string
  active: boolean
  closable: boolean
  sessionId?: string
  followActive: boolean
}

/** 侧栏视图的轻量快照,供顶栏两侧的视图图标渲染。收起态也列(从 stash),点击可重开。 */
export interface SideTab {
  type: string
  title: string
  active: boolean
  closable: boolean
}

interface WorkspaceState {
  api: DockviewApi | null
  /** 最近聚焦的 Chat leaf；点击右栏 tab 时仍保持其上下文。 */
  focusedChatLeafId: string | null
  /** 主区打开的 leaf(顶栏标签条用);随布局/激活变化刷新。 */
  mainTabs: MainTab[]
  /** 左右侧栏的视图图标(顶栏两侧用);收起态从 stash 取。 */
  leftTabs: SideTab[]
  rightTabs: SideTab[]
  /** Chat DOM 只登记在 workspace 引擎，不进入业务 app state。 */
  chatSurfaces: Record<string, HTMLDivElement>
  leftVisible: boolean
  rightVisible: boolean
  /** 收起侧栏时暂存其内容,展开时还原。 */
  stash: Record<'left' | 'right', Stashed[]>
  sidebarDefaults: Record<'left' | 'right', Stashed[]>
  /** 默认布局构建器(WorkspaceHost 从 buildDefault prop 注入,供 resetLayout 复用)。 */
  defaultBuilder: (() => void) | null
  setApi(api: DockviewApi | null): void
  setDefaultBuilder(fn: () => void): void
  setSidebarDefaults(defaults: Record<'left' | 'right', Stashed[]>): void
  initializeSidebar(side: 'left' | 'right', visible: boolean): void
  setFocusedLeaf(panel: IDockviewPanel | null | undefined): void
  registerChatSurface(leafId: string, el: HTMLDivElement | null): void
  syncPanelState(): void
  /** 重算主区标签条 + 两侧侧栏图标(布局/激活变化时调)。 */
  refreshTabs(): void
  /** 顶栏标签点击 → 激活该 leaf。 */
  activateLeaf(id: string): void
  /** 顶栏标签关闭。 */
  closeLeaf(id: string): void
  /** 顶栏侧栏图标点击 → 展开该侧(若收起)并显示该视图。 */
  showSideView(side: 'left' | 'right', type: string): void
  /** 关闭某侧的某视图(右键菜单)。 */
  closeSideView(side: 'left' | 'right', type: string): void
  /** 恢复默认布局:清空 → 重建默认(黄金分割 中 0.618 / 两侧各 0.191)→ 清持久化。 */
  resetLayout(): void
  /** 开/聚焦一个视图。singleton 已存在则聚焦。返回 leaf。 */
  openView(type: string, params?: Record<string, unknown>, loc?: ViewLocation): Leaf | null
  getActiveLeaf(): Leaf | null
  /** 把当前活动视图分屏到一侧(同 type+params 复制一份)。 */
  splitActive(direction: 'right' | 'down', paramsOverride?: Record<string, unknown>): Leaf | null
  toggleSidebar(side: 'left' | 'right'): void
  saveCurrent(): void
  saveNamed(name: string): void
  applyNamed(name: string): void
  namedLayouts(): string[]
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  api: null,
  focusedChatLeafId: null,
  mainTabs: [],
  leftTabs: [],
  rightTabs: [],
  chatSurfaces: {},
  leftVisible: true,
  rightVisible: true,
  stash: { left: [], right: [] },
  sidebarDefaults: { left: [], right: [] },
  defaultBuilder: null,

  setApi: (api) => set({ api }),
  setDefaultBuilder: (fn) => set({ defaultBuilder: fn }),
  setSidebarDefaults: (defaults) => set({ sidebarDefaults: defaults }),
  initializeSidebar: (side, visible) => set((s) => ({
    [side === 'left' ? 'leftVisible' : 'rightVisible']: visible,
    stash: visible ? s.stash : { ...s.stash, [side]: s.sidebarDefaults[side] },
  } as Partial<WorkspaceState>)),
  setFocusedLeaf: (panel) => {
    if (panel && panelType(panel) === 'chat') set({ focusedChatLeafId: panel.id })
  },
  registerChatSurface: (leafId, el) => set((s) => {
    const next = { ...s.chatSurfaces }
    if (el) next[leafId] = el
    else delete next[leafId]
    return { chatSurfaces: next }
  }),
  syncPanelState: () => {
    const api = get().api
    if (!api) return
    const leftVisible = panelsAt(api, 'left').length > 0
    const rightVisible = panelsAt(api, 'right').length > 0
    if (leftVisible !== get().leftVisible || rightVisible !== get().rightVisible) set({ leftVisible, rightVisible })
  },

  refreshTabs: () => {
    const api = get().api
    if (!api) { if (get().mainTabs.length) set({ mainTabs: [] }); return }
    const activeId = api.activePanel?.id
    const tabs: MainTab[] = panelsAt(api, 'main').map((p) => {
      const type = panelType(p)
      const params = (p.params ?? {}) as Record<string, unknown>
      const def = getView(type)
      return {
        id: p.id,
        type,
        title: p.title || (def ? label(def.displayName) : type),
        active: p.id === activeId,
        closable: def?.closable !== false,
        sessionId: typeof params.sessionId === 'string' ? params.sessionId : undefined,
        followActive: params.followActive !== false,
      }
    })
    const prev = get().mainTabs
    const same = prev.length === tabs.length && prev.every((t, i) =>
      t.id === tabs[i].id && t.active === tabs[i].active && t.title === tabs[i].title)
    if (!same) set({ mainTabs: tabs })

    // 两侧侧栏图标:可见时从 live panel(active=组内当前显示),收起时从 stash(无 active)。
    const sideTabsFor = (side: 'left' | 'right'): SideTab[] => {
      const visible = side === 'left' ? get().leftVisible : get().rightVisible
      const mk = (type: string, active: boolean): SideTab => {
        const def = getView(type)
        return { type, title: def ? label(def.displayName) : type, active, closable: def?.closable !== false }
      }
      if (visible) {
        return panelsAt(api, side).map((p) => {
          const grp = (p as { group?: { activePanel?: { id?: string } } }).group
          return mk(panelType(p), grp?.activePanel?.id === p.id)
        })
      }
      const stashed = get().stash[side].length ? get().stash[side] : get().sidebarDefaults[side]
      return stashed.map((v) => mk(v.type, false))
    }
    const sideEq = (a: SideTab[], b: SideTab[]): boolean =>
      a.length === b.length && a.every((t, i) => t.type === b[i].type && t.active === b[i].active)
    const left = sideTabsFor('left')
    const right = sideTabsFor('right')
    if (!sideEq(get().leftTabs, left)) set({ leftTabs: left })
    if (!sideEq(get().rightTabs, right)) set({ rightTabs: right })
  },
  activateLeaf: (id) => {
    get().api?.getPanel(id)?.api.setActive()
    get().refreshTabs()
  },
  closeLeaf: (id) => {
    get().api?.getPanel(id)?.api.close()
    get().refreshTabs()
  },
  showSideView: (side, type) => {
    const api = get().api
    if (!api) return
    const visible = side === 'left' ? get().leftVisible : get().rightVisible
    // 已显示该视图时再点 = 收起该侧(开合切换);否则展开(若收起)并激活该视图。
    if (visible) {
      const cur = panelsAt(api, side).find((p) => {
        const grp = (p as { group?: { activePanel?: { id?: string } } }).group
        return grp?.activePanel?.id === p.id
      })
      if (cur && panelType(cur) === type) { get().toggleSidebar(side); get().refreshTabs(); return }
    } else {
      get().toggleSidebar(side) // 展开 → openView 同步还原 stash
    }
    panelsAt(get().api!, side).find((p) => panelType(p) === type)?.api.setActive()
    get().refreshTabs()
  },
  closeSideView: (side, type) => {
    const api = get().api
    if (!api) return
    panelsAt(api, side).find((p) => panelType(p) === type)?.api.close()
    get().refreshTabs()
  },

  resetLayout() {
    const api = get().api
    if (!api) return
    try { api.clear() } catch { /* ignore */ }
    clearLayout()
    set({ stash: { left: [], right: [] }, leftVisible: true, rightVisible: true, focusedChatLeafId: null })
    get().defaultBuilder?.() // 重建默认;openView 的 firstOfSide → sizeSide 按黄金分割钉宽
    scheduleWorkspaceSave()
  },

  openView(type, params = {}, loc = 'main') {
    const api = get().api
    if (!api) return null
    const def = getView(type)
    if (def?.singleton) {
      const reuseKey = params.reuseKey
      const existing = api.panels.find((p) => {
        if (panelType(p) !== type) return false
        if (reuseKey === undefined) return true
        const panelParams = (p.params ?? {}) as Record<string, unknown>
        return panelParams.reuseKey === reuseKey
          || (reuseKey === 'primary' && panelParams.reuseKey === undefined && panelParams.followActive !== false)
      })
      if (existing) {
        if (reuseKey === 'primary') existing.api.updateParameters({ ...(existing.params ?? {}), ...params })
        existing.api.setActive()
        return makeLeaf(existing)
      }
    }
    const id = def?.singleton ? type : nextId(api, type)
    const title = def ? label(def.displayName) : type
    const firstOfSide = loc !== 'main' && panelsAt(api, loc).length === 0
    const panel = api.addPanel({
      id,
      component: type,
      title,
      params: { ...params, __loc: loc, __type: type },
      position: positionFor(api, loc) as never,
    })
    // 侧栏首个 panel 创建了新组 → Dockview 默认 ~50/50 太宽,按黄金分割钉两侧 0.191×容器宽。
    if (firstOfSide) pinSides(api)
    if (loc === 'left') set({ leftVisible: true })
    if (loc === 'right') set({ rightVisible: true })
    if (type === 'chat') set({ focusedChatLeafId: panel.id })
    scheduleWorkspaceSave()
    return makeLeaf(panel)
  },

  getActiveLeaf() {
    const api = get().api
    const active = api?.activePanel
    return active ? makeLeaf(active) : null
  },

  splitActive(direction, paramsOverride) {
    const api = get().api
    const active = api?.activePanel
    if (!api || !active) return null
    const type = panelType(active)
    const { __loc, __type, ...userParams } = (active.params ?? {}) as PanelMeta & Record<string, unknown>
    void __type
    const panel = api.addPanel({
      id: nextId(api, type),
      component: type,
      title: active.title ?? type,
      params: { ...userParams, ...paramsOverride, __loc: __loc ?? 'main', __type: type },
      position: { referencePanel: active.id, direction: direction === 'right' ? 'right' : 'below' } as never,
    })
    if (type === 'chat') set({ focusedChatLeafId: panel.id })
    scheduleWorkspaceSave()
    return makeLeaf(panel)
  },

  toggleSidebar(side) {
    const api = get().api
    if (!api) return
    const visKey = side === 'left' ? 'leftVisible' : 'rightVisible'
    const panels = panelsAt(api, side)
    const visible = panels.length > 0
    if (visible) {
      // 收起:暂存内容,先把该侧宽度补间到 0(丝滑),动画结束再移除 panel。
      const stashed: Stashed[] = panels.map((p) => {
        const { __loc, __type, ...userParams } = (p.params ?? {}) as PanelMeta & Record<string, unknown>
        void __loc
        void __type
        return { type: panelType(p), params: userParams }
      })
      set((s) => ({ stash: { ...s.stash, [side]: stashed }, [visKey]: false } as Partial<WorkspaceState>))
      const group = (panels[0] as { group?: SizableGroup }).group
      if (group) {
        sidebarAnimating[side] = true
        try { group.api.setConstraints?.({ minimumWidth: 0 }) } catch { /* ignore */ } // 放开最小宽,补间能到 0
        const from = group.api.width ?? sideTargetWidth(api, side)
        tweenGroupWidth(group, from, 0, () => {
          sidebarAnimating[side] = false
          const release = lockOtherSide(api, side) // 锁住另一侧,close 释放的空白只给主区,防「突然变宽再弹回」
          panels.forEach((p) => p.api.close())
          pinSides(api) // 收起后另一侧会吃掉空白漂移 → 重新钉回 0.191
          setTimeout(release, 180) // 布局沉降后释放,恢复可手动拖宽
          scheduleWorkspaceSave()
        })
      } else {
        const release = lockOtherSide(api, side)
        panels.forEach((p) => p.api.close())
        pinSides(api)
        setTimeout(release, 180)
        scheduleWorkspaceSave()
      }
    } else {
      // 展开:还原暂存内容(pinSides 跳过本侧),把该侧宽度从 ~0 补间到黄金分割目标宽。
      const stashed = get().stash[side].length ? get().stash[side] : get().sidebarDefaults[side]
      set({ [visKey]: true } as Partial<WorkspaceState>)
      sidebarAnimating[side] = true
      stashed.forEach((v) => get().openView(v.type, v.params, side))
      const group = (panelsAt(api, side)[0] as { group?: SizableGroup } | undefined)?.group
      if (group) {
        try { group.api.setSize({ width: 1 }) } catch { /* ignore */ } // 起点贴 0,免首帧闪到默认宽
        tweenGroupWidth(group, 1, sideTargetWidth(api, side), () => {
          sidebarAnimating[side] = false
          pinSides(api)
          scheduleWorkspaceSave()
        })
      } else {
        sidebarAnimating[side] = false
        pinSides(api)
        scheduleWorkspaceSave()
      }
    }
  },

  saveCurrent() {
    const api = get().api
    if (api) saveLayout(envelope(api, get()))
  },

  saveNamed(name) {
    const api = get().api
    if (api) saveNamedLayout(name, envelope(api, get()))
  },

  applyNamed(name) {
    const api = get().api
    const blob = loadNamedLayout(name)
    if (api && blob) {
      try {
        api.fromJSON(blob.dockview as never)
        set({
          leftVisible: blob.sidebars.left.visible,
          rightVisible: blob.sidebars.right.visible,
          stash: { left: blob.sidebars.left.stash, right: blob.sidebars.right.stash },
        })
        pinSides(api)
      } catch {
        /* 损坏布局忽略 */
      }
    }
  },

  namedLayouts: () => Object.keys(listNamedLayouts()),
}))

/** 启动时尝试恢复上次布局(给 WorkspaceHost.onReady 用)。成功返回 true。 */
export function tryRestoreLayout(api: DockviewApi): boolean {
  const layout = loadLayout()
  if (!layout) return false
  try {
    api.fromJSON(layout.dockview as never)
    useWorkspace.setState({
      leftVisible: layout.sidebars.left.visible,
      rightVisible: layout.sidebars.right.visible,
      stash: { left: layout.sidebars.left.stash, right: layout.sidebars.right.stash },
    })
    const focused = api.activePanel && panelType(api.activePanel) === 'chat'
      ? api.activePanel
      : api.panels.find((p) => panelType(p) === 'chat')
    useWorkspace.getState().setFocusedLeaf(focused)
    pinSides(api)
    return api.panels.length > 0
  } catch {
    return false
  }
}

export { LAYOUT_KEY }
