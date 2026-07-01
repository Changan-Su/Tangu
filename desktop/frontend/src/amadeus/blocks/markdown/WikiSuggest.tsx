// Popup for [[ autocomplete. Suggests page names (fuzzy) and lets the user insert one.
// Only intercepts navigation keys (Arrow/Enter/Tab/Esc) in the capture phase — letters
// and Backspace fall through to ProseMirror so the in-document query keeps updating.

import { useEffect, useState } from 'react'
import { fuzzyRank } from '../../lib/fuzzy'
import { pageKey } from '@amadeus-shared/links'

interface Props {
  query: string
  left: number
  top: number
  getPageNames: () => string[]
  onPick: (name: string) => void
  onClose: () => void
}

function baseName(p: string): string {
  return (p.split(/[\\/]/).pop() ?? p).replace(/\.md$/i, '')
}

export function WikiSuggest({ query, left, top, getPageNames, onPick, onClose }: Props) {
  const [active, setActive] = useState(0)

  const names = Array.from(new Set(getPageNames().map(baseName)))
  const results = fuzzyRank(query, names, (n) => n).slice(0, 8)
  const q = query.trim()
  const showCreate = q.length > 0 && !names.some((n) => pageKey(n) === pageKey(q))
  const total = results.length + (showCreate ? 1 : 0)

  useEffect(() => {
    setActive(0)
  }, [query])

  useEffect(() => {
    const pick = (i: number): void => {
      if (showCreate && i === results.length) onPick(q)
      else if (results[i]) onPick(results[i])
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
    else if (results[i]) onPick(results[i])
  }

  if (total === 0) return null

  return (
    <div className="wiki-suggest" style={{ left, top }} role="menu">
      {results.map((n, i) => (
        <button
          key={n}
          className="wiki-item"
          data-active={i === active || undefined}
          onMouseEnter={() => setActive(i)}
          onMouseDown={(e) => {
            e.preventDefault()
            pick(i)
          }}
          role="menuitem"
        >
          {n}
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
