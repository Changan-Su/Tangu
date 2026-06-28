/**
 * 设置 → 智能体:把 Normal Agent 与 后台智能体(Special)合并到同一界面。
 * 编辑某个 Normal Agent 时隐藏下半部分(专注表单)。
 */
import React, { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { AgentsTab } from './AgentsTab'
import { SpecialAgentsTab } from './SpecialAgentsTab'
import type { TanguDesktopConfig } from '../types'
import { useI18n } from '../i18n'

export const AgentsSettings: React.FC<{ cfg: TanguDesktopConfig }> = ({ cfg }) => {
  const { t } = useI18n()
  const [editing, setEditing] = useState(false)
  return (
    <>
      <AgentsTab cfg={cfg} onEditingChange={setEditing} />
      {!editing && (
        <>
          <hr className="settings-divider" />
          <div className="settings-section-title"><Sparkles size={15} /> {t('settings.special.sectionTitle')}</div>
          <SpecialAgentsTab cfg={cfg} />
        </>
      )}
    </>
  )
}
