// Cmd/Ctrl+P quick switcher: fuzzy-jump to any page by name (pure renderer).

import { useEffect, useState, type KeyboardEvent } from 'react'
import { usePageStore } from '../store/pageStore'
import { fuzzyRank } from '../lib/fuzzy'
import { pageKey } from '@amadeus-shared/links'

function basename(p: string): string {
  return (p.split(/[\\/]/).pop() ?? p).replace(/\.md$/i, '')
}

export function QuickSwitcher({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pages = usePageStore((s) => s.pages)
  const loadPage = usePageStore((s) => s.loadPage)
  const openWikiLink = usePageStore((s) => s.openWikiLink)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
    }
  }, [open])

  if (!open) return null

  const results = fuzzyRank(query, pages, pageKey).slice(0, 30)
  const q = query.trim()
  const showCreate = q.length > 0 && !pages.some((p) => pageKey(p) === pageKey(q))
  const total = results.length + (showCreate ? 1 : 0)

  const choose = (i: number): void => {
    if (showCreate && i === results.length) openWikiLink(q)
    else if (results[i]) void loadPage(results[i])
    onClose()
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, total - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(active)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div className="cmd-overlay" onMouseDown={onClose}>
      <div className="cmd-panel" onMouseDown={(e) => e.stopPropagation()}>
        <input
          className="cmd-input"
          autoFocus
          placeholder="跳转到页面…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
        />
        <div className="cmd-list">
          {results.map((p, i) => (
            <button
              key={p}
              className="cmd-item"
              data-active={i === active || undefined}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(i)}
            >
              <span className="cmd-row">
                <span className="cmd-title">{basename(p)}</span>
                <span className="cmd-path">{p}</span>
              </span>
            </button>
          ))}
          {showCreate && (
            <button
              className="cmd-item"
              data-active={active === results.length || undefined}
              onMouseEnter={() => setActive(results.length)}
              onClick={() => choose(results.length)}
            >
              <span className="cmd-row">
                <span className="cmd-title">新建 “{q}”</span>
                <span className="cmd-path">创建新页面</span>
              </span>
            </button>
          )}
          {total === 0 && <div className="cmd-empty">无匹配页面</div>}
        </div>
        <div className="cmd-foot">
          <span>
            <kbd>↑↓</kbd> 选择 <kbd>↵</kbd> 打开 <kbd>esc</kbd> 关闭
          </span>
          <span className="cmd-foot-count">{total} 项</span>
        </div>
      </div>
    </div>
  )
}
