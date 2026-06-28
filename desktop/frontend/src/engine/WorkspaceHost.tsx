/**
 * Dockview 引导:把 viewRegistry 的视图编为 Dockview components(每个包一层 ViewHost,
 * 从 panel props 造 Leaf 再调 def.factory)。onReady 恢复上次布局,否则调 buildDefault;
 * 布局变更持久化。主题叠 dockview-theme-light|dark + .dockview-theme-lcl(--dv-* → LCL token)。
 */
import { useEffect, useMemo, useState } from 'react'
import {
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type IDockviewPanelHeaderProps,
  type IDockviewHeaderActionsProps,
  type DockviewTheme,
} from 'dockview-react'
import { X, Plus, PanelLeft, PanelRight } from 'lucide-react'
import { createPortal } from 'react-dom'
import 'dockview-react/dist/styles/dockview.css'
import type { Leaf, ViewDefinition } from './types'
import { label } from './types'
import { allViews, getView, subscribeViews } from './viewRegistry'
import { useWorkspace, tryRestoreLayout, scheduleWorkspaceSave } from './workspaceStore'

/** 从 Dockview panel props 造引擎 Leaf。 */
function leafFromProps(props: IDockviewPanelProps): Leaf {
  const raw = (props.params ?? {}) as Record<string, unknown>
  const { __loc, __type, ...userParams } = raw
  void __loc
  return {
    id: props.api.id,
    type: (typeof __type === 'string' && __type) || (props.api as { component?: string }).component || '',
    params: userParams,
    setTitle: (t) => props.api.setTitle(t),
    setParams: (p) => props.api.updateParameters({ ...raw, ...p }),
    close: () => props.api.close(),
  }
}

// 主区「上一次显示的视图类型」(模块级,跨重挂载存活)。Dockview renderer='onlyWhenVisible':
// 收/展侧栏会重挂主区面板 → 若每次挂载都播淡入,就会「整页闪一下」。只在**视图类型真的变了**时播,
// 同类型重挂(布局抖动引起)不播 → 收/展侧栏不闪,真正切视图(对话↔微信↔…)才淡入。
let lastMainViewType: string | undefined

/** 把一个 ViewDefinition 编成 Dockview 组件。 */
function makeComponent(def: ViewDefinition): React.FC<IDockviewPanelProps> {
  return function ViewHost(props) {
    const leaf = leafFromProps(props)
    const loc = ((props.params ?? {}) as { __loc?: string }).__loc ?? 'main'
    const [enter] = useState(() => {
      if (loc !== 'main') return false // 仅主区做切换淡入;侧栏靠自身宽度补间,别再叠淡入
      const changed = lastMainViewType !== def.type
      lastMainViewType = def.type
      return changed
    })
    return <div className={`wb-view${enter ? ' wb-view-enter' : ''}`}>{def.factory({ leaf, params: leaf.params })}</div>
  }
}

/** Surface tab = 图标 + 名称;Obsidian 层级,平整无圆角。无内联 × 关闭钮 —— 关闭走右键菜单(更干净)。
 *  侧栏(left/right)tab 仅图标(名入 tooltip,免文字 tab 溢出,贴合 Obsidian);主区 tab 图标 + 名称。 */
const WbTab: React.FC<IDockviewPanelHeaderProps> = ({ api, params }) => {
  const type = ((params as { __type?: string } | undefined)?.__type) || (api as { component?: string }).component || ''
  const def = getView(type)
  const Icon = def?.icon
  const closable = def?.closable !== false
  const loc = (params as { __loc?: string } | undefined)?.__loc
  const iconOnly = loc === 'left' || loc === 'right'
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    return () => { window.removeEventListener('click', close); window.removeEventListener('contextmenu', close) }
  }, [menu])
  return (
    <div
      className={`wb-tab${iconOnly ? ' wb-tab--icon' : ''}${loc === 'left' ? ' wb-tab--left' : ''}`}
      title={api.title}
      onContextMenu={closable ? (e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY }) } : undefined}
    >
      {Icon && <Icon size={iconOnly ? 15 : 13} className="wb-tab-ic" />}
      {!iconOnly && <span className="wb-tab-name">{api.title}</span>}
      {menu && createPortal(
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
          <button onClick={() => { api.close(); setMenu(null) }}>
            <X size={13} /> {document.documentElement.lang.startsWith('zh') ? '关闭' : 'Close'}
          </button>
        </div>,
        document.body,
      )}
    </div>
  )
}

