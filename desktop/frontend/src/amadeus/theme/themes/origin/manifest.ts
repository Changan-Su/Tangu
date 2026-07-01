import type { ThemeManifest } from '../../engine'
import { hexToRgb, mix, onAccent } from '../../color'

// Custom accent: the seed becomes --primary; --bg/--bg-alt/--surface take a faint graphite
// tint of it (Origin stays paper-restrained — neutrals/text/border keep the theme base).
function custom(seed: string, dark: boolean): Record<string, string> {
  const c = hexToRgb(seed)
  if (dark) {
    return {
      '--primary': seed,
      '--primary-2': mix(c, [255, 255, 255], 0.18),
      '--on-primary': onAccent(c),
      '--bg': mix(c, [28, 26, 22], 0.93),
      '--bg-alt': mix(c, [33, 30, 24], 0.92),
      '--surface': mix(c, [38, 34, 25], 0.94),
    }
  }
  return {
    '--primary': seed,
    '--primary-2': mix(c, [0, 0, 0], 0.14),
    '--on-primary': onAccent(c),
    '--bg': mix(c, [247, 244, 237], 0.96),
    '--bg-alt': mix(c, [243, 239, 231], 0.94),
    '--surface': mix(c, [254, 253, 249], 0.975),
  }
}

const manifest: ThemeManifest = {
  id: 'origin',
  label: 'Origin · 本源',
  swatch: '#1c1c1c',
  order: 0,
  custom,
}
export default manifest
