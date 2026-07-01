// Cmd/Ctrl+Shift+F global search: queries the main-process vault index.
// On open it flushes any pending save so the active page's latest edits are searchable.

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { usePageStore } from '../store/pageStore'
import { amadeus } from '../api'
import type { SearchHit } from '@amadeus-shared/ipc'

export function SearchPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const loadPage = usePageStore((s) => s.loadPage)
  const flushSave = usePageStore((s) => s.flushSave)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [active, setActive] = useState(0)
  const seq = useRef(0)

  useEffect(() => {
    if (open) {
      setQuery('')
      setHits([])
      setActive(0)
      void flushSave()
    }
  }, [open, flushSave])

  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (!q) {
      setHits([])
      return
    }
    const id = ++seq.current
    const t = setTimeout(() => {
      void amadeus.search(q).then((r) => {
        if (id === seq.current) {
          setHits(r)
          setActive(0)
        }
      })
    }, 120)
    return () => clearTimeout(t)
  }, [query, open])

  if (!open) return null

  const choose = (i: number): void => {
    if (hits[i]) void loadPage(hits[i].path)
    onClose()
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, hits.length - 1))
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
          placeholder="搜索全部笔记…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="cmd-list">
          {hits.map((h, i) => (
            <button
              key={h.path}
              className="cmd-item"
              data-active={i === active || undefined}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(i)}
            >
              <span className="cmd-row">
                <span className="cmd-title">{h.title}</span>
                <span className="cmd-path">{h.path}</span>
              </span>
              {h.snippet && <span className="cmd-snippet">{highlight(h.snippet, query.trim())}</span>}
            </button>
          ))}
          {query.trim() && hits.length === 0 && <div className="cmd-empty">无结果</div>}
        </div>
        <div className="cmd-foot">
          <span>
            <kbd>↑↓</kbd> 选择 <kbd>↵</kbd> 打开 <kbd>esc</kbd> 关闭
          </span>
          <span className="cmd-foot-count">{query.trim() ? `${hits.length} 结果` : '全文搜索'}</span>
        </div>
      </div>
    </div>
  )
}

function highlight(snippet: string, q: string): ReactNode {
  if (!q) return snippet
  const idx = snippet.toLowerCase().indexOf(q.toLowerCase())
  if (idx < 0) return snippet
  return (
    <>
      {snippet.slice(0, idx)}
      <mark>{snippet.slice(idx, idx + q.length)}</mark>
      {snippet.slice(idx + q.length)}
    </>
  )
}
