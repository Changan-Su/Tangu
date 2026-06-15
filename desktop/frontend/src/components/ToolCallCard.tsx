/**
 * 工具调用卡片(展开看参数/结果;左边线 accent,错误朱砂)。
 * 展开/状态逻辑对齐 AI Studio ToolCallBlock,标记层为 token CSS。
 */
import React, { useState } from 'react'
import { ChevronRight, ChevronDown, Loader2, CheckCircle2, XCircle, Wrench } from 'lucide-react'
import { AnimatedCollapse } from './AnimatedUI'
import { useI18n } from '../i18n'
import type { ToolEvent } from '../types'

function argsHint(args?: string): string {
  if (!args) return ''
  try {
    const o = JSON.parse(args)
    if (typeof o.command === 'string') return o.command
    if (typeof o.path === 'string') return o.path
    if (typeof o.query === 'string') return o.query
    if (typeof o.code === 'string') return o.code.split('\n')[0]
    if (typeof o.skill_id === 'string') return o.skill_id
    return args.slice(0, 120)
  } catch {
    return args.slice(0, 120)
  }
}

export const ToolCallCard: React.FC<{ ev: ToolEvent }> = ({ ev }) => {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  return (
    <div className={`tool-card${ev.isError ? ' err' : ''}`}>
      <button className="tool-card-head" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Wrench size={12} />
        <span className="tool-name">{ev.name}</span>
        <span className="tool-hint">{argsHint(ev.arguments)}</span>
        {!ev.done && <Loader2 size={13} className="spin" />}
        {ev.done && !ev.isError && <CheckCircle2 size={13} style={{ color: 'var(--green)' }} />}
        {ev.done && ev.isError && <XCircle size={13} style={{ color: 'var(--danger)' }} />}
      </button>
      <AnimatedCollapse open={open}>
        <div className="tool-card-body">
          {ev.arguments && (
            <>
              <div className="label">{t('tool.argsLabel')}</div>
              {formatArgs(ev.arguments)}
            </>
          )}
          {ev.result !== undefined && (
            <>
              <div className="label">{t('tool.resultLabel')}</div>
              {ev.result || t('tool.empty')}
            </>
          )}
        </div>
      </AnimatedCollapse>
    </div>
  )
}

function formatArgs(args: string): string {
  try {
    return JSON.stringify(JSON.parse(args), null, 2)
  } catch {
    return args
  }
}
