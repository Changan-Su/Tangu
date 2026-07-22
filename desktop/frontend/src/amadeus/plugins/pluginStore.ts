// The plugin host. Holds the plugin registry, the persisted "disabled" preference, the
// runtime active set, and the live contribution registries (slash items / commands /
// themes) that the UI subscribes to. Built-in plugins are registered on init(); external
// (Forsion) plugins are discovered from ~/.forsion/plugins/ and evaluated here.
//
// Trust model: external plugins run with the curated `ctx.app` API (and, like Obsidian,
// full renderer scope). Only install plugins you trust.

import { create } from 'zustand'
import { usePageStore } from '../store/pageStore'
import { useUiStore } from '../store/uiStore'
import { setTheme as applyAccent, toggleMode } from '../theme/ThemeManager'
import { amadeus } from '../api'
import { BUILTIN_PLUGINS } from './builtins'
import { registerPropertyType as registerPropType, unregisterPropertyType as unregisterPropType } from '../blocks/database/propertyTypes'
import { registerPluginSeries, track, unregisterPluginAchievements } from '../../achievements/store'
import { act } from '../../activity/log'
import type {
  AmadeusPlugin,
  CommandContribution,
  EmbedRendererContribution,
  FileCreatorContribution,
  FileTypeContribution,
  PanelContribution,
  PluginAppApi,
  PluginContext,
  PropertyTypeContribution,
  SettingContribution,
  SlashContribution,
  StatusItemContribution,
  ThemeContribution,
  ViewContribution,
} from './types'
import type { ExternalPluginSource } from '@amadeus-shared/ipc'

const DISABLED_KEY = 'amadeus.plugins.disabled'

interface Owned<T> {
  pluginId: string
  item: T
}

interface PluginState {
  plugins: AmadeusPlugin[]
  /** Persisted preference: ids the user has explicitly turned off (default = enabled). */
  disabledIds: string[]
  /** Runtime: plugins whose setup() has run. */
  activeIds: string[]
  slashItems: Owned<SlashContribution>[]
  commands: Owned<CommandContribution>[]
  themes: Owned<ThemeContribution>[]
  panels: Owned<PanelContribution>[]
  statusItems: Owned<StatusItemContribution>[]
  propertyTypes: Owned<PropertyTypeContribution>[]
  settings: Owned<SettingContribution>[]
  views: Owned<ViewContribution>[]
  fileTypes: Owned<FileTypeContribution>[]
  embedRenderers: Owned<EmbedRendererContribution>[]
  fileCreators: Owned<FileCreatorContribution>[]
  /** 宿主注入的视图打开器(桌面壳=workspace.openView);无工作台的宿主保持 null,ctx.openView 即 no-op。 */
  viewOpener: ((type: string) => void) | null
  setViewOpener(fn: ((type: string) => void) | null): void
  disposers: Record<string, (() => void) | undefined>
  initialized: boolean
  /** 注册并按偏好启用一组插件;缺省 = 全部 builtins(独立版);桌面壳传自己的选择性子集。 */
  init(plugins?: AmadeusPlugin[]): void
  enable(id: string): void
  disable(id: string): void
  toggle(id: string): void
  isActive(id: string): boolean
  loadExternal(): Promise<void>
  reloadExternal(): Promise<void>
  openPluginsFolder(): void
  scaffoldSample(): Promise<void>
}

function makeAppApi(): PluginAppApi {
  return {
    getActivePage: () => usePageStore.getState().activePage,
    getActivePageText: () =>
      Object.values(usePageStore.getState().blocks)
        .map((b) => b.content)
        .join('\n\n'),
    loadPage: (p) => void usePageStore.getState().loadPage(p),
    createPage: () => void usePageStore.getState().createPage(),
    toggleMode: () => void toggleMode(),
    setTheme: (t) => applyAccent(t),
    openSearch: () => useUiStore.getState().setPalette('search'),
    openSwitcher: () => useUiStore.getState().setPalette('switch'),
    notify: (m) => useUiStore.getState().notify(m),
    readFile: (p) => amadeus.readTextFile(p),
    writeFile: (p, text) => amadeus.writeTextFile(p, text),
    // 打开文件类型视图在 amadeusNav(它引 pluginStore 的 matchFileType)→ 动态 import 破静态环。
    openFile: (p) => { void import('../../amadeusNav').then((m) => m.openFile(p)) },
  }
}

