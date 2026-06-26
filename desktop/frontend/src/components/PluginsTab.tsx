/**
 * 设置 → 插件(Obsidian 风):列出所有插件(内置 + 文件夹)、各带启用开关;启用且有 schema 的插件可展开
 * 设置面板(作用域 全局 / 按 agent)。面板由 PluginSettingsForm 据 schema 通用渲染。仅本地后端可用。
 */
import React, { useEffect, useState } from 'react'
import { listPlugins, setPluginEnabled, listAgents, type PluginInfo } from '../services/backendService'
import type { NormalAgentDef, TanguDesktopConfig } from '../types'
import { useI18n } from '../i18n'
import { PluginSettingsForm } from './PluginSettingsForm'

export const PluginsTab: React.FC<{ cfg: TanguDesktopConfig }> = ({ cfg }) => {
  const { t, locale } = useI18n()
  const [plugins, setPlugins] = useState<PluginInfo[] | null>(null)
  const [agents, setAgents] = useState<NormalAgentDef[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [scopeMode, setScopeMode] = useState<'global' | 'agent'>('global')
  const [agentSlug, setAgentSlug] = useState('')
  const nm = (p: PluginInfo): string => (locale === 'en' && p.nameEn ? p.nameEn : p.name)
  const ds = (p: PluginInfo): string => (locale === 'en' && p.descriptionEn ? p.descriptionEn : p.description)

  const load = (): void => { void listPlugins(cfg).then(setPlugins).catch(() => setPlugins([])) }
  useEffect(() => {
    load()
    void listAgents(cfg).then(setAgents).catch(() => { /* ignore */ })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggle = async (p: PluginInfo): Promise<void> => {
    try { await setPluginEnabled(cfg, p.id, !p.enabled); load() } catch { /* ignore */ }
  }
  const openPanel = (p: PluginInfo): void => {
    if (openId === p.id) { setOpenId(null); return }
    setOpenId(p.id); setScopeMode('global'); setAgentSlug(agents[0]?.slug || '')
  }
  const scopeStr = scopeMode === 'agent' && agentSlug ? `agent:${agentSlug}` : 'global'

  if (!plugins) return <div className="hint">{t('common.loading')}</div>
  if (!plugins.length) return <div className="hint">{t('settings.plugins.empty')}</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {plugins.map((p) => (
        <div key={p.id} style={{ border: 'var(--border-width) solid var(--border)', borderRadius: 'var(--radius-lg, 10px)', padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <b style={{ fontSize: 13 }}>{nm(p)}</b>
                <span style={{ fontSize: 10.5, color: 'var(--text-faint)', border: 'var(--border-width) solid var(--border)', borderRadius: 4, padding: '0 4px' }}>
                  {p.source === 'folder' ? t('settings.plugins.folder') : t('settings.plugins.builtin')}
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2 }}>{ds(p)}</div>
            </div>
            {p.settings && p.enabled && (
              <button className="btn ghost sm" onClick={() => openPanel(p)}>{t('common.edit')}</button>
            )}
            <input type="checkbox" checked={p.enabled} onChange={() => void toggle(p)} style={{ cursor: 'pointer' }} />
          </div>

          {openId === p.id && p.settings && p.enabled && (
            <div style={{ marginTop: 10, borderTop: 'var(--border-width) solid var(--border)', paddingTop: 10 }}>
              {p.scopes.includes('agent') && (
                <div className="field">
                  <label>{t('settings.plugins.scope')}</label>
                  <div className="seg" style={{ marginBottom: 6 }}>
                    <button className={scopeMode === 'global' ? 'active' : ''} onClick={() => setScopeMode('global')}>{t('settings.plugins.scopeGlobal')}</button>
                    <button className={scopeMode === 'agent' ? 'active' : ''} onClick={() => setScopeMode('agent')}>{t('settings.plugins.scopeAgent')}</button>
                  </div>
                  {scopeMode === 'agent' && (
                    <select value={agentSlug} onChange={(e) => setAgentSlug(e.target.value)}>
                      {agents.length === 0 && <option value="">{t('settings.plugins.selectAgent')}</option>}
                      {agents.map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}
                    </select>
                  )}
                </div>
              )}
              {p.settings.fields.length === 0
                ? <div className="hint">{t('settings.plugins.noSettings')}</div>
                : <PluginSettingsForm key={`${p.id}:${scopeStr}`} cfg={cfg} pluginId={p.id} scope={scopeStr} fields={p.settings.fields} />}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
