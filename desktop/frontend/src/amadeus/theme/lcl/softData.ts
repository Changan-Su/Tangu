// Tangu Desktop, re-designed as a soft card-ified layout (inspired by the SETO reference:
// separated floating rounded cards with gaps, on a warm gradient — not one fused panel).
// Independent scoped page (#/tangu-soft); does NOT touch LCL themes or the #/tangu Lovable study.

/** Selectable color theme — the card-ified LAYOUT is constant; a theme only re-tints it. */
export type ThemeId = 'soft' | 'qbird' | 'custom'
export const THEMES: { id: ThemeId; label: string; note: string; dot: string }[] = [
  { id: 'soft', label: '暖桃', note: '薰衣草 · SETO', dot: '#8b7fd6' },
  { id: 'qbird', label: 'Qbird', note: '柔青 · 石墨', dot: '#4d8794' },
  { id: 'custom', label: '自定义', note: '取色 · 自适应', dot: '#e0857a' },
]

/** Component tree of the card-ified screen (for the 组件结构 section). */
export type TreeNode = { d: number; name: string; role: string }
export const tree: TreeNode[] = [
  { d: 0, name: 'Stage', role: '渐变背景台 · 圆角相框' },
  { d: 1, name: 'SidebarCard', role: '浮卡 · 品牌/会话/账户' },
  { d: 1, name: 'CenterColumn', role: '间距堆叠（非整块）' },
  { d: 2, name: 'HeaderCard', role: '浮卡 · 标题/连接/操作' },
  { d: 2, name: 'ChatFlow', role: '开放区 · 每条消息独立浮卡' },
  { d: 3, name: 'UserCard', role: '用户气泡卡（右）' },
  { d: 3, name: 'ToolCard', role: '工具调用浮卡（无左条/无硬边）' },
  { d: 3, name: 'TodoCard', role: '待办浮卡' },
  { d: 3, name: 'ApprovalCard', role: '审批浮卡 · 三态钮' },
  { d: 3, name: 'InquiryCard', role: '反问浮卡 · 选项+输入' },
  { d: 2, name: 'ComposerCard', role: '浮卡 · 合成器' },
  { d: 1, name: 'WorkspaceCard', role: '浮卡 · 工作区文件' },
]

/* ── custom theme: derive accent + ambiance CSS vars from one seed color (neutrals stay theme-default) ── */
type RGB = [number, number, number]
function hexToRgb(hex: string): RGB {
  const m = hex.replace('#', '')
  const n = m.length === 3 ? m.split('').map((c) => c + c).join('') : m
  return [parseInt(n.slice(0, 2), 16) || 0, parseInt(n.slice(2, 4), 16) || 0, parseInt(n.slice(4, 6), 16) || 0]
}
const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
/** Blend color c toward t by k (k=1 → t). Returns an rgb() string. */
function mix(c: RGB, t: RGB, k: number): string {
  return `rgb(${clamp(c[0] + (t[0] - c[0]) * k)}, ${clamp(c[1] + (t[1] - c[1]) * k)}, ${clamp(c[2] + (t[2] - c[2]) * k)})`
}

/** Accent + ambiance vars from a seed color; neutrals (card/ink) are intentionally NOT set (theme keeps them). Pure. */
export function customVars(color: string, dark: boolean): Record<string, string> {
  const [r, g, b] = hexToRgb(color)
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  const onAccent = lum < 0.62 ? '#ffffff' : '#161018'
  const c: RGB = [r, g, b]
  if (dark) {
    return {
      '--accent': color,
      '--accent-hover': mix(c, [255, 255, 255], 0.18),
      '--accent-soft': `rgba(${r},${g},${b},0.18)`,
      '--on-accent': onAccent,
      '--lav': mix(c, [255, 255, 255], 0.2),
      '--glow': `rgba(${r},${g},${b},0.22)`,
      '--card-2': mix(c, [42, 40, 48], 0.86),
      '--grad': `linear-gradient(158deg, ${mix(c, [26, 23, 32], 0.8)} 0%, ${mix(c, [20, 18, 26], 0.9)} 100%)`,
      background: mix(c, [20, 18, 25], 0.92),
    }
  }
  return {
    '--accent': color,
    '--accent-hover': mix(c, [0, 0, 0], 0.12),
    '--accent-soft': `rgba(${r},${g},${b},0.13)`,
    '--on-accent': onAccent,
    '--lav': mix(c, [255, 255, 255], 0.25),
    '--glow': `rgba(${r},${g},${b},0.42)`,
    '--card-2': mix(c, [255, 255, 255], 0.93),
    '--grad': `linear-gradient(158deg, ${mix(c, [255, 255, 255], 0.84)} 0%, ${mix(c, [255, 255, 255], 0.93)} 100%)`,
    background: mix(c, [255, 255, 255], 0.95),
  }
}
