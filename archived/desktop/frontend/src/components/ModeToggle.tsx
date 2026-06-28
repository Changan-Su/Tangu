/** 深浅模式切换(forsion-ui mode-toggle 规范):light 显月亮、dark 显太阳;复用桌面 .icon-btn 样式。 */
import React from 'react'
import { Moon, Sun } from 'lucide-react'
import { useI18n } from '../i18n'

export const ModeToggle: React.FC<{ mode: 'light' | 'dark'; onToggle: () => void }> = ({ mode, onToggle }) => {
  const { t } = useI18n()
  return (
    <button className="icon-btn" onClick={onToggle} title={t('header.theme')}>
      {mode === 'light' ? <Moon size={16} /> : <Sun size={16} />}
    </button>
  )
}
