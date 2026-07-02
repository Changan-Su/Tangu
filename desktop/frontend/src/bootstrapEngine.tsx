/** 真实引擎装配:注册视图(会话/对话)+ ribbon + 命令 + 默认布局。替代 demoBootstrap。 */
import { MessageCircle, MessagesSquare, Plus, Command as CommandIcon, Moon, Languages, MessageSquare, FolderOpen, List, BookOpen, Bot, Smartphone, Store, Settings, NotebookText, FileText, ListTree, Link2, Search, Hash, Waypoints } from 'lucide-react'
import { registerView, addCommand, addRibbonIcon, openCommandPalette, useWorkspace, getActiveSpace, recordNav } from './engine'
import { registerSpaces } from './spaces'
import { AccountCard } from './components/AccountCard'
import { useApp } from './stores/appStore'
import { useTheme } from './stores/themeStore'
import { cycleLocale } from './i18n'
import { SessionsView } from './views/SessionsView'
import { ChatView } from './views/ChatView'
import { FilesView, TocView, MemoryPanelView, SubchatsView } from './views/RightViews'
import { NewTabView } from './views/NewTabView'
import { WeChatSpecialView, AgentsDetailSpecialView, WorkspaceDetailSpecialView } from './views/SpecialViews'
import { AmadeusPagesView, AmadeusEditorView, AmadeusOutlineView, AmadeusBacklinksView } from './amadeusViews'
import { AmadeusSearchView, AmadeusTagsView, AmadeusLocalGraphView } from './amadeusPanels'

const ws = () => useWorkspace.getState()
const app = () => useApp.getState()
export const blankNewChat = (): void => {
  const s = app()
  s.setActiveId(null)
  s.setNewChatWs(null)
  s.setNewChatCfg(() => ({}))
  s.setNewChatModel(null)
  ws().openView('chat', { followActive: true, reuseKey: 'primary' }, 'main')
}
const splitChat = (): void => {
  const active = ws().getActiveLeaf()
  if (active?.type !== 'chat') { ws().splitActive('right'); return }
  const pinned = typeof active.params.sessionId === 'string' ? active.params.sessionId : app().activeId
  ws().splitActive('right', { followActive: false, sessionId: pinned, reuseKey: `session:${pinned || 'new'}` })
}
let installed = false

