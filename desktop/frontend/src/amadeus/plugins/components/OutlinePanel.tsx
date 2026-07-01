// Sidebar panel contributed by the built-in "outline" plugin: lists the active page's
// headings (in document order) and scrolls to a block on click.

import { useMemo } from 'react'
import { usePageStore } from '../../store/pageStore'

interface Head {
  id: string
  level: number
  text: string
  key: string
}

export function OutlinePanel() {
  const manifest = usePageStore((s) => s.manifest)
  const blocks = usePageStore((s) => s.blocks)

  const heads = useMemo<Head[]>(() => {
    if (!manifest) return []
    const out: Head[] = []
    for (const row of manifest.root.children)
      for (const col of row.columns)
        for (const ref of col.children) {
          const content = blocks[ref.ref]?.content ?? ''
          for (const line of content.split('\n')) {
            const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line.trim())
            if (m) out.push({ id: ref.ref, level: m[1].length, text: m[2], key: `${ref.ref}:${out.length}` })
          }
        }
    return out
  }, [manifest, blocks])

  if (heads.length === 0) return <div className="panel-empty">没有标题</div>

  const goto = (id: string): void => {
    document
      .querySelector(`[data-block-id="${id}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="outline">
      {heads.map((h) => (
        <button
          key={h.key}
          className="outline-item"
          data-level={h.level}
          style={{ paddingLeft: 8 + (h.level - 1) * 12 }}
          onClick={() => goto(h.id)}
          title={h.text}
        >
          {h.text}
        </button>
      ))}
    </div>
  )
}
