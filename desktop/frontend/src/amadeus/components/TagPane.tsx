// Sidebar tag pane: lists every #tag with its count; expand a tag to see (and jump to)
// the notes that carry it. Backed by the main-process index; refreshes on link-graph changes.

import { useEffect, useState } from 'react'
import { usePageStore } from '../store/pageStore'
import { amadeus } from '../api'
import type { TagCount } from '@amadeus-shared/ipc'

function baseName(p: string): string {
  return (p.split(/[\\/]/).pop() ?? p).replace(/\.md$/i, '')
}

export function TagPane() {
  const vaultRoot = usePageStore((s) => s.vaultRoot)
  const version = usePageStore((s) => s.linkGraphVersion)
  const loadPage = usePageStore((s) => s.loadPage)
  const [tags, setTags] = useState<TagCount[]>([])
  const [open, setOpen] = useState(true)
  const [openTag, setOpenTag] = useState<string | null>(null)
  const [tagPages, setTagPages] = useState<string[]>([])

  useEffect(() => {
    let live = true
    if (!vaultRoot) {
      setTags([])
      return
    }
    void amadeus.listTags().then((t) => {
      if (live) setTags(t)
    })
    return () => {
      live = false
    }
  }, [vaultRoot, version])

  useEffect(() => {
    let live = true
    if (!openTag) {
      setTagPages([])
      return
    }
    void amadeus.pagesByTag(openTag).then((p) => {
      if (live) setTagPages(p)
    })
    return () => {
      live = false
    }
  }, [openTag, version])

  if (!vaultRoot || tags.length === 0) return null

  return (
    <div className="tag-pane">
      <button className="tag-pane-head" onClick={() => setOpen((o) => !o)}>
        <span className="backlinks-chevron">{open ? '▾' : '▸'}</span>
        标签 · {tags.length}
      </button>
      {open && (
        <div className="tag-list">
          {tags.map((t) => (
            <div key={t.tag}>
              <button
                className="tag-item"
                data-active={openTag === t.tag || undefined}
                onClick={() => setOpenTag((cur) => (cur === t.tag ? null : t.tag))}
              >
                <span className="tag-name">#{t.tag}</span>
                <span className="tag-count">{t.count}</span>
              </button>
              {openTag === t.tag && (
                <div className="tag-pages">
                  {tagPages.map((p) => (
                    <button
                      key={p}
                      className="page-item tag-page"
                      onClick={() => void loadPage(p)}
                      title={p}
                    >
                      {baseName(p)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
