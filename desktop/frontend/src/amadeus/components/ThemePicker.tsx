// Appearance settings (Settings → 外观): drives the LCL-based shell's theme — design language
// (圆润/Dreamer ↔ 纸感/Origin), light/dark, the per-language palette, a custom accent color,
// and the shadow/flat toggle. All via useLclTheme (persisted to amadeus.lcl.*).

import { useLclTheme, type LovableSkin, type SoftTheme } from '../lcl/lclTheme'
import { THEMES as SOFT_THEMES } from '../theme/lcl/softData'
import { SKINS as LOVABLE_SKINS } from '../theme/lcl/lovableData'

export function AppearanceSettings() {
  const t = useLclTheme()
  const lovable = t.lang === 'lovable'
  const variants = lovable ? LOVABLE_SKINS : SOFT_THEMES
  const activeVariant = lovable ? t.lovableSkin : t.softTheme
  const isCustom = activeVariant === 'custom'

  const pickVariant = (id: string): void =>
    lovable ? t.setLovableSkin(id as LovableSkin) : t.setSoftTheme(id as SoftTheme)

  return (
    <div className="settings-section">
      <div className="settings-field">
        <div className="settings-field-label">设计语言</div>
        <div className="seg">
          <button className="seg-btn" data-active={!lovable || undefined} onClick={() => t.setLang('soft')}>
            圆润 · Dreamer
          </button>
          <button className="seg-btn" data-active={lovable || undefined} onClick={() => t.setLang('lovable')}>
            纸感 · Origin
          </button>
        </div>
      </div>

      <div className="settings-field">
        <div className="settings-field-label">外观模式</div>
        <div className="seg">
          <button className="seg-btn" data-active={t.mode === 'light' || undefined} onClick={() => t.setMode('light')}>
            浅色
          </button>
          <button className="seg-btn" data-active={t.mode === 'dark' || undefined} onClick={() => t.setMode('dark')}>
            深色
          </button>
        </div>
      </div>

      <div className="settings-field">
        <div className="settings-field-label">配色</div>
        <div className="theme-grid">
          {variants.map((v) => (
            <button
              key={v.id}
              className="theme-chip"
              data-active={v.id === activeVariant || undefined}
              onClick={() => pickVariant(v.id)}
            >
              <span className="theme-chip-dot" style={{ background: 'dot' in v ? v.dot : 'var(--accent)' }} />
              <span className="theme-chip-label">{v.label}</span>
            </button>
          ))}
        </div>
      </div>

      {isCustom && (
        <div className="settings-field">
          <div className="settings-field-label">自定义强调色</div>
          <div className="settings-hint">取一个种子色，整套配色自动围绕它适配。</div>
          <div className="accent-row">
            <input
              type="color"
              className="accent-input"
              value={t.color}
              onChange={(e) => t.setColor(e.target.value)}
              aria-label="自定义强调色"
            />
          </div>
        </div>
      )}

      <div className="settings-field">
        <div className="settings-field-label">阴影</div>
        <div className="seg">
          <button className="seg-btn" data-active={!t.flat || undefined} onClick={() => t.flat && t.toggleFlat()}>
            立体
          </button>
          <button className="seg-btn" data-active={t.flat || undefined} onClick={() => !t.flat && t.toggleFlat()}>
            扁平
          </button>
        </div>
      </div>
    </div>
  )
}
