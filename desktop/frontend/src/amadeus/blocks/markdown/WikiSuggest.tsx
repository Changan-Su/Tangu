// Popup for [[ autocomplete. Suggests pages (fuzzy) and lets the user insert one.
// Obsidian 式:候选不按 basename 去重 —— 每个路径一行(名字加粗 + 目录副标题),重名时插入
// 带路径的链接 `dir/Name|Name`(「唯一即最短」);onPick 收到的就是最终 [[ ]] 内文。
// Only intercepts navigation keys (Arrow/Enter/Tab/Esc) in the capture phase — letters
// and Backspace fall through to ProseMirror so the in-document query keeps updating.

import { useEffect, useState } from 'react'
import { fuzzyScore } from '../../lib/fuzzy'
import { pageKey } from '@amadeus-shared/links'

interface Props {
  query: string
  left: number
  top: number
  getPageNames: () => string[]
  /** 参数 = 最终 [[ ]] 内文(裸名或 `dir/Name|Name`);创建行传原查询串。 */
  onPick: (linkInner: string) => void
  onClose: () => void
  /** false = 不提供「新建链接」行(@ 提及场景:无匹配即整体消失,不劫持 Enter)。 */
  allowCreate?: boolean
}

interface Cand {
  path: string
  base: string
}

function baseName(p: string): string {
  return (p.split(/[\\/]/).pop() ?? p).replace(/\.md$/i, '')
}

function dirOf(p: string): string {
  const q = p.replace(/\\/g, '/')
  const i = q.lastIndexOf('/')
  return i === -1 ? '' : q.slice(0, i)
}

export function WikiSuggest({ query, left, top, getPageNames, onPick, onClose, allowCreate = true }: Props) {
  const [active, setActive] = useState(0)

  const cands: Cand[] = getPageNames().map((p) => ({ path: p, base: baseName(p) }))
  const dupes = new Map<string, number>()
  for (const c of cands) dupes.set(pageKey(c.base), (dupes.get(pageKey(c.base)) ?? 0) + 1)
  // 名字命中优先(+1000)、仅路径命中垫底;sort 稳定 → 同分保持入参顺序(@ 提及 recents-first 不乱)。
  const scored = cands
    .map((c) => {
      const sName = fuzzyScore(query, c.base)
      const s = sName !== null ? sName + 1000 : fuzzyScore(query, c.path)
      return s === null ? null : { c, s }
    })
    .filter((x): x is { c: Cand; s: number } => x !== null)
  scored.sort((a, b) => b.s - a.s)
  const results = scored.slice(0, 8).map((x) => x.c)
  const q = query.trim()
  const showCreate = allowCreate && q.length > 0 && !cands.some((c) => pageKey(c.base) === pageKey(q))
  const total = results.length + (showCreate ? 1 : 0)

  /** 「唯一即最短」:basename 全库唯一 → 裸名;重名 → `dir/Name|Name`(路径解析 + 别名显示)。 */
  const linkInner = (c: Cand): string =>
    (dupes.get(pageKey(c.base)) ?? 0) > 1
      ? `${c.path.replace(/\\/g, '/').replace(/\.md$/i, '')}|${c.base}`
      : c.base

  useEffect(() => {
    setActive(0)
  }, [query])

  useEffect(() => {
    const pick = (i: number): void => {
      if (showCreate && i === results.length) onPick(q)
      else if (results[i]) onPick(linkInner(results[i]))
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        setActive((a) => Math.min(a + 1, total - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        setActive((a) => Math.max(a - 1, 0))
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        pick(active)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const pick = (i: number): void => {
    if (showCreate && i === results.length) onPick(q)
    else if (results[i]) onPick(linkInner(results[i]))
  }

  if (total === 0) return null

  return (
    <div className="wiki-suggest" style={{ left, top }} role="menu">
      {results.map((c, i) => (
        <button
          key={c.path}
          className="wiki-item"
          data-active={i === active || undefined}
          onMouseEnter={() => setActive(i)}
          onMouseDown={(e) => {
            e.preventDefault()
            pick(i)
          }}
          role="menuitem"
        >
          <span className="wiki-item-name">{c.base}</span>
          <span className="wiki-item-path">{dirOf(c.path) || '/'}</span>
        </button>
      ))}
      {showCreate && (
        <button
          className="wiki-item wiki-create"
          data-active={active === results.length || undefined}
          onMouseEnter={() => setActive(results.length)}
          onMouseDown={(e) => {
            e.preventDefault()
            pick(results.length)
          }}
          role="menuitem"
        >
          新建链接 “{q}”
        </button>
      )}
    </div>
  )
}
