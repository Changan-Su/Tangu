// "Linked mentions" for the active page: notes that point here via a [[wikilink]].
// Refreshes when the active page changes or the link graph version bumps (save / external edit).

import { useEffect, useState } from 'react'
import { usePageStore } from '../store/pageStore'
import { amadeus } from '../api'
import type { BacklinkRef } from '@amadeus-shared/ipc'

export function BacklinksPanel() {
  const activePage = usePageStore((s) => s.activePage)
  const version = usePageStore((s) => s.linkGraphVersion)
  const loadPage = usePageStore((s) => s.loadPage)
  const [refs, setRefs] = useState<BacklinkRef[]>([])
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    let live = true
    if (!activePage) {
      setRefs([])
      return
    }
    void amadeus.backlinks(activePage).then((r) => {
      if (live) setRefs(r)
    })
    return () => {
      live = false
    }
  }, [activePage, version])

  if (!activePage) return null

  return (
    <section className="backlinks">
      <button className="backlinks-head" onClick={() => setCollapsed((c) => !c)}>
        <span className="backlinks-chevron">{collapsed ? '▸' : '▾'}</span>
        链接到本页 · {refs.length}
      </button>
      {!collapsed && (
        <div className="backlinks-list">
          {refs.length === 0 && <div className="backlinks-empty">还没有其它页面链接到这里</div>}
          {refs.map((r) => (
            <button
              key={r.path}
              className="page-item backlink-item"
              onClick={() => void loadPage(r.path)}
              title={r.path}
            >
              <span className="backlink-title">{r.title}</span>
              {r.snippet && <span className="backlink-snippet">{r.snippet}</span>}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
