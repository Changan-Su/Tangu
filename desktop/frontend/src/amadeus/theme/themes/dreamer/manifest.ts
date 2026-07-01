import type { ThemeManifest } from '../../engine'
import { hexToRgb, mix, onAccent } from '../../color'

// Custom accent: the seed drives --primary, the gradient stage (--bg) and the corner --glow,
// plus the secondary surface. Cards (--surface), ink and radii stay neutral from the base.
function custom(seed: string, dark: boolean): Record<string, string> {
  const c = hexToRgb(seed)
  const [r, g, b] = c
  const glow = (a: number): string =>
    `radial-gradient(110% 75% at 82% -12%, rgba(${r}, ${g}, ${b}, ${a}), transparent 56%)`
  if (dark) {
    return {
      '--primary': seed,
      '--primary-2': mix(c, [255, 255, 255], 0.2),
      '--on-primary': onAccent(c),
      '--surface-2': mix(c, [42, 40, 48], 0.86),
      '--glow': glow(0.22),
      '--bg': `linear-gradient(158deg, ${mix(c, [26, 23, 32], 0.8)} 0%, ${mix(c, [20, 18, 26], 0.9)} 100%)`,
    }
  }
  return {
    '--primary': seed,
    '--primary-2': mix(c, [255, 255, 255], 0.25),
    '--on-primary': onAccent(c),
    '--surface-2': mix(c, [255, 255, 255], 0.93),
    '--glow': glow(0.42),
    '--bg': `linear-gradient(158deg, ${mix(c, [255, 255, 255], 0.84)} 0%, ${mix(c, [255, 255, 255], 0.93)} 100%)`,
  }
}

const manifest: ThemeManifest = {
  id: 'dreamer',
  label: 'Dreamer · 梦想家',
  swatch: '#8b7fd6',
  order: 1,
  custom,
}
export default manifest
