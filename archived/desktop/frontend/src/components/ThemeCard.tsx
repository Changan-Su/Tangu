/** 主题选择卡片(preview 数据驱动,机制对齐 AI Studio ThemeCard)。 */
import React from 'react'
import type { ThemeEntry } from '../theme/registry'

export const ThemeCard: React.FC<{
  entry: ThemeEntry
  mode: 'light' | 'dark'
  active: boolean
  onSelect: () => void
}> = ({ entry, mode, active, onSelect }) => {
  const { preview } = entry.manifest
  const bg = typeof preview.background === 'string' ? preview.background : preview.background[mode]
  return (
    <button className={`theme-card${active ? ' active' : ''}`} onClick={onSelect}>
      <div className="theme-preview" style={{ background: bg }} />
      <div className="theme-meta">
        <div className="theme-name">{preview.title?.text || entry.manifest.name}</div>
        <div className="theme-tagline">{preview.tagline || entry.manifest.description}</div>
        {preview.swatches?.length ? (
          <div className="theme-swatches">
            {preview.swatches.map((c, i) => (
              <i key={i} style={{ background: c }} />
            ))}
          </div>
        ) : null}
      </div>
    </button>
  )
}
