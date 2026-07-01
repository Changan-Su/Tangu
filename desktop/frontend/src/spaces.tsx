/** 具体的 Space 定义 + 注册入口。Space = 取代「App」的功能组合(见 engine/types.SpaceDefinition)。
 *  每个 Space 贡献一个 ribbon 顶部图标(可拖动改序,默认排在折叠钮之下、商店之上),点击切换。
 *  Tangu Space = 现有助手界面(会话/对话/文件/目录/记忆/子聊天)。Amadeus Space 见 Milestone 2。 */
import { Bot, NotebookText } from 'lucide-react'
import { registerSpace, addRibbonIcon, useSpaceStore, setActiveSpace, useWorkspace, label } from './engine'
import type { SpaceDefinition, PersistedPanel } from './engine'
import { useApp } from './stores/appStore'
import { usePageStore } from '@amadeus/store/pageStore'

const ws = () => useWorkspace.getState()
const app = () => useApp.getState()

/** Space 的 ribbon 顶部图标:复用 .rb-btn,当前空间加 .on 高亮(订阅 activeSpaceId 自动刷新)。 */
function SpaceButton({ space, expanded }: { space: SpaceDefinition; expanded: boolean }) {
  const active = useSpaceStore((s) => s.activeSpaceId === space.id)
  const Icon = space.icon
  const name = label(space.name)
  return (
    <button
      className={`rb-btn rb-space${active ? ' on' : ''}`}
      title={expanded ? undefined : name}
      onClick={() => setActiveSpace(space.id)}
    >
      {Icon && <Icon size={18} />}
      {expanded && <span className="rb-label">{name}</span>}
    </button>
  )
}

/** Tangu Space 的侧栏默认:左=会话;右=文件/目录/记忆/子聊天 同组 tab。 */
const TANGU_SIDE_VIEWS: Record<'left' | 'right', PersistedPanel[]> = {
  left: [{ type: 'sessions', params: {} }],
  right: [
    { type: 'files', params: {} },
    { type: 'toc', params: {} },
    { type: 'memory', params: {} },
    { type: 'subchats', params: {} },
  ],
}

const tanguSpace: SpaceDefinition = {
  id: 'tangu',
  name: () => app().tr('space.tangu'),
  icon: Bot,
  sidebarDefaults: TANGU_SIDE_VIEWS,
  /** 对话(主)→ 会话(左)→ 右栏(文件 + 目录/记忆/子聊天 同组 tab)。窄屏右栏默认收起。 */
  build() {
    ws().setSidebarDefaults(TANGU_SIDE_VIEWS)
    ws().openView('chat', { followActive: true, reuseKey: 'primary' }, 'main')
    ws().openView('sessions', {}, 'left')
    if (typeof window === 'undefined' || window.innerWidth >= 1100) {
      ws().openView('files', {}, 'right')
      ws().openView('toc', {}, 'right')
      ws().openView('memory', {}, 'right')
      ws().openView('subchats', {}, 'right')
    } else {
      ws().initializeSidebar('right', false)
    }
  },
}

/** Amadeus Space 的侧栏默认:左=笔记列表;右=大纲/反链 同组 tab。 */
const AMADEUS_SIDE_VIEWS: Record<'left' | 'right', PersistedPanel[]> = {
  left: [{ type: 'amadeus-pages', params: {} }],
  right: [
    { type: 'amadeus-outline', params: {} },
    { type: 'amadeus-backlinks', params: {} },
  ],
}

const amadeusSpace: SpaceDefinition = {
  id: 'amadeus',
  name: () => app().tr('space.amadeus'),
  icon: NotebookText,
  sidebarDefaults: AMADEUS_SIDE_VIEWS,
  // 关掉主区最后一个 view → 重开编辑器(Amadeus 无启动器;× 主要用于关分屏的编辑器副本,关到最后则复位)。
  newPage() {
    ws().openView('amadeus-editor', {}, 'main')
    const p = usePageStore.getState()
    if (p.vaultRoot) void p.createPage() // 有 vault → 新建一篇空笔记并在编辑器打开(＋新建标签页语义)
  },
  /** 编辑器(主)→ 笔记列表(左)→ 右栏(大纲 + 反链 同组 tab)。 */
  build() {
    ws().setSidebarDefaults(AMADEUS_SIDE_VIEWS)
    ws().openView('amadeus-editor', {}, 'main')
    ws().openView('amadeus-pages', {}, 'left')
    ws().openView('amadeus-outline', {}, 'right')
    ws().openView('amadeus-backlinks', {}, 'right')
  },
}

/** 注册序 = ribbon 顶部默认序(在商店之上)。在 installEngine 内、商店图标注册之前调用。
 *  Amadeus 需 electron 的 window.amadeus 文件系统桥;Tangu Web(无 host)下不注册该 Space。
 *  Amadeus(Phase 4 融合中,未完工)暂对普通用户隐藏 —— 仅开发者模式(关于页连点版本号 10 次解锁,
 *  localStorage forsion_tangu_dev_mode='1')下注册其 Space + ribbon 入口;切换后需重开生效。 */
const AMADEUS_ENABLED = (() => {
  try { return localStorage.getItem('forsion_tangu_dev_mode') === '1' } catch { return false }
})()
const SPACES: SpaceDefinition[] = window.amadeus && AMADEUS_ENABLED ? [tanguSpace, amadeusSpace] : [tanguSpace]

export function registerSpaces(): void {
  for (const sp of SPACES) {
    registerSpace(sp)
    addRibbonIcon({ id: `space:${sp.id}`, side: 'top', component: ({ expanded }) => <SpaceButton space={sp} expanded={expanded} /> })
  }
}
