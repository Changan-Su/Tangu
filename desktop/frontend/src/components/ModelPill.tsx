/**
 * 模型选择器 pill(参考 AionUI):圆角 pill(前导图标 + 模型名 + 下拉箭头,长名跑马灯;窄屏收成纯图标)+ 下拉菜单
 * (reasoning 组 + 模型组,分组标题吸顶,左勾号 + 高亮)+ 三态(只读「用引擎默认」/ 交互)。
 *
 * 数据源由调用方决定:Tangu 模式传 groups=按 provider 分组 + thinking;外部引擎模式传 groups=引擎模型单组、
 * 无 thinking、emptyLabel=「用引擎默认」。组件本身与数据来源无关。
 */
import React, { useEffect, useRef, useState } from 'react'
import { ChevronDown, Cpu } from 'lucide-react'
import { useI18n } from '../i18n'
import type { AgentConfig } from '../types'

export interface ModelPillOption { id: string; name: string; description?: string }
export interface ModelPillGroup { label: string; options: ModelPillOption[] }
type Thinking = NonNullable<AgentConfig['thinkingLevel']>

const thinkingLabelKey = { off: 'input.thinking.off', low: 'input.thinking.low', medium: 'input.thinking.medium', high: 'input.thinking.high' } as const
const thinkingShortKey = { off: 'input.thinkingShort.off', low: 'input.thinkingShort.low', medium: 'input.thinkingShort.medium', high: 'input.thinkingShort.high' } as const

/** 仅当文本溢出才在 hover 时跑马灯(测 scrollWidth>clientWidth → 加 class,纯 CSS 平移)。 */
const MarqueeLabel: React.FC<{ text: string }> = ({ text }) => {
  const ref = useRef<HTMLSpanElement>(null)
  const [over, setOver] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (el) setOver(el.scrollWidth > el.clientWidth + 2)
  }, [text])
  return (
    <span ref={ref} className={`pill-marquee${over ? ' is-over' : ''}`}>
      <span className="pill-marquee__inner">{text}</span>
    </span>
  )
}

export const ModelPill: React.FC<{
  disabled?: boolean
  modelId?: string
  groups: ModelPillGroup[]
  onSelect: (id: string) => void
  thinkingLevel?: Thinking
  onThinkingChange?: (lv: Thinking) => void
  /** 无可选模型时的只读标签(外部引擎:「用引擎默认」)。 */
  emptyLabel?: string
  /** 菜单底部说明(云端会话解释「为什么直连模型不在列表里」,免得用户以为丢了)。 */
  footnote?: string
  title?: string
}> = ({ disabled, modelId, groups, onSelect, thinkingLevel, onThinkingChange, emptyLabel, footnote, title }) => {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const all = groups.flatMap((g) => g.options)
  const hasModels = all.length > 0
  const current = all.find((m) => m.id === modelId)
  // 三态:无 thinking(=外部引擎模式)且无可选模型 + 有 emptyLabel → 只读 pill。
  const readonly = !onThinkingChange && !hasModels && !!emptyLabel
  const label = current?.name || emptyLabel || t('input.selectModel')
  // 未显式设置 = 引擎默认思考·中(agentLoop 同款回退)——显示必须与实际执行一致。
  const effLevel: Thinking = thinkingLevel || 'medium'
  const effort = effLevel !== 'off' ? ` · ${t(thinkingShortKey[effLevel])}` : ''

  if (readonly) {
    return (
      <span className="composer-chip composer-chip--readonly" title={title}>
        <Cpu size={13} />
        <MarqueeLabel text={label} />
      </span>
    )
  }

  return (
    <span ref={wrapRef} style={{ position: 'relative', display: 'inline-flex' }} data-cmenu>
      <button className="composer-chip" title={title || t('input.modelChipTitle')} disabled={disabled} onClick={() => setOpen((o) => !o)}>
        <Cpu size={13} />
        <MarqueeLabel text={label + effort} />
        <ChevronDown size={10} />
      </button>
      {open && (
        <div className="composer-menu right composer-menu--sticky">
          {onThinkingChange && (
            <>
              <div className="menu-section sticky">{t('input.thinkingSection')}</div>
              {(['off', 'low', 'medium', 'high'] as const).map((lv) => (
                <button
                  key={lv}
                  className={`menu-item${effLevel === lv ? ' active' : ''}`}
                  onClick={() => onThinkingChange(lv)}
                >
                  <span className="mi-check">{effLevel === lv ? '✓' : ''}</span>
                  <span className="grow">{t(thinkingLabelKey[lv])}</span>
                </button>
              ))}
            </>
          )}
          {groups.map((g) => (
            <React.Fragment key={g.label}>
              <div className="menu-section sticky">{g.label}</div>
              {g.options.map((m) => (
                <button
                  key={m.id}
                  className={`menu-item${m.id === modelId ? ' active' : ''}`}
                  title={m.description}
                  onClick={() => { onSelect(m.id); setOpen(false) }}
                >
                  <span className="mi-check">{m.id === modelId ? '✓' : ''}</span>
                  <span className="grow">{m.name}</span>
                </button>
              ))}
            </React.Fragment>
          ))}
          {!hasModels && !onThinkingChange && <div className="menu-section">{t('common.loading')}</div>}
          {footnote && <div className="menu-section" style={{ whiteSpace: 'normal', letterSpacing: 0 }}>{footnote}</div>}
        </div>
      )}
    </span>
  )
}
