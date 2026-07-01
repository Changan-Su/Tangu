// Shared color math for theme custom-accent hooks. Pure functions — a seed hex drives the
// accent (and, per theme, a faint background ambiance); see each theme's manifest.ts custom().

export type RGB = [number, number, number]

export function hexToRgb(hex: string): RGB {
  const m = hex.replace('#', '')
  const n = m.length === 3 ? m.split('').map((c) => c + c).join('') : m
  return [
    parseInt(n.slice(0, 2), 16) || 0,
    parseInt(n.slice(2, 4), 16) || 0,
    parseInt(n.slice(4, 6), 16) || 0,
  ]
}

const clamp = (n: number): number => Math.max(0, Math.min(255, Math.round(n)))

/** Mix color c toward target t by factor k (0 = c, 1 = t) → an `rgb(...)` string. */
export function mix(c: RGB, t: RGB, k: number): string {
  return `rgb(${clamp(c[0] + (t[0] - c[0]) * k)}, ${clamp(c[1] + (t[1] - c[1]) * k)}, ${clamp(c[2] + (t[2] - c[2]) * k)})`
}

/** Readable on-accent text: white over dark seeds, near-black over light ones. */
export function onAccent(rgb: RGB): string {
  const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255
  return lum < 0.62 ? '#ffffff' : '#161018'
}
