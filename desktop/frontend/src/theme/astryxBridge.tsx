/** astryx(facebook/astryx 设计系统)接入桥 —— 全应用唯一入口。
 *  - CSS 三件套只在此 import 一次(reset→astryx-base→theme 的 layer 级联,顺序有讲究);
 *  - lclTheme:astryx token 值直接引用 LCL CSS 变量 → 换肤/明暗零维护跟随;
 *  - <AstryxScope>:Theme + mode 镜像(themeStore),包住任何使用 astryx 组件的子树。
 *  评估期纪律:业务代码不直接 import '@astryxdesign/core/theme',一律经本模块。 */
import '@astryxdesign/core/reset.css'
import '@astryxdesign/core/astryx.css'
import '@astryxdesign/theme-neutral/theme.css'
import type { ReactNode } from 'react'
import { Theme, defineTheme } from '@astryxdesign/core/theme'
import { useTheme } from '../stores/themeStore'

// LCL → astryx token 桥:单值字符串引用 LCL 变量,明暗由 LCL 变量自身随 data-mode 流动。
export const lclTheme = defineTheme({
  name: 'forsion-lcl',
  tokens: {
    '--color-accent': 'var(--accent, #6c5ce7)',
    '--color-background-body': 'var(--bg)',
    '--color-background-surface': 'var(--bg-card, var(--bg))',
    '--color-text-primary': 'var(--text)',
    '--color-text-secondary': 'var(--text-muted)',
    '--radius-container': 'var(--radius-md, 12px)',
  },
})

export function AstryxScope({ children }: { children: ReactNode }) {
  const mode = useTheme((s) => s.mode)
  return (
    <Theme theme={lclTheme} mode={mode}>
      {children}
    </Theme>
  )
}
