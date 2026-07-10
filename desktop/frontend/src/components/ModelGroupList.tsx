/**
 * 模型选择列表:按 Provider 分组、可折叠(设置页默认全折叠,仅当前选中模型所在组展开)。
 * 同一个分组逻辑(groupModelsByProvider)供设置页与主界面模型选择器共用。
 */
import React, { useMemo, useState } from 'react'
import { ChevronRight, Check, Search } from 'lucide-react'
import type { ModelInfo } from '../types'
import { useI18n } from '../i18n'

export interface ModelGroup {
  provider: string
  source: 'forsion' | 'direct' | 'mixed'
  models: ModelInfo[]
}

/** 按 provider 聚合;组内全 forsion / 全 direct / 混合各打标。组按 provider 名排序。 */
export function groupModelsByProvider(models: ModelInfo[]): ModelGroup[] {
  const map = new Map<string, ModelInfo[]>()
  for (const m of models) {
    const k = m.provider || 'other'
    const arr = map.get(k)
    if (arr) arr.push(m)
    else map.set(k, [m])
  }
  return [...map.entries()]
    .map(([provider, ms]) => {
      const allForsion = ms.every((m) => m.source === 'forsion')
      const allDirect = ms.every((m) => m.source === 'direct')
      return { provider, source: allForsion ? 'forsion' : allDirect ? 'direct' : 'mixed', models: ms } as ModelGroup
    })
    .sort((a, b) => a.provider.localeCompare(b.provider))
}

export const ModelGroupList: React.FC<{
  models: ModelInfo[]
  selectedId?: string
  onSelect: (id: string) => void
}> = ({ models, selectedId, onSelect }) => {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const groups = useMemo(() => groupModelsByProvider(models), [models])
  // 默认全折叠;当前选中模型所在组默认展开。
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const sel = models.find((m) => m.id === selectedId)
    return new Set(sel ? [sel.provider || 'other'] : [])
  })

  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!q) return groups
    return groups
      .map((g) => ({ ...g, models: g.models.filter((m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)) }))
      .filter((g) => g.models.length > 0)
  }, [groups, q])

  const toggle = (provider: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(provider) ? next.delete(provider) : next.add(provider)
      return next
    })

  const allProviders = filtered.map((g) => g.provider)
  const allExpanded = allProviders.length > 0 && allProviders.every((p) => expanded.has(p))
  const sourceTag = (s: ModelGroup['source']): string =>
    s === 'direct' ? t('model.group.direct') : s === 'forsion' ? t('model.group.forsion') : ''

  if (!models.length) return <div className="hint">{t('model.empty')}</div>

  return (
    <div className="model-group-list">
      <div className="model-group-toolbar">
        <span className="model-search">
          <Search size={12} />
          <input value={query} placeholder={t('model.searchPlaceholder')} onChange={(e) => setQuery(e.target.value)} />
        </span>
        <button
          className="btn ghost sm"
          onClick={() => setExpanded(allExpanded ? new Set() : new Set(allProviders))}
        >
          {allExpanded ? t('model.collapseAll') : t('model.expandAll')}
        </button>
      </div>
      {filtered.map((g) => {
        const open = q ? true : expanded.has(g.provider)
        return (
          <div key={g.provider} className="model-group">
            <button className="model-group-head" onClick={() => toggle(g.provider)}>
              <ChevronRight size={13} className="model-group-chevron" style={{ transform: open ? 'rotate(90deg)' : 'none' }} />
              <span className="model-group-name">{g.provider}</span>
              {sourceTag(g.source) && <span className="model-group-tag">{sourceTag(g.source)}</span>}
              <span className="model-group-count">{g.models.length}</span>
            </button>
            {open && (
              <div className="model-group-body">
                {g.models.map((m) => (
                  <button
                    key={`${m.source}-${m.id}`}
                    className={`file-row${m.id === selectedId ? ' active' : ''}`}
                    onClick={() => onSelect(m.id)}
                  >
                    <span className="file-name" style={{ color: m.id === selectedId ? 'var(--accent-ink)' : undefined }}>
                      {m.name}
                    </span>
                    {m.id === selectedId && <Check size={12} style={{ color: 'var(--accent-ink)' }} />}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
