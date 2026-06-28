/** 新建标签页(空白启动器):点主区标签栏末尾的 ＋ 打开。列出所有视图,按「主区 / 侧栏」分类;
 *  选中即在对应区打开,并关闭本空白页(空白页「变成」所选视图)。 */
import { type ReactNode } from 'react'
import { Plus, Smartphone, Bot, FolderOpen, List, BookOpen, MessageCircle } from 'lucide-react'
import { useApp } from '../stores/appStore'
import { openSpecial } from './SpecialViews'
import { useWorkspace } from '../engine'
import { useI18n } from '../i18n'
import type { ViewProps } from '../engine/types'
import { useShallow } from 'zustand/react/shallow'

interface Item { key: string; icon: ReactNode; label: string; run: () => void; show: boolean }

export function NewTabView({ leaf }: ViewProps) {
  const { t } = useI18n()
  const s = useApp(useShallow((state) => ({
    specialEnabled: state.specialEnabled,
    setActiveId: state.setActiveId,
    setNewChatWs: state.setNewChatWs,
    setNewChatCfg: state.setNewChatCfg,
    setNewChatModel: state.setNewChatModel,
  })))
  const hasBackend = !!window.tangu?.backendStatus
  const newChat = (): void => {
    s.setActiveId(null); s.setNewChatWs(null); s.setNewChatCfg(() => ({})); s.setNewChatModel(null)
    useWorkspace.getState().openView('chat', { followActive: true, reuseKey: 'primary' }, 'main')
  }
  const openSide = (type: string): void => { useWorkspace.getState().openView(type, {}, 'right') }

  const main: Item[] = [
    { key: 'chat', icon: <MessageCircle size={20} />, label: t('sidebar.newChat'), run: newChat, show: true },
    { key: 'wechat', icon: <Smartphone size={20} />, label: t('special.wechat.title'), run: () => openSpecial('wechat'), show: hasBackend },
    { key: 'agents', icon: <Bot size={20} />, label: t('special.agents.title'), run: () => openSpecial('agents'), show: hasBackend && (s.specialEnabled.historian || s.specialEnabled.muse) },
  ]
  const side: Item[] = [
    { key: 'files', icon: <FolderOpen size={20} />, label: t('panel.tab.workspace'), run: () => openSide('files'), show: true },
    { key: 'toc', icon: <List size={20} />, label: t('panel.tab.toc'), run: () => openSide('toc'), show: true },
    { key: 'memory', icon: <BookOpen size={20} />, label: t('panel.tab.memory'), run: () => openSide('memory'), show: true },
    { key: 'subchats', icon: <MessageCircle size={20} />, label: t('panel.tab.subchats'), run: () => openSide('subchats'), show: true },
  ]
  // 选中:先在对应区打开,再关闭本空白页 → 视觉上「空白页变成所选视图」。
  const pick = (it: Item): void => { it.run(); leaf.close() }

  const section = (title: string, items: Item[]): ReactNode => {
    const shown = items.filter((i) => i.show)
    if (!shown.length) return null
    return (
      <div className="newtab-sec">
        <div className="newtab-sec-title">{title}</div>
        <div className="newtab-grid">
          {shown.map((it) => (
            <button key={it.key} className="newtab-card" onClick={() => pick(it)}>
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
        {section(t('newtab.mainSection'), main)}
        {section(t('newtab.sideSection'), side)}
      </div>
    </div>
  )
}
