// Theme = CSS-variable tokens selected by [data-theme] (which design language) × [data-mode]
// (light/dark). Switching just flips the data-attributes on <html> — instant, no reload.
// Selection is persisted to localStorage so it survives launches. Themes are discovered from
// theme/themes/ (see engine.ts); custom accents apply separately via engine.applyAccent.

import { THEME_BY_ID } from './engine'

export { THEMES } from './engine'
export type { ThemeManifest } from './engine'

export type ThemeName = string
export type Mode = 'light' | 'dark'

const THEME_KEY = 'amadeus.theme'
const MODE_KEY = 'amadeus.mode'
const DEFAULT_THEME = 'origin'
const DEFAULT_MODE: Mode = 'light'

// Any stored theme that no longer exists (legacy single-hue accents, the retired
// qbird/echo) resolves to the default — Origin's bare [data-mode] palette covers it too.
function migrate(theme: string): string {
  return THEME_BY_ID.has(theme) ? theme : DEFAULT_THEME
}

function readStored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) || fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

export function applyTheme(theme: ThemeName, mode: Mode): void {
  const el = document.documentElement
  el.dataset.theme = theme
  el.dataset.mode = mode
}

/** The persisted (theme, mode) to apply at startup. */
export function loadTheme(): { theme: ThemeName; mode: Mode } {
  return {
    theme: migrate(readStored(THEME_KEY, DEFAULT_THEME)),
    mode: readStored(MODE_KEY, DEFAULT_MODE) === 'light' ? 'light' : 'dark',
  }
}

export function getTheme(): ThemeName {
  return migrate(document.documentElement.dataset.theme || DEFAULT_THEME)
}

export function getMode(): Mode {
  return (document.documentElement.dataset.mode as Mode) || DEFAULT_MODE
}

export function setTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme
  write(THEME_KEY, theme)
}

export function setMode(mode: Mode): void {
  document.documentElement.dataset.mode = mode
  write(MODE_KEY, mode)
}

export function toggleMode(): Mode {
  const next: Mode = getMode() === 'dark' ? 'light' : 'dark'
  setMode(next)
  return next
}
