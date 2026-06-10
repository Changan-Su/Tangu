/** 可折叠思考块(reasoning 流;素纸下宋体淡墨,见 theme.css 的 .thinking-content)。 */
import React, { useState } from 'react'
import { ChevronRight, ChevronDown, Sparkles } from 'lucide-react'
import { AnimatedCollapse } from './AnimatedUI'

export const ThinkingBlock: React.FC<{ reasoning: string; streaming?: boolean }> = ({ reasoning, streaming }) => {
  const [open, setOpen] = useState(false)
  if (!reasoning) return null
  return (
    <div className="thinking-block">
      <button className="thinking-toggle" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Sparkles size={12} />
        {streaming ? '思考中…' : '思考过程'}
        <span style={{ opacity: 0.7 }}>({reasoning.length} 字)</span>
      </button>
      <AnimatedCollapse open={open}>
        <div className="thinking-content">{reasoning}</div>
      </AnimatedCollapse>
    </div>
  )
}