export function installEngine(): void {
  if (installed) return
  installed = true

  registerView({ type: 'sessions', displayName: () => app().tr('workbench.sessions'), icon: MessagesSquare, factory: () => <SessionsView />, singleton: true, closable: false })
  // chat 可关闭(浏览器式):关掉主区最后一个 view → 显示「新建标签页」启动器(见 workspaceStore.closeLeaf)。
  registerView({ type: 'chat', displayName: () => app().tr('workbench.chat'), icon: MessageCircle, factory: (props) => <ChatView {...props} />, singleton: true })
  // 右栏视图(可关,可重开)
  registerView({ type: 'files', displayName: () => app().tr('panel.tab.workspace'), icon: FolderOpen, factory: () => <FilesView />, singleton: true })
  registerView({ type: 'toc', displayName: () => app().tr('panel.tab.toc'), icon: List, factory: () => <TocView />, singleton: true })
  registerView({ type: 'memory', displayName: () => app().tr('panel.tab.memory'), icon: BookOpen, factory: () => <MemoryPanelView />, singleton: true })
  registerView({ type: 'subchats', displayName: () => app().tr('panel.tab.subchats'), icon: MessageCircle, factory: () => <SubchatsView />, singleton: true })
  // 主区特殊视图(按需从侧栏打开,不进默认布局)
  registerView({ type: 'wechat', displayName: () => app().tr('special.wechat.title'), icon: Smartphone, factory: () => <WeChatSpecialView />, singleton: true })
  registerView({ type: 'agents-detail', displayName: () => app().tr('special.agents.title'), icon: Bot, factory: () => <AgentsDetailSpecialView />, singleton: true })
  registerView({ type: 'workspace-detail', displayName: () => app().tr('app.workspace'), icon: FolderOpen, factory: () => <WorkspaceDetailSpecialView />, singleton: true })
  // 新建标签页(空白启动器):列出所有视图按 主区/侧区 分类,选中即在对应区打开。
  registerView({ type: 'launcher', displayName: () => app().tr('newtab.title'), icon: Plus, factory: (props) => <NewTabView {...props} /> })

  // Amadeus Space:原生可停靠视图(左 笔记列表 / 主 编辑器 / 右 大纲+反链),共享 pageStore。
  // Amadeus 依赖 electron 预载的 window.amadeus 文件系统桥;Tangu Web(无 host)下缺省 → 整个 Space 不注册,
  // 与 market/feedback 的 window.tangu?.X 门控同纪律。否则视图挂载即 deref undefined amadeus 崩溃。
  if (window.amadeus) {
    registerView({ type: 'amadeus-pages', displayName: () => app().tr('amadeus.pages'), icon: NotebookText, factory: () => <AmadeusPagesView />, singleton: true, closable: false })
    // 编辑器 = 非 singleton 多实例(类 Obsidian 每笔记一个 tab,params.notePath 认领笔记并随布局持久化);
    // 可关闭:关到主区最后一个 → 走 amadeusSpace.newPage 复位(见 spaces.tsx)。
    registerView({ type: 'amadeus-editor', displayName: () => app().tr('amadeus.editor'), icon: FileText, factory: (props) => <AmadeusEditorView {...props} /> })
    registerView({ type: 'amadeus-outline', displayName: () => app().tr('amadeus.outline'), icon: ListTree, factory: () => <AmadeusOutlineView />, singleton: true })
    registerView({ type: 'amadeus-backlinks', displayName: () => app().tr('amadeus.backlinks'), icon: Link2, factory: () => <AmadeusBacklinksView />, singleton: true })
    registerView({ type: 'amadeus-search', displayName: () => app().tr('amadeus.search'), icon: Search, factory: () => <AmadeusSearchView />, singleton: true })
    registerView({ type: 'amadeus-tags', displayName: () => app().tr('amadeus.tags'), icon: Hash, factory: () => <AmadeusTagsView />, singleton: true })
    registerView({ type: 'amadeus-graph', displayName: () => app().tr('amadeus.graph'), icon: Waypoints, factory: () => <AmadeusLocalGraphView />, singleton: true })
  }

  // Space:注册(注册序 = ribbon 顶部默认序,排在商店等功能图标之上;每个 Space 贡献一个可拖动的 ribbon 顶部图标)。
  // 同时按当前活动 Space 设侧栏默认,使恢复的非 Tangu Space 在首次 toggle 前即正确。
  registerSpaces()
  const activeSpace = getActiveSpace()
  if (activeSpace) ws().setSidebarDefaults(activeSpace.sidebarDefaults)

  // 对话会话切换 → 喂主面板导航历史(Workbench 级前进/后退,箭头在引擎主区左上角常驻)。
  useApp.subscribe((s, p) => {
    const id = s.activeId
    if (!id || id === p.activeId) return
    recordNav(`chat:${id}`, () => { app().setActiveId(id); ws().openView('chat', { followActive: true, reuseKey: 'primary' }, 'main') })
  })

  // ribbon = 左侧功能条:顶部 = Space 图标组 + 商店;明暗/语言/反馈/命令面板与设置/账号移到底部常驻(在设置之上)。
  // 左右栏折叠钮在各自面板右缘(见 WorkspaceHost);ribbon 展开/折叠钮由 Ribbon 引擎自渲染在顶部。
  // 商店(装到 ~/.tangu)与反馈(submitFeedback)是 host 能力:Tangu Web 下 window.tangu 无对应方法 → 不注册。
  if (window.tangu?.marketList) addRibbonIcon({ id: 'rb-market', icon: Store, tooltip: () => app().tr('market.title'), onClick: () => app().openMarket() })
  addRibbonIcon({ id: 'rb-mode', side: 'bottom', icon: Moon, tooltip: () => app().tr('theme.changeMode'), onClick: () => useTheme.getState().toggleMode() })
  addRibbonIcon({ id: 'rb-locale', side: 'bottom', icon: Languages, tooltip: () => app().tr('locale.toggleTitle'), onClick: () => cycleLocale() })
  if (window.tangu?.submitFeedback) addRibbonIcon({ id: 'rb-feedback', side: 'bottom', icon: MessageSquare, tooltip: () => app().tr('feedback.title'), onClick: () => app().openFeedback() })
  addRibbonIcon({ id: 'rb-cmd', side: 'bottom', icon: CommandIcon, tooltip: () => app().tr('command.palette'), onClick: openCommandPalette })
  // 底部常驻(side:'bottom',不参与拖动排序),注册序即上下序:明暗/语言/反馈/命令 → 设置 → 账号(账号最底)。
  // 账号卡复用 AccountCard,随 ribbon 展开切换「完整卡 / 紧凑头像」;原聊天列表底部那份已移除,避免重复。
  addRibbonIcon({ id: 'rb-settings', side: 'bottom', icon: Settings, tooltip: () => app().tr('settings.title'), onClick: () => app().openSettings() })
  addRibbonIcon({
    id: 'rb-account',
    side: 'bottom',
    component: ({ expanded }) => (
      <AccountCard
        compact={!expanded}
        onToast={app().toast}
        onAuthChange={() => setTimeout(() => void app().connect(app().cfg), 1500)}
      />
    ),
  })

  // commands
  addCommand({ id: 'new-chat', title: () => app().tr('sidebar.newChat'), keywords: 'new chat 新对话', hotkey: 'mod+n', run: blankNewChat })
  addCommand({ id: 'toggle-left', title: () => app().tr('command.toggleLeft'), keywords: 'sidebar 左栏', hotkey: 'mod+b', run: () => ws().toggleSidebar('left') })
  addCommand({ id: 'toggle-right', title: () => app().tr('command.toggleRight'), keywords: 'sidebar 右栏', run: () => ws().toggleSidebar('right') })
  addCommand({ id: 'theme-mode', title: () => app().tr('theme.changeMode'), keywords: 'theme dark 明暗', run: () => useTheme.getState().toggleMode() })
  addCommand({ id: 'theme-skin', title: () => app().tr('theme.changeSkin'), keywords: 'theme skin 配色', run: () => useTheme.getState().cycleSkin() })
  addCommand({ id: 'theme-lang', title: () => app().tr('theme.changeLanguage'), keywords: 'theme language lovable soft', run: () => useTheme.getState().cycleLang() })
  addCommand({ id: 'split-right', title: () => app().tr('command.splitRight'), keywords: 'split 分屏', hotkey: 'mod+\\', run: splitChat })
  addCommand({ id: 'reset-layout', title: () => app().tr('command.resetLayout'), keywords: 'layout reset default 布局 默认 黄金分割', run: () => ws().resetLayout() })
  addCommand({ id: 'save-layout', title: () => app().tr('command.saveLayout'), keywords: 'layout workspace save 命名布局', run: () => {
    const name = window.prompt(app().tr('layout.namePrompt'))?.trim()
    if (name) { ws().saveNamed(name); app().toast(app().tr('layout.saved', { name })) }
  } })
  addCommand({ id: 'apply-layout', title: () => app().tr('command.applyLayout'), keywords: 'layout workspace restore 命名布局', run: () => {
    const names = ws().namedLayouts().filter((n) => !n.startsWith('space:')) // 隐藏 Space 内部保留布局
    if (!names.length) { app().toast(app().tr('layout.none')); return }
    const name = window.prompt(app().tr('layout.applyPrompt', { names: names.join(', ') }), names[0])?.trim()
    if (name && names.includes(name)) ws().applyNamed(name)
  } })
  addCommand({ id: 'stop-run', title: () => app().tr('command.stop'), keywords: 'stop 停止', run: () => app().stop() })
  addCommand({ id: 'compact', title: () => app().tr('command.compact'), keywords: 'compact 压缩', run: () => void app().compact() })
  addCommand({ id: 'branch', title: () => app().tr('command.branch'), keywords: 'branch 分支', run: () => void app().branchFromMessage() })
  addCommand({ id: 'open-settings', title: () => app().tr('settings.title'), keywords: 'settings 设置 preferences', hotkey: 'mod+,', run: () => app().openSettings() })
}

/** 默认布局 = 当前活动 Space 的 build()(WorkspaceHost 无保存布局时调用,经 buildDefault prop)。 */
export function buildDefaultLayout(): void {
  getActiveSpace()?.build()
}
