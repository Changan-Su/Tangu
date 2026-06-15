/** 顶栏:侧栏开关 + 会话标题 + 模型 + 连接状态 + 右栏开关。整条可拖拽(Electron hiddenInset)。 */
import React from 'react'
import { PanelLeft, PanelRight, Settings } from 'lucide-react'
import { useI18n } from '../i18n'

export const ChatHeader: React.FC<{
  title: string
  modelId: string
  connState: 'idle' | 'ok' | 'err'
  connMessage: string
  sidebarCollapsed: boolean
  rightOpen: boolean
  onToggleSidebar: () => void
  onToggleRight: () => void
  onOpenSettings: () => void
}> = (p) => {
  const { t } = useI18n()
  return (
    <header className="chat-header">
      <button className="icon-btn" onClick={p.onToggleSidebar} title={t('header.sidebar')}>
        <PanelLeft size={16} />
      </button>
      <div className="chat-title">{p.title}</div>
      {p.modelId ? <span className="conn-pill" title={t('header.currentModel')}>{p.modelId}</span> : null}
      <span className={`conn-pill ${p.connState}`} title={p.connMessage}>
        <span className="dot" />
        {p.connState === 'ok' ? t('header.online') : p.connState === 'err' ? t('header.offline') : t('header.notConnected')}
      </span>
      <button className={`icon-btn${p.rightOpen ? ' active' : ''}`} onClick={p.onToggleRight} title={t('header.workspacePanel')}>
        <PanelRight size={16} />
      </button>
      <button className="icon-btn" onClick={p.onOpenSettings} title={t('header.settings')}>
        <Settings size={16} />
      </button>
    </header>
  )
}
