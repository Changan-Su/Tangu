/**
 * Obsidian 式左侧 ribbon:常驻细图标条(在 Dockview 工作台之外),承载 app 级控制。
 * 当前:账户(头像→个人中心/登录)+ 设置。常驻 → 不管左侧停靠的是哪个面板,账户/设置都在。
 * 顶部留空可拖拽区(macOS 交通灯落此,不与内容冲突);内容底部对齐。
 */
import React from 'react'
import { Settings } from 'lucide-react'
import { useI18n } from '../i18n'
import { AccountCard } from './AccountCard'

export const Ribbon: React.FC<{
  onOpenSettings: () => void
  onToast?: (text: string, error?: boolean) => void
  onAuthChange?: () => void
}> = ({ onOpenSettings, onToast, onAuthChange }) => {
  const { t } = useI18n()
  return (
    <div className="ribbon">
      <div className="ribbon-spacer" />
      <AccountCard compact onToast={onToast} onAuthChange={onAuthChange} />
      <button className="icon-btn" onClick={onOpenSettings} title={t('sidebar.settings')}>
        <Settings size={16} />
      </button>
    </div>
  )
}
