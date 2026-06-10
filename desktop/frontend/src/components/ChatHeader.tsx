/** 顶栏:侧栏开关 + 会话标题 + 模型 + 连接状态 + 右栏开关。整条可拖拽(Electron hiddenInset)。 */
import React from 'react'
import { PanelLeft, PanelRight, Settings } from 'lucide-react'

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
}> = (p) => (
  <header className="chat-header">
    <button className="icon-btn" onClick={p.onToggleSidebar} title="侧栏">
      <PanelLeft size={16} />
    </button>
    <div className="chat-title">{p.title}</div>
    {p.modelId ? <span className="conn-pill" title="当前模型">{p.modelId}</span> : null}
    <span className={`conn-pill ${p.connState}`} title={p.connMessage}>
      <span className="dot" />
      {p.connState === 'ok' ? '在线' : p.connState === 'err' ? '离线' : '未连接'}
    </span>
    <button className={`icon-btn${p.rightOpen ? ' active' : ''}`} onClick={p.onToggleRight} title="工作区面板">
      <PanelRight size={16} />
    </button>
    <button className="icon-btn" onClick={p.onOpenSettings} title="设置">
      <Settings size={16} />
    </button>
  </header>
)