function injectThemeStyle(id: string, css: string): void {
  const elId = `amadeus-plugin-theme-${id}`
  let el = document.getElementById(elId) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = elId
    document.head.appendChild(el)
  }
  el.textContent = css
}
function removeThemeStyle(id: string): void {
  document.getElementById(`amadeus-plugin-theme-${id}`)?.remove()
}
function readDisabled(): string[] {
  try {
    const v = localStorage.getItem(DISABLED_KEY)
    return v ? (JSON.parse(v) as string[]) : []
  } catch {
    return []
  }
}
function writeDisabled(ids: string[]): void {
  try {
    localStorage.setItem(DISABLED_KEY, JSON.stringify(ids))
  } catch {
    /* ignore */
  }
}

/** Wrap an external source as a plugin whose setup() evaluates its code with `ctx`. */
function toPlugin(src: ExternalPluginSource): AmadeusPlugin {
  return {
    id: src.id,
    name: src.name,
    version: src.version,
    description: src.description,
    builtin: false,
    apiVersion: src.apiVersion,
    minAppVersion: src.minAppVersion,
    requiresApp: src.requiresApp,
    readme: src.readme,
    changelog: src.changelog,
    onboarding: src.onboarding,
    blocked: src.blocked,
    setup: (ctx) => {
      const fn = new Function('ctx', src.code) as (c: PluginContext) => unknown
      const d = fn(ctx)
      return typeof d === 'function' ? (d as () => void) : undefined
    },
  }
}

