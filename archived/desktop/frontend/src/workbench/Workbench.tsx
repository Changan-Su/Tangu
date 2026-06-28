/**
 * Dockview 可停靠工作台(Frame/Surface/Block 的「Frame=停靠区」层)。
 * 停靠区(Surface):**navigator「工作会话」(左,会话/工作区列表)** | **center(中,对话/特殊视图,锁定满铺无 tab)** |
 * **右组 文件/目录/记忆/子聊天(可拖拽停靠/调宽/成组/分离)**。每个 Surface 的 tab = 图标 + 名称(Obsidian 式)。
 * navigator 与右组可拖拽移动;center 锁定。设置/引导打开时由 navVisible/rightVisible=false 让 center 独占满铺。
 *
 * 面板内容用 React Context 注入实时 JSX(SlotCtx):App 照常构 <Sidebar/>/<ChatArea/>/<RightPanel/>。
 * 布局序列化进 localStorage(forsion_tangu_layout),坏布局/缺 center 回退默认。
 * 主题叠 dockview-theme-light|dark + 自定义 .dockview-theme-lcl 覆盖 --dv-* 到 LCL token;
 * soft 语言时 theme.gap=8 + 每组卡片化(见 themes/soft)→ 独立浮卡;tabAnimation:'smooth' 丝滑移动。
 */
import React, { useContext, useEffect, useRef } from 'react'
import {
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type IDockviewPanelHeaderProps,
  type DockviewApi,
  type DockviewTheme,
} from 'dockview-react'
import { FolderOpen, List, BookOpen, MessageCircle, MessagesSquare, X, type LucideIcon } from 'lucide-react'
import 'dockview-react/dist/styles/dockview.css'
import '../styles/workbench.css'

export interface WorkbenchSlots {
  navigator: React.ReactNode
  center: React.ReactNode
  workspace: React.ReactNode
  toc: React.ReactNode
  memory: React.ReactNode
  subchats: React.ReactNode
}

const SlotCtx = React.createContext<WorkbenchSlots | null>(null)

function makeSurface(key: keyof WorkbenchSlots, cls: string): React.FC<IDockviewPanelProps> {
  return function Surface() {
    const slots = useContext(SlotCtx)
    return <div className={cls}>{slots?.[key]}</div>
  }
}

const components: Record<string, React.FC<IDockviewPanelProps>> = {
  navigator: makeSurface('navigator', 'wb-nav'),
  center: makeSurface('center', 'wb-center'),
  workspace: makeSurface('workspace', 'wb-surface'),
  toc: makeSurface('toc', 'wb-surface'),
  memory: makeSurface('memory', 'wb-surface'),
  subchats: makeSurface('subchats', 'wb-surface'),
}

// Surface tab = 图标 + 名称(Obsidian 层级)。center 锁定无 tab,故不入表。
const TAB_ICONS: Record<string, LucideIcon> = {
  navigator: MessagesSquare,
  workspace: FolderOpen,
  toc: List,
  memory: BookOpen,
  subchats: MessageCircle,
}
const NON_CLOSABLE = new Set(['navigator', 'center']) // 主区/导航不可关(只可拖移/收起),防误删

const WbTab: React.FC<IDockviewPanelHeaderProps> = ({ api }) => {
  const Icon = TAB_ICONS[api.id]
  return (
    <div className="wb-tab" title={api.title}>
      {Icon && <Icon size={13} className="wb-tab-ic" />}
      <span className="wb-tab-name">{api.title}</span>
      {!NON_CLOSABLE.has(api.id) && (
        <span className="wb-tab-x" onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); api.close() }}>
          <X size={12} />
        </span>
      )}
    </div>
  )
}

const LAYOUT_KEY = 'forsion_tangu_layout'
const RIGHT_IDS = ['workspace', 'toc', 'memory', 'subchats'] as const

function addNav(api: DockviewApi, t: (k: string) => string): void {
  // navigator「工作会话」:显示 tab(图标+名),可拖拽移动,不可关(WbTab 判 id);收起走顶栏「侧栏」按钮。
  api.addPanel({ id: 'navigator', component: 'navigator', title: t('workbench.sessions'), position: { referencePanel: 'center', direction: 'left' } })
}

function addRightGroup(api: DockviewApi, t: (k: string) => string): void {
  api.addPanel({ id: 'workspace', component: 'workspace', title: t('panel.tab.workspace'), position: { referencePanel: 'center', direction: 'right' } })
  for (const id of ['toc', 'memory', 'subchats']) {
    api.addPanel({ id, component: id, title: t(`panel.tab.${id}`), position: { referencePanel: 'workspace', direction: 'within' } })
  }
}

