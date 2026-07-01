// Theme engine — Obsidian-style. Each theme is a self-contained folder under themes/
// (manifest.ts + theme.css). Its CSS is pulled in as a build-time side effect (Vite bundles
// and applies it); [data-theme=id] × [data-mode] just select which rules win. Drop a new
// themes/<id>/ folder and it auto-appears in the picker — no registration code to touch.
//
// Runtime drop-in (loading a theme folder from the vault while the app runs) is a later
// add: the format here is exactly what such a loader would consume.

export interface ThemeManifest {
  id: string
  /** Display name in the picker. */
  label: string
  /** Representative swatch color (the dot in the picker). */
  swatch: string
  /** Sort order in the picker, lower first; the default (built-in) theme is 0. */
  order?: number
  /** Optional custom-accent hook: a seed color → CSS custom props applied inline on <html>. */
  custom?: (seed: string, dark: boolean) => Record<string, string>
}

// Every theme's CSS, bundled + applied at build time (selector-scoped, inert until active).
import.meta.glob('./themes/*/theme.css', { eager: true })

// Every theme's manifest (metadata + optional custom-accent fn).
const mods = import.meta.glob<{ default: ThemeManifest }>('./themes/*/manifest.ts', {
  eager: true,
})

export const THEMES: ThemeManifest[] = Object.values(mods)
  .map((m) => m.default)
  .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))

export const THEME_BY_ID = new Map(THEMES.map((t) => [t.id, t]))

// CSS custom props set inline by the last applyAccent — cleared before the next apply so
// switching theme/mode or clearing the seed never leaves a stale override behind.
let appliedProps: string[] = []

/** Apply a theme's custom accent from a seed (or clear it when the seed is null/empty). */
export function applyAccent(themeId: string, seed: string | null, dark: boolean): void {
  const root = document.documentElement.style
  for (const p of appliedProps) root.removeProperty(p)
  appliedProps = []
  const theme = THEME_BY_ID.get(themeId)
  if (!seed || !theme?.custom) return
  for (const [k, v] of Object.entries(theme.custom(seed, dark))) {
    root.setProperty(k, v)
    appliedProps.push(k)
  }
}

// Custom-accent seed persisted per theme (Origin and Dreamer keep separate seeds).
const accentKey = (themeId: string): string => `amadeus.accent.${themeId}`

export function readAccent(themeId: string): string | null {
  try {
    return localStorage.getItem(accentKey(themeId))
  } catch {
    return null
  }
}

export function writeAccent(themeId: string, seed: string | null): void {
  try {
    if (seed) localStorage.setItem(accentKey(themeId), seed)
    else localStorage.removeItem(accentKey(themeId))
  } catch {
    /* ignore */
  }
}