export const usePluginStore = create<PluginState>((set, get) => {
  const appApi = makeAppApi()
  const makeContext = (pluginId: string): PluginContext => ({
    app: appApi,
    registerSlashItem: (item) => set((s) => ({ slashItems: [...s.slashItems, { pluginId, item }] })),
    registerCommand: (command) =>
      set((s) => ({ commands: [...s.commands, { pluginId, item: command }] })),
    registerTheme: (theme) => {
      injectThemeStyle(theme.id, theme.css)
      set((s) => ({ themes: [...s.themes, { pluginId, item: theme }] }))
    },
    registerPanel: (panel) => set((s) => ({ panels: [...s.panels, { pluginId, item: panel }] })),
    registerStatusItem: (item) =>
      set((s) => ({ statusItems: [...s.statusItems, { pluginId, item }] })),
    registerView: (view) => set((s) => ({ views: [...s.views, { pluginId, item: view }] })),
    registerFileType: (def) => set((s) => ({ fileTypes: [...s.fileTypes, { pluginId, item: def }] })),
    registerEmbedRenderer: (def) =>
      set((s) => ({ embedRenderers: [...s.embedRenderers, { pluginId, item: def }] })),
    registerFileCreator: (def) =>
      set((s) => ({ fileCreators: [...s.fileCreators, { pluginId, item: def }] })),
    // 打开自己的视图:类型名由宿主统一命名空间(plugin:<id>:<viewId>),防跨插件顶替。
    openView: (viewId) => get().viewOpener?.(`plugin:${pluginId}:${viewId}`),
    registerSetting: (def) => set((s) => ({ settings: [...s.settings, { pluginId, item: def }] })),
    registerPropertyType: (def) => {
      registerPropType(def)
      set((s) => ({ propertyTypes: [...s.propertyTypes, { pluginId, item: def }] }))
    },
    // 成就:注册/计数都在 achievements/store 内强制 plugin:<id>: 前缀(防撞官方 id/伪造官方计数)。
    achievements: {
      registerSeries: (def) => registerPluginSeries(pluginId, def),
      track: (event, n) => track(`plugin:${pluginId}:${event}`, n),
    },
    // 活动日志:同款前缀纪律(插件伪造不了官方事件);拼行/消毒在 main 侧 activityLog.ts。
    activity: {
      log: (event, detail) => act(`plugin:${pluginId}:${event}`, detail),
    },
  })

  /** Run disposer + drop contributions + mark inactive, WITHOUT touching the preference. */
  const teardown = (id: string): void => {
    try {
      get().disposers[id]?.()
    } catch (e) {
      console.error(`[amadeus] plugin "${id}" dispose failed`, e)
    }
    for (const o of get().themes) if (o.pluginId === id) removeThemeStyle(o.item.id)
    for (const o of get().propertyTypes) if (o.pluginId === id) unregisterPropType(o.item.type)
    unregisterPluginAchievements(id)
    set((s) => ({
      activeIds: s.activeIds.filter((x) => x !== id),
      slashItems: s.slashItems.filter((o) => o.pluginId !== id),
      commands: s.commands.filter((o) => o.pluginId !== id),
      themes: s.themes.filter((o) => o.pluginId !== id),
      panels: s.panels.filter((o) => o.pluginId !== id),
      statusItems: s.statusItems.filter((o) => o.pluginId !== id),
      propertyTypes: s.propertyTypes.filter((o) => o.pluginId !== id),
      settings: s.settings.filter((o) => o.pluginId !== id),
      views: s.views.filter((o) => o.pluginId !== id),
      fileTypes: s.fileTypes.filter((o) => o.pluginId !== id),
      embedRenderers: s.embedRenderers.filter((o) => o.pluginId !== id),
      fileCreators: s.fileCreators.filter((o) => o.pluginId !== id),
      disposers: { ...s.disposers, [id]: undefined },
    }))
  }

  const applyPref = (id: string): void => {
    if (!get().disabledIds.includes(id)) get().enable(id)
  }

  return {
    plugins: [],
    disabledIds: [],
    activeIds: [],
    slashItems: [],
    commands: [],
    themes: [],
    panels: [],
    statusItems: [],
    propertyTypes: [],
    settings: [],
    views: [],
    fileTypes: [],
    embedRenderers: [],
    fileCreators: [],
    viewOpener: null,
    setViewOpener: (fn) => set({ viewOpener: fn }),
    disposers: {},
    initialized: false,

    isActive: (id) => get().activeIds.includes(id),

    init(plugins = BUILTIN_PLUGINS) {
      if (get().initialized) return
      set({ plugins: [...plugins], disabledIds: readDisabled(), initialized: true })
      for (const p of plugins) applyPref(p.id)
    },

    enable(id) {
      if (get().activeIds.includes(id)) return
      const plugin = get().plugins.find((p) => p.id === id)
      if (!plugin) return
      if (plugin.blocked) return // 门禁挡下的插件(apiVersion/minAppVersion 不符)任何路径都不得激活
      // 注:DISABLED_KEY 是按 id 的单一全局列表;listPlugins 已按 vault 优先去重,每 id 只有一实例,一位开关即正确。
      let dispose: (() => void) | undefined
      try {
        const r = plugin.setup(makeContext(id))
        if (typeof r === 'function') dispose = r
      } catch (e) {
        console.error(`[amadeus] plugin "${id}" setup failed`, e)
        useUiStore.getState().notify(`插件「${plugin.name}」加载失败`)
        // setup 抛错前可能已注册了主题/成就/属性类型 —— 三者都有 store 外的副作用(注入的 <style>、成就注册表),
        // 只 filter zustand 状态会留下孤儿(禁用的插件主题仍挂在 head 上)。与 teardown 同口径全清。
        for (const o of get().propertyTypes) if (o.pluginId === id) unregisterPropType(o.item.type)
        for (const o of get().themes) if (o.pluginId === id) removeThemeStyle(o.item.id)
        unregisterPluginAchievements(id)
        set((s) => ({
          slashItems: s.slashItems.filter((o) => o.pluginId !== id),
          commands: s.commands.filter((o) => o.pluginId !== id),
          themes: s.themes.filter((o) => o.pluginId !== id),
          panels: s.panels.filter((o) => o.pluginId !== id),
          statusItems: s.statusItems.filter((o) => o.pluginId !== id),
          propertyTypes: s.propertyTypes.filter((o) => o.pluginId !== id),
          settings: s.settings.filter((o) => o.pluginId !== id),
          views: s.views.filter((o) => o.pluginId !== id),
          fileTypes: s.fileTypes.filter((o) => o.pluginId !== id),
          embedRenderers: s.embedRenderers.filter((o) => o.pluginId !== id),
          fileCreators: s.fileCreators.filter((o) => o.pluginId !== id),
        }))
        return
      }
      set((s) => ({
        activeIds: [...s.activeIds, id],
        disabledIds: s.disabledIds.filter((x) => x !== id),
        disposers: { ...s.disposers, [id]: dispose },
      }))
      writeDisabled(get().disabledIds)
    },

    disable(id) {
      if (!get().activeIds.includes(id)) return
      teardown(id)
      set((s) => ({ disabledIds: s.disabledIds.includes(id) ? s.disabledIds : [...s.disabledIds, id] }))
      writeDisabled(get().disabledIds)
    },

    toggle(id) {
      if (get().activeIds.includes(id)) get().disable(id)
      else get().enable(id)
    },

    async loadExternal() {
      let sources: ExternalPluginSource[] = []
      try {
        sources = await amadeus.listPlugins()
      } catch {
        return
      }
      const externals = sources.map(toPlugin)
      set((s) => ({ plugins: [...s.plugins.filter((p) => p.builtin), ...externals] }))
      for (const p of externals) applyPref(p.id)
    },

    async reloadExternal() {
      for (const p of get().plugins) if (!p.builtin && get().activeIds.includes(p.id)) teardown(p.id)
      set((s) => ({ plugins: s.plugins.filter((p) => p.builtin) }))
      await get().loadExternal()
    },

    openPluginsFolder() {
      void amadeus.openPluginsFolder()
    },

    async scaffoldSample() {
      try {
        await amadeus.scaffoldSamplePlugin()
      } catch (e) {
        useUiStore.getState().notify(String(e))
        return
      }
      await get().reloadExternal()
      useUiStore.getState().notify('已创建示例插件 hello-amadeus')
    },
  }
})

