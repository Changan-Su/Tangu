/** 新建标签页(空白启动器):点主区标签栏末尾的 ＋ 打开,所有 Space 统一用它。
 *  三段:最近使用(精准视图:某篇笔记/某个会话)→ 主区视图 → 侧栏视图;
 *  主区列表按当前 Space 给,侧栏列表直接取 Space 的 sidebarDefaults(名称/图标查视图注册表)。
 *  选中即在对应区打开,并关闭本空白页(空白页「变成」所选视图)。 */
import { type ReactNode } from 'react'
import { Plus, SquarePen, Smartphone, Bot, MessageCircle, FileText, CalendarDays } from 'lucide-react'
import { useApp } from '../stores/appStore'
import { openSpecial } from './SpecialViews'
import { useWorkspace, useSpaceStore, getActiveSpace, getView, label } from '../engine'
import { useRecentViews } from '../recentViews'
import { usePageStore } from '@amadeus/store/pageStore'
import { openNote } from '../amadeusNav'
import { openDailyNote } from '../amadeusTemplates'
import { useI18n } from '../i18n'
import type { ViewProps } from '../engine/types'
import { useShallow } from 'zustand/react/shallow'

interface Item { key: string; icon: ReactNode; label: string; run: () => void; show: boolean }

export function NewTabView({ leaf }: ViewProps) {
  const { t } = useI18n()
  const s = useApp(useShallow((state) => ({
    specialEnabled: state.specialEnabled,
    sessions: state.sessions,
    setActiveId: state.setActiveId,
    setNewChatWs: state.setNewChatWs,
    setNewChatCfg: state.setNewChatCfg,
    setNewChatModel: state.setNewChatModel,
  })))
  useSpaceStore((state) => state.activeSpaceId) // 仅订阅换 Space 重渲
  // 逻辑一律用注册表解析后的 Space:持久化的 activeSpaceId 可能指向未注册空间(如关掉开发者模式后的
  // 'amadeus'),getActiveSpace 会回落首个注册空间——主区/侧栏/最近三段必须同源,否则错配。
  const spaceId = getActiveSpace()?.id ?? 'tangu'
  const recents = useRecentViews((state) => state.items)
  const vaultRoot = usePageStore((state) => state.vaultRoot)
  const pages = usePageStore((state) => state.pages)
  const hasBackend = !!window.tangu?.backendStatus
  const ws = () => useWorkspace.getState()

  const newChat = (): void => {
    s.setActiveId(null); s.setNewChatWs(null); s.setNewChatCfg(() => ({})); s.setNewChatModel(null)
    ws().openView('chat', { followActive: true, reuseKey: 'primary' }, 'main')
  }
  /** 编辑器是非 singleton(每笔记一 tab):已有编辑器 tab 时别再开,否则每次都多出一个空 tab。 */
  const ensureEditor = (): void => {
    if (!useWorkspace.getState().mainTabs.some((t) => t.type === 'amadeus-editor')) {
      ws().openView('amadeus-editor', {}, 'main')
    }
  }
  const newNote = (): void => {
    ensureEditor()
    if (vaultRoot) void usePageStore.getState().createPage()
  }

  // 主区视图按 Space 给(主视图没有注册表级的归属声明,此处是唯一清单)。
  const main: Item[] =
    spaceId === 'amadeus'
      ? [
          { key: 'new-note', icon: <SquarePen size={20} />, label: t('newtab.newNote'), run: newNote, show: true },
          { key: 'daily', icon: <CalendarDays size={20} />, label: t('newtab.today'), run: () => { ensureEditor(); void openDailyNote() }, show: !!vaultRoot },
        ]
      : [
          { key: 'chat', icon: <MessageCircle size={20} />, label: t('sidebar.newChat'), run: newChat, show: true },
          { key: 'wechat', icon: <Smartphone size={20} />, label: t('special.wechat.title'), run: () => openSpecial('wechat'), show: hasBackend },
          { key: 'agents', icon: <Bot size={20} />, label: t('special.agents.title'), run: () => openSpecial('agents'), show: hasBackend && (s.specialEnabled.historian || s.specialEnabled.muse) },
        ]

  // 侧栏视图 = 当前 Space 的 sidebarDefaults(左右两栏),名称/图标查视图注册表。
  // 打开顺序:该侧收起时先 toggleSidebar 展开(同步还原 stash 里的全部视图——直接 openView 会把
  // stash 覆盖成单视图),再 openView 激活/补开目标;不用 showSideView(它是开合切换,已激活会反向收起)。
  const space = getActiveSpace()
  const side: Item[] = (['left', 'right'] as const).flatMap((loc) =>
    (space?.sidebarDefaults[loc] ?? []).map((p) => {
      const def = getView(p.type)
      const Icon = def?.icon
      return {
        key: `${loc}:${p.type}`,
        icon: Icon ? <Icon size={20} /> : <FileText size={20} />,
        label: def ? label(def.displayName) : p.type,
        run: () => {
          const w = useWorkspace.getState()
          const visible = loc === 'left' ? w.leftVisible : w.rightVisible
          if (!visible) w.toggleSidebar(loc)
          ws().openView(p.type, {}, loc)
        },
        show: !!def,
      }
    }),
  )

  // 最近使用:精准视图快捷跳转,按当前 Space 过滤(笔记→Amadeus,会话→Tangu);会话标题用实时值覆盖快照。
  // 只显示仍然存在的目标:已删除的笔记若点开,loadPage 的「缺文件即新建」语义会把它复活成空文件。
  const recentItems: Item[] = recents
    .filter((r) => (spaceId === 'amadeus' ? r.kind === 'note' : r.kind === 'chat'))
    .filter((r) => (r.kind === 'note' ? pages.includes(r.id) : s.sessions.some((x) => x.id === r.id)))
    .slice(0, 8)
    .map((r) => ({
      key: r.key,
      icon: r.kind === 'note' ? <FileText size={20} /> : <MessageCircle size={20} />,
      label: (r.kind === 'chat' && s.sessions.find((x) => x.id === r.id)?.title) || r.title,
      run: r.kind === 'note'
        ? () => void openNote(r.id)
        : () => { s.setActiveId(r.id); ws().openView('chat', { followActive: true, reuseKey: 'primary' }, 'main') },
      show: true,
    }))

  // 选中:先在对应区打开,再关闭本空白页 → 视觉上「空白页变成所选视图」。
  // 必须走 store 的 closeLeaf(而非 leaf.close 裸关):它带「主区关空即回填」兜底——选侧栏项时
  // 主区若只剩本启动器,裸关会留下零面板的主区,后续 openView 会把主区视图错落进侧栏并被持久化。
  const pick = (it: Item): void => { it.run(); useWorkspace.getState().closeLeaf(leaf.id) }

  const section = (title: string, items: Item[]): ReactNode => {
    const shown = items.filter((i) => i.show)
    if (!shown.length) return null
    return (
      <div className="newtab-sec">
        <div className="newtab-sec-title">{title}</div>
        <div className="newtab-grid">
          {shown.map((it) => (
            <button key={it.key} className="newtab-card" title={it.label} onClick={() => pick(it)}>
              <span className="newtab-card-ic">{it.icon}</span>
              <span className="newtab-card-label">{it.label}</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="newtab">
      <div className="newtab-inner">
        <div className="newtab-head"><Plus size={18} /> <span>{t('newtab.title')}</span></div>
        {section(t('newtab.recentSection'), recentItems)}
        {section(t('newtab.mainSection'), main)}
        {section(t('newtab.sideSection'), side)}
      </div>
    </div>
  )
}