function lclTheme(dark: boolean, soft: boolean): DockviewTheme {
  return {
    name: dark ? 'lcl-dark' : 'lcl-light',
    className: `dockview-theme-${dark ? 'dark' : 'light'} dockview-theme-lcl`,
    colorScheme: dark ? 'dark' : 'light',
    gap: soft ? 8 : 0, // soft 时各组拉开 → 配合卡片化成独立浮卡
    tabAnimation: 'smooth',
    dndOverlayMounting: 'relative',
  }
}

/** 仅主区组渲染(左/右侧栏组返回 null)。 */
function isMainGroup(panels: IDockviewHeaderActionsProps['panels']): boolean {
  return panels.some((p) => { const loc = (p.params as { __loc?: string } | undefined)?.__loc; return !loc || loc === 'main' })
}

/** 主区组标签栏左侧前缀:左栏折叠钮(在左panel右缘)。主区常驻 →
 *  折叠左栏后此钮仍在原处(左panel右缘=主区左缘),可重开。 */
function makePrefixActions(): React.FC<IDockviewHeaderActionsProps> {
  return function PrefixActions({ panels }) {
    if (!isMainGroup(panels)) return null
    const zh = document.documentElement.lang.startsWith('zh')
    return (
      <div className="dv-prefix">
        <button className="dv-edge-toggle" title={zh ? '左侧栏' : 'Toggle left panel'} onClick={() => useWorkspace.getState().toggleSidebar('left')}>
          <PanelLeft size={15} />
        </button>
      </div>
    )
  }
}

/** 主区组标签栏「所有 tab 之后」的 ＋:打开空白启动器(launcher/NewTabView),选视图后空白页变成它。 */
function makeSuffixActions(): React.FC<IDockviewHeaderActionsProps> {
  return function SuffixActions({ panels }) {
    if (!isMainGroup(panels)) return null
    const zh = document.documentElement.lang.startsWith('zh')
    return (
      <button className="dv-new-tab" title={zh ? '新建标签页' : 'New tab'} onClick={() => useWorkspace.getState().openView('launcher', {}, 'main')}>
        <Plus size={15} />
      </button>
    )
  }
}

export const WorkspaceHost: React.FC<{
  dark: boolean
  soft: boolean
  buildDefault?: () => void
}> = ({ dark, soft, buildDefault }) => {
  // 视图注册表 → Dockview components map(注册变化时重建,支持运行期注册)。
  const [version, setVersion] = useState(0)
  useEffect(() => subscribeViews(() => setVersion((v) => v + 1)), [])
  const components = useMemo(() => {
    const map: Record<string, React.FC<IDockviewPanelProps>> = {}
    for (const def of allViews()) map[def.type] = makeComponent(def)
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version])
  const prefixActions = useMemo(() => makePrefixActions(), [])
  const suffixActions = useMemo(() => makeSuffixActions(), [])

  const onReady = (e: DockviewReadyEvent): void => {
    const ws = useWorkspace.getState()
    ws.setApi(e.api)
    if (buildDefault) ws.setDefaultBuilder(buildDefault) // 供「恢复默认布局」复用
    const restored = tryRestoreLayout(e.api)
    if (!restored) {
      try {
        e.api.clear()
      } catch {
        /* ignore */
      }
      buildDefault?.()
    }
    const syncLayout = (): void => {
      ws.syncPanelState()
      scheduleWorkspaceSave()
    }
    e.api.onDidLayoutChange(syncLayout)
    e.api.onDidActivePanelChange(({ panel }) => ws.setFocusedLeaf(panel))
    const activeType = ((e.api.activePanel?.params ?? {}) as { __type?: string }).__type
    ws.setFocusedLeaf(activeType === 'chat' ? e.api.activePanel : e.api.panels.find((panel) => ((panel.params ?? {}) as { __type?: string }).__type === 'chat'))
  }

  return (
    <>
      <DockviewReact
        className={`wb-dockview${soft ? ' wb-soft' : ''}`}
        theme={lclTheme(dark, soft)}
        defaultTabComponent={WbTab}
        prefixHeaderActionsComponent={prefixActions}
        rightHeaderActionsComponent={suffixActions}
        components={components}
        onReady={onReady}
      />
      {/* 右栏折叠钮:浮在工作区右上角(=右panel最右缘);右栏收起后仍在原处,可重开。 */}
      <button
        className="dv-edge-toggle dv-edge-right"
        title={document.documentElement.lang.startsWith('zh') ? '右侧栏' : 'Toggle right panel'}
        onClick={() => useWorkspace.getState().toggleSidebar('right')}
      >
        <PanelRight size={15} />
      </button>
    </>
  )
}

export { label }
