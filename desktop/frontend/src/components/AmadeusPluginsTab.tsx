/**
 * 设置 → 笔记插件(Amadeus 编辑器插件管理,Obsidian 风):列内置 + 外部(vault/全局)插件,启停即时生效。
 * 数据源是 vendored 的 usePluginStore(与 Amadeus Space 同一单例);样式照 PluginsTab 的 hint/btn 约定,
 * 不复用 Amadeus 自带 SettingsDialog 的 CSS(壳设置页没加载那套类)。
 */
import React, { useEffect } from 'react'
import { usePluginStore } from '@amadeus/plugins/pluginStore'
import { installAmadeusPlugins } from '../amadeusPlugins'
import { useI18n } from '../i18n'
import type { AmadeusPlugin } from '@amadeus/plugins/types'

const badge: React.CSSProperties = {
  fontSize: 10.5, color: 'var(--text-faint)', border: 'var(--border-width) solid var(--border)',
  borderRadius: 4, padding: '0 4px', whiteSpace: 'nowrap',
}

export const AmadeusPluginsTab: React.FC = () => {
  const { t } = useI18n()
  const plugins = usePluginStore((s) => s.plugins)
  const activeIds = usePluginStore((s) => s.activeIds)
  const toggle = usePluginStore((s) => s.toggle)
  const openFolder = usePluginStore((s) => s.openPluginsFolder)
  const reload = usePluginStore((s) => s.reloadExternal)
  const scaffold = usePluginStore((s) => s.scaffoldSample)

  // 设置页可能先于 Amadeus Space 打开 → 兜底装载(幂等,installed 闸在 amadeusPlugins 内)。
  useEffect(() => { installAmadeusPlugins() }, [])

  const blockedLabel = (p: AmadeusPlugin): string =>
    p.blocked === 'api'
      ? t('settings.amadeusPlugins.blockedApi', { v: String(p.apiVersion ?? '?') })
      : t('settings.amadeusPlugins.blockedMinApp', { v: p.minAppVersion || '?' })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="hint">{t('settings.amadeusPlugins.hint')}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn ghost sm" onClick={() => openFolder()}>{t('settings.amadeusPlugins.openFolder')}</button>
        <button className="btn ghost sm" onClick={() => void reload()}>{t('settings.amadeusPlugins.reload')}</button>
        <button className="btn ghost sm" onClick={() => void scaffold()}>{t('settings.amadeusPlugins.scaffold')}</button>
      </div>
      {plugins.length === 0 && <div className="hint">{t('settings.amadeusPlugins.empty')}</div>}
      {plugins.map((p) => {
        const on = activeIds.includes(p.id)
        return (
          <div key={p.id} style={{ border: 'var(--border-width) solid var(--border)', borderRadius: 'var(--radius-lg, 10px)', padding: 12, opacity: p.blocked ? 0.6 : 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <b style={{ fontSize: 13 }}>{p.name}</b>
                  <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>v{p.version}</span>
                  <span style={badge}>{p.builtin ? t('settings.amadeusPlugins.builtin') : t('settings.amadeusPlugins.external')}</span>
                  {!p.builtin && p.source && (
                    <span style={badge}>{p.source === 'vault' ? t('settings.amadeusPlugins.sourceVault') : t('settings.amadeusPlugins.sourceGlobal')}</span>
                  )}
                  {p.blocked && (
                    <span style={{ ...badge, color: 'var(--warn, #b8860b)', borderColor: 'var(--warn, #b8860b)' }}>{blockedLabel(p)}</span>
                  )}
                </div>
                {p.description && <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2 }}>{p.description}</div>}
              </div>
              <input type="checkbox" checked={on} disabled={!!p.blocked} onChange={() => toggle(p.id)} style={{ cursor: p.blocked ? 'not-allowed' : 'pointer' }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
