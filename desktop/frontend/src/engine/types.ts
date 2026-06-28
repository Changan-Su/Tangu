/**
 * 引擎类型契约(Obsidian 形态)。引擎层只依赖 react + dockview + tokens,**绝不 import feature 代码**。
 * - ViewDefinition: 注册一种视图(≈ Obsidian ItemView),由 viewRegistry 持有。
 * - Leaf: 一个 Dockview panel 的句柄(≈ WorkspaceLeaf);视图从可序列化 params + store 重建,故支持 setParams。
 * - Command / RibbonItem / StatusItem: 命令面板 / ribbon / 状态栏的贡献项。
 * - PluginContext: Amadeus 插件宿主契约的超集(Phase 4 让其插件宿主直接落入)。
 */
import type { ComponentType, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

/** 视图可被开在主区 / 左侧栏 / 右侧栏。 */
export type ViewLocation = 'main' | 'left' | 'right'

/** 一个 Dockview panel 的句柄(≈ Obsidian WorkspaceLeaf)。 */
export interface Leaf {
  readonly id: string
  readonly type: string
  /** 当前可序列化参数(如 {sessionId})。视图据此从 store 重建。 */
  readonly params: Record<string, unknown>
  setTitle(title: string): void
  /** 更新参数(写回 Dockview panel,纳入布局序列化)。 */
  setParams(params: Record<string, unknown>): void
  close(): void
}

/** 视图渲染时拿到的 props。 */
export interface ViewProps {
  leaf: Leaf
  params: Record<string, unknown>
}

/** 注册一种视图(≈ Obsidian registerView)。 */
export interface ViewDefinition {
  /** 注册键(= Dockview component 名)。 */
  type: string
  /** 标签名;函数形式支持 i18n 懒求值。 */
  displayName: string | (() => string)
  icon?: LucideIcon
  factory: (props: ViewProps) => ReactNode
  /** true = 全局至多一个实例(再开则聚焦已存在的)。 */
  singleton?: boolean
  /** 默认可关。主区视图通常可关;侧栏固定视图设 false。 */
  closable?: boolean
}

/** 命令面板(Cmd/Ctrl+K)里的一条命令(≈ Obsidian addCommand)。 */
export interface Command {
  id: string
  title: string | (() => string)
  keywords?: string
  /** 形如 'mod+k' / 'mod+shift+p';mod = mac⌘ / 其它 Ctrl。 */
  hotkey?: string
  run(): void
}

/** ribbon 竖条上的一个图标(≈ Obsidian addRibbonIcon)。 */
export interface RibbonItem {
  id: string
  icon: LucideIcon
  tooltip: string | (() => string)
  onClick(): void
  /** 顶部(默认)或底部分组。 */
  side?: 'top' | 'bottom'
}

/** 底部状态栏的一项(≈ Obsidian addStatusBarItem)。 */
export interface StatusItem {
  id: string
  component: ComponentType
  side?: 'left' | 'right'
}

/** 插件契约 —— Amadeus PluginContext 的超集(加了 registerView / registerRibbonIcon)。 */
export interface PluginContext {
  registerView(def: ViewDefinition): void
  registerCommand(command: Command): void
  registerRibbonIcon(item: RibbonItem): void
  registerStatusItem(item: StatusItem): void
}

/** 求值 displayName/title/tooltip(支持 string | () => string)。 */
export function label(v: string | (() => string)): string {
  return typeof v === 'function' ? v() : v
}

export type { ReactNode }
