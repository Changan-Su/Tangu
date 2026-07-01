// Command palette (Cmd/Ctrl+K): runs commands contributed by plugins. Reuses the
// shared .cmd-* overlay styles used by the quick switcher and search panel.

import { useEffect, useState, type KeyboardEvent } from 'react'
import { usePluginStore } from '../plugins/pluginStore'
import { fuzzyRank } from '../lib/fuzzy'

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const commands = usePluginStore((s) => s.commands)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
    }
  }, [open])

  if (!open) return null

  const list = commands.map((o) => o.item)
  const results = fuzzyRank(query, list, (c) => `${c.title} ${c.keywords ?? ''}`).slice(0, 40)

  const run = (i: number): void => {
    const c = results[i]
    onClose()
    if (c) c.run()
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(active)
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
          placeholder="运行命令…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
        />
        <div className="cmd-list">
          {results.map((c, i) => (
            <button
              key={c.id}
              className="cmd-item"
              data-active={i === active || undefined}
              onMouseEnter={() => setActive(i)}
              onClick={() => run(i)}
            >
              <span className="cmd-row">
                <span className="cmd-title">{c.title}</span>
              </span>
            </button>
          ))}
          {results.length === 0 && <div className="cmd-empty">没有命令</div>}
        </div>
        <div className="cmd-foot">
          <span>
            <kbd>↑↓</kbd> 选择 <kbd>↵</kbd> 运行 <kbd>esc</kbd> 关闭
          </span>
          <span className="cmd-foot-count">{results.length} 命令</span>
        </div>
      </div>
    </div>
  )
}
