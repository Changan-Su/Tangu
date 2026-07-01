// The Settings interface — a modal with a left nav. Houses appearance (theme) and
// plugin management. Opened from the sidebar gear (palette === 'settings').

import { useEffect, useState } from 'react'
import { usePluginStore } from '../plugins/pluginStore'
import { AppearanceSettings } from './ThemePicker'

type Section = 'appearance' | 'plugins' | 'about'

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [section, setSection] = useState<Section>('appearance')

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="settings-overlay" onMouseDown={onClose}>
      <div className="settings" onMouseDown={(e) => e.stopPropagation()}>
        <nav className="settings-nav">
          <div className="settings-nav-title">设置</div>
          <button
            className="settings-navitem"
            data-active={section === 'appearance' || undefined}
            onClick={() => setSection('appearance')}
          >
            外观
          </button>
          <button
            className="settings-navitem"
            data-active={section === 'plugins' || undefined}
            onClick={() => setSection('plugins')}
          >
            插件
          </button>
          <button
            className="settings-navitem"
            data-active={section === 'about' || undefined}
            onClick={() => setSection('about')}
          >
            关于
          </button>
        </nav>
        <div className="settings-body">
          <button className="settings-close" onClick={onClose} aria-label="关闭">
            ✕
          </button>
          {section === 'appearance' && <AppearanceSettings />}
          {section === 'plugins' && <PluginsSettings />}
          {section === 'about' && <AboutSettings />}
        </div>
      </div>
    </div>
  )
}

function PluginsSettings() {
  const plugins = usePluginStore((s) => s.plugins)
  const activeIds = usePluginStore((s) => s.activeIds)
  const toggle = usePluginStore((s) => s.toggle)
  const openFolder = usePluginStore((s) => s.openPluginsFolder)
  const reload = usePluginStore((s) => s.reloadExternal)
  const scaffold = usePluginStore((s) => s.scaffoldSample)

  return (
    <div className="settings-section">
      <div className="settings-hint">
        启用 / 禁用插件（即时生效）。外部插件放在 Vault 的 <code>.amadeus/plugins/</code> 下，每个插件一个文件夹（含 <code>manifest.json</code> + <code>main.js</code>）。
      </div>
      <div className="settings-btn-row">
        <button className="settings-btn" onClick={() => openFolder()}>
          打开插件文件夹
        </button>
        <button className="settings-btn" onClick={() => void reload()}>
          重新加载
        </button>
        <button className="settings-btn" onClick={() => void scaffold()}>
          创建示例插件
        </button>
      </div>
      <div className="plugin-list">
        {plugins.map((p) => {
          const on = activeIds.includes(p.id)
          return (
            <div key={p.id} className="plugin-row">
              <div className="plugin-meta">
                <div className="plugin-name">
                  {p.name}
                  <span className="plugin-ver">v{p.version}</span>
                  <span className="plugin-badge" data-external={!p.builtin || undefined}>
                    {p.builtin ? '内置' : '外部'}
                  </span>
                </div>
                {p.description && <div className="plugin-desc">{p.description}</div>}
              </div>
              <button
                className="toggle"
                data-on={on || undefined}
                role="switch"
                aria-checked={on}
                title={on ? '点击禁用' : '点击启用'}
                onClick={() => toggle(p.id)}
              >
                <span className="toggle-knob" />
              </button>
            </div>
          )
        })}
        {plugins.length === 0 && <div className="settings-hint">还没有任何插件。</div>}
      </div>
    </div>
  )
}

function AboutSettings() {
  return (
    <div className="settings-section">
      <div className="about-title">Amadeus</div>
      <div className="settings-hint">本地优先的块编辑笔记 —— Obsidian 之根 + Notion 之块。</div>
      <div className="settings-hint">
        快捷键：<kbd>⌘/Ctrl P</kbd> 快速切换 · <kbd>⌘/Ctrl ⇧ F</kbd> 搜索 · <kbd>⌘/Ctrl K</kbd> 命令 ·
        键入 <kbd>/</kbd> 选择块 · <kbd>[[</kbd> 链接页面
      </div>
    </div>
  )
}