function buildDefault(api: DockviewApi, withNav: boolean, withRight: boolean, t: (k: string) => string): void {
  const center = api.addPanel({ id: 'center', component: 'center', title: 'Tangu' })
  // 中间对话:锁定 + 隐藏 tab 条(主编辑区满铺,不可关/不可拖走)。
  try { center.group.locked = true } catch { /* 跨版本兜底 */ }
  try { center.group.header.hidden = true } catch { /* ignore */ }
  if (withNav) addNav(api, t)
  if (withRight) addRightGroup(api, t)
}

// 黄金分割默认:左右组各占 ~0.191,中心自动得 0.618。容器首帧可能 0 宽 → rAF 兜底。
// 仅用于「默认布局 / 收起后重新展开」;用户拖动后的尺寸由 toJSON 持久化,不被覆盖。
const SIDE_FRACTION = 0.191
function sizeSide(api: DockviewApi, panelId: string): void {
  const run = (): void => {
    const W = api.width
    if (!W) return
    try { api.getPanel(panelId)?.group.api.setSize({ width: Math.round(W * SIDE_FRACTION) }) } catch { /* 跨版本兜底 */ }
  }
  const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null
  if (raf) raf(run); else run()
}

function lclTheme(dark: boolean, soft: boolean): DockviewTheme {
  return {
    name: dark ? 'lcl-dark' : 'lcl-light',
    className: `dockview-theme-${dark ? 'dark' : 'light'} dockview-theme-lcl`,
    colorScheme: dark ? 'dark' : 'light',
    gap: soft ? 8 : 0, // soft(Dreamer)时各组拉开间隔 → 配合卡片化成独立浮卡
    tabAnimation: 'smooth', // tab 重排丝滑滑动
    dndOverlayMounting: 'relative', // 拖拽放置浮层贴合目标组,过渡更圆润
  }
}

export const Workbench: React.FC<{
  slots: WorkbenchSlots
  dark: boolean
  soft: boolean
  navVisible: boolean
  rightVisible: boolean
  t: (k: string) => string
}> = ({ slots, dark, soft, navVisible, rightVisible, t }) => {
  const apiRef = useRef<DockviewApi | null>(null)
  const firstNav = useRef(true)
  const firstRight = useRef(true)
  const navInit = useRef(navVisible)
  const rightInit = useRef(rightVisible)

  const onReady = (e: DockviewReadyEvent): void => {
    apiRef.current = e.api
    let restored = false
    try {
      const raw = localStorage.getItem(LAYOUT_KEY)
      if (raw) { e.api.fromJSON(JSON.parse(raw)); restored = e.api.panels.length > 0 }
    } catch { restored = false }
    if (!restored || !e.api.getPanel('center')) {
      try { e.api.clear() } catch { /* ignore */ }
      buildDefault(e.api, navInit.current, rightInit.current, t)
      sizeSide(e.api, 'navigator')
      sizeSide(e.api, 'workspace')
    }
    e.api.onDidLayoutChange(() => {
      try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(e.api.toJSON())) } catch { /* private mode */ }
    })
  }

  // 左导航显隐(顶栏「侧栏」按钮 / 进设置时收起):首跑跳过(信任已恢复/默认布局),之后增删导航组。
  useEffect(() => {
    if (firstNav.current) { firstNav.current = false; return }
    const api = apiRef.current
    if (!api) return
    const has = !!api.getPanel('navigator')
    if (navVisible && !has) { if (api.getPanel('center')) addNav(api, t) }
    else if (!navVisible && has) { const p = api.getPanel('navigator'); if (p) api.removePanel(p) }
  }, [navVisible, t])

  // 右栏显隐(顶栏「右栏」按钮 / 进设置时收起)。
  useEffect(() => {
    if (firstRight.current) { firstRight.current = false; return }
    const api = apiRef.current
    if (!api) return
    const has = RIGHT_IDS.some((id) => api.getPanel(id))
    if (rightVisible && !has) { if (api.getPanel('center')) addRightGroup(api, t) }
    else if (!rightVisible && has) { for (const id of RIGHT_IDS) { const p = api.getPanel(id); if (p) api.removePanel(p) } }
  }, [rightVisible, t])

  return (
    <SlotCtx.Provider value={slots}>
      <DockviewReact
        className={`wb-dockview${soft ? ' wb-soft' : ''}`}
        theme={lclTheme(dark, soft)}
        defaultTabComponent={WbTab}
        components={components}
        onReady={onReady}
      />
    </SlotCtx.Provider>
  )
}