// ── 文件类型 / 嵌入渲染的匹配助手（供 amadeusNav、文件树、BlockHost、通用文件视图共用）。
// 组件要响应「插件加载后才注册」须自行订阅 usePluginStore((s) => s.fileTypes / s.embedRenderers) 再调 find*;
// 非响应式调用(nav 路由、视图挂载那一刻)用下面读快照的 match*。

/** 在给定 fileTypes 列表里按路径后缀找命中的文件类型贡献(纯函数,便于组件订阅列表后调用)。 */
export function findFileType(
  list: { item: FileTypeContribution }[],
  path: string,
): FileTypeContribution | undefined {
  const n = path.toLowerCase()
  return list.find((o) => o.item.extensions.some((ext) => n.endsWith(ext.toLowerCase())))?.item
}

/** 当前已注册文件类型里匹配 path 的那个(读快照,非响应式)。 */
export function matchFileType(path: string): FileTypeContribution | undefined {
  return findFileType(usePluginStore.getState().fileTypes, path)
}

/** 文件名去掉命中的文件类型后缀(如 `思维导图.mindmap.md` + ['.mindmap.md'] → `思维导图`);兜底剥最后一段扩展名。 */
export function fileTypeBaseName(path: string, extensions: string[]): string {
  const name = path.split(/[\\/]/).pop() || path
  const lower = name.toLowerCase()
  const ext = extensions.find((e) => lower.endsWith(e.toLowerCase()))
  return ext ? name.slice(0, name.length - ext.length) : name.replace(/\.[^.]+$/, '')
}

/** 在给定 embedRenderers 列表里找声称能渲染该 `![[target]]` 的渲染器(match 抛错视为不匹配)。 */
export function findEmbedRenderer(
  list: { item: EmbedRendererContribution }[],
  target: string,
): EmbedRendererContribution | undefined {
  return list.find((o) => {
    try {
      return o.item.match(target)
    } catch {
      return false
    }
  })?.item
}

/** 当前已注册嵌入渲染器里匹配 target 的那个(读快照,非响应式)。 */
export function matchEmbedRenderer(target: string): EmbedRendererContribution | undefined {
  return findEmbedRenderer(usePluginStore.getState().embedRenderers, target)
}
