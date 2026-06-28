/** 引擎公共 API。app/视图/插件只从这里 import,不深入引擎内部文件。 */
export type {
  ViewDefinition,
  ViewProps,
  ViewLocation,
  Leaf,
  Command,
  RibbonItem,
  StatusItem,
  PluginContext,
} from './types'
export { label } from './types'

export { Shell } from './Shell'
export { registerView, unregisterView, getView, allViews } from './viewRegistry'
export { useWorkspace } from './workspaceStore'
export type { MainTab, SideTab } from './workspaceStore'
export { useCommandStore, addCommand, removeCommand, openCommandPalette } from './commandRegistry'
export { useShortcuts, effectiveHotkey, eventToHotkey, formatHotkey } from './shortcutStore'
export { useRibbonStore, addRibbonIcon, removeRibbonIcon } from './ribbonRegistry'
export { useStatusStore, addStatusItem, removeStatusItem } from './statusRegistry'
export {
  saveNamedLayout,
  loadNamedLayout,
  listNamedLayouts,
  deleteNamedLayout,
  clearLayout,
} from './layoutPersist'
