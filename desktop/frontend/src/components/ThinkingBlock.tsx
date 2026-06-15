/** 可折叠思考块(reasoning 流;素纸下宋体淡墨,见 theme.css 的 .thinking-content)。 */
import React, { useState } from 'react'
import { ChevronRight, ChevronDown, Sparkles } from 'lucide-react'
import { AnimatedCollapse } from './AnimatedUI'
import { useI18n } from '../i18n'

export const ThinkingBlock: React.FC<{ reasoning: string; streaming?: boolean }> = ({ reasoning, streaming }) => {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  if (!reasoning) return null
  return (
    <div className="thinking-block">
      <button className="thinking-toggle" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Sparkles size={12} />
        {streaming ? t('thinking.thinking') : t('thinking.process')}
        <span style={{ opacity: 0.7 }}>{t('thinking.charCount', { count: reasoning.length })}</span>
      </button>
      <AnimatedCollapse open={open}>
        <div className="thinking-content">{reasoning}</div>
      </AnimatedCollapse>
    </div>
  )
}
