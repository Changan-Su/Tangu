// Theme state for the LCL-based shell (the rebuilt renderer). Drives a SCOPED root
// (.tangu-soft / .tangu-lovable) — NOT <html> — so it coexists with the legacy UI/theme
// during the migration. Values come verbatim from the vendored LCL bases; custom color
// reuses the vendored pure functions, so the look matches #/amadeus exactly.

import { create } from 'zustand'
import type { CSSProperties } from 'react'
import { customVars } from '../theme/lcl/softData'
import { customSkinVars } from '../theme/lcl/lovableData'

export type Lang = 'soft' | 'lovable' // soft = 圆润卡片(Dreamer) · lovable = 纸感(Origin)
export type Mode = 'light' | 'dark'
export type SoftTheme = 'soft' | 'qbird' | 'custom'
export type LovableSkin = 'lovable' | 'echo' | 'qbird' | 'custom'

const DEFAULT_SEED = '#8b7fd6'

interface LclThemeState {
  lang: Lang
  softTheme: SoftTheme
  lovableSkin: LovableSkin
  mode: Mode
  color: string
  flat: boolean
  setLang(l: Lang): void
  setSoftTheme(t: SoftTheme): void
  setLovableSkin(s: LovableSkin): void
  setMode(m: Mode): void
  toggleMode(): void
  setColor(c: string): void
  toggleFlat(): void
}

const KEY = 'amadeus.lcl.'
const read = (k: string, fb: string): string => {
  try {
    return localStorage.getItem(KEY + k) || fb
  } catch {
    return fb
  }
}
const write = (k: string, v: string): void => {
  try {
    localStorage.setItem(KEY + k, v)
  } catch {
    /* ignore */
  }
}

export const useLclTheme = create<LclThemeState>((set, get) => ({
  lang: read('lang', 'soft') as Lang,
  softTheme: read('softTheme', 'soft') as SoftTheme,
  lovableSkin: read('lovableSkin', 'lovable') as LovableSkin,
  mode: read('mode', 'light') as Mode,
  color: read('color', DEFAULT_SEED),
  flat: read('flat', '0') === '1',
  setLang: (l) => (write('lang', l), set({ lang: l })),
  setSoftTheme: (t) => (write('softTheme', t), set({ softTheme: t })),
  setLovableSkin: (s) => (write('lovableSkin', s), set({ lovableSkin: s })),
  setMode: (m) => (write('mode', m), set({ mode: m })),
  toggleMode: () => {
    const m: Mode = get().mode === 'light' ? 'dark' : 'light'
    write('mode', m)
    set({ mode: m })
  },
  setColor: (c) => (write('color', c), set({ color: c })),
  toggleFlat: () => {
    const f = !get().flat
    write('flat', f ? '1' : '0')
    set({ flat: f })
  },
}))

/** The props to spread on the scoped shell root (className + data-attrs + custom-color style). */
export interface RootProps {
  className: string
  'data-theme'?: string
  'data-skin'?: string
  'data-mode': Mode
  'data-flat': '0' | '1'
  style?: CSSProperties
}

export function rootProps(s: LclThemeState): RootProps {
  const dark = s.mode === 'dark'
  if (s.lang === 'lovable') {
    return {
      className: 'tangu-lovable',
      'data-skin': s.lovableSkin,
      'data-mode': s.mode,
      'data-flat': s.flat ? '1' : '0',
      style: s.lovableSkin === 'custom' ? (customSkinVars(s.color, dark) as CSSProperties) : undefined,
    }
  }
  return {
    className: 'tangu-soft',
    'data-theme': s.softTheme,
    'data-mode': s.mode,
    'data-flat': s.flat ? '1' : '0',
    style: s.softTheme === 'custom' ? (customVars(s.color, dark) as CSSProperties) : undefined,
  }
}
