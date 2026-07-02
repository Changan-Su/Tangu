/** Amadeus 侧栏面板(Tangu 原生 amx- 外观,只复用 vendored 组件的逻辑):全文搜索 / 标签 / 局部关系图。 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import { usePageStore } from '@amadeus/store/pageStore'
import { amadeus } from '@amadeus/api'
import type { SearchHit, TagCount } from '@amadeus-shared/ipc'
import { parseWikiLinks, resolvePageName } from '@amadeus-shared/links'
import { openNote } from './amadeusNav'

const ps = () => usePageStore.getState()
const baseName = (p: string): string => (p.split(/[\\/]/).pop() ?? p).replace(/\.md$/i, '')

// ─────────────────────────────── 全文搜索(左栏 tab;后端 = 主进程 vault 索引) ───────────────────────────────

export function AmadeusSearchView() {
  const vaultRoot = usePageStore((s) => s.vaultRoot)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const seq = useRef(0)

  // 挂载先落盘当前编辑,让最新内容可检索(vendored SearchPanel 同款)。
  useEffect(() => { void ps().flushSave() }, [])
  useEffect(() => {
    const q = query.trim()
    if (!q) { setHits([]); return }
    const id = ++seq.current
    const t = setTimeout(() => { void amadeus.search(q).then((r) => { if (id === seq.current) setHits(r) }) }, 120)
    return () => clearTimeout(t)
  }, [query])

  // 命中 → 打开笔记 → 滚到首个含关键词的块并短暂高亮。
  // SearchHit.line 是对 strip 后文本的行号(不可靠),按块内容匹配定位更稳。
  const choose = (h: SearchHit): void => {
    const q = query.trim().toLowerCase()
    void openNote(h.path).then(() => {
      if (!q) return
      const hit = Object.values(ps().blocks).find((b) => b.content.toLowerCase().includes(q))
      if (!hit) return
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-block-id="${hit.id}"]`)
        if (!el) return
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.add('amx-block-flash')
        setTimeout(() => el.classList.remove('amx-block-flash'), 1300)
      })
    })
  }

  return (
    <div className="amx-panel">
      <div className="amx-panel-head">全文搜索</div>
      <div className="t2s-search amx-search-box">
        <Search size={13} className="t2s-dim" />
        <input autoFocus value={query} placeholder="搜索全部笔记…" onChange={(e) => setQuery(e.target.value)} />
      </div>
      {!vaultRoot ? (
        <div className="amx-panel-empty">先打开一个 Vault。</div>
      ) : !query.trim() ? (
        <div className="amx-panel-empty">输入关键词,搜遍全部笔记内容。</div>
      ) : hits.length === 0 ? (
        <div className="amx-panel-empty">无结果</div>
      ) : (
        <div className="amx-list">
          {hits.map((h) => (
            <button key={h.path} className="amx-list-item" onClick={() => choose(h)} title={h.path}>
              {h.title}
              {h.snippet && <span className="amx-backlink-snippet amx-search-snippet">{highlight(h.snippet, query.trim())}</span>}
            </button>
          ))}
        </div>
      )}
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

// ─────────────────────────────── 标签(左栏 tab;#tag 计数 + 展开跳转) ───────────────────────────────

export function AmadeusTagsView() {
  const vaultRoot = usePageStore((s) => s.vaultRoot)
  const version = usePageStore((s) => s.linkGraphVersion)
  const [tags, setTags] = useState<TagCount[]>([])
  const [openTag, setOpenTag] = useState<string | null>(null)
  const [tagPages, setTagPages] = useState<string[]>([])

  useEffect(() => {
    let live = true
    if (!vaultRoot) { setTags([]); return }
    void amadeus.listTags().then((t) => { if (live) setTags(t) })
    return () => { live = false }
  }, [vaultRoot, version])
  useEffect(() => {
    let live = true
    if (!openTag) { setTagPages([]); return }
    void amadeus.pagesByTag(openTag).then((p) => { if (live) setTagPages(p) })
    return () => { live = false }
  }, [openTag, version])

  return (
    <div className="amx-panel">
      <div className="amx-panel-head">标签 · {tags.length}</div>
      {!vaultRoot ? (
        <div className="amx-panel-empty">先打开一个 Vault。</div>
      ) : tags.length === 0 ? (
        <div className="amx-panel-empty">还没有 #标签。在笔记里写 #灵感 这样的行内标签即可出现在这里。</div>
      ) : (
        <div className="amx-list">
          {tags.map((t) => (
            <div key={t.tag}>
              <button
                className={`amx-list-item amx-tag${openTag === t.tag ? ' active' : ''}`}
                onClick={() => setOpenTag((cur) => (cur === t.tag ? null : t.tag))}
              >
                <span className="amx-tag-name">#{t.tag}</span>
                <span className="amx-tag-count">{t.count}</span>
              </button>
              {openTag === t.tag && tagPages.map((p) => (
                <button key={p} className="amx-list-item amx-tag-page" onClick={() => void openNote(p)} title={p}>
                  {baseName(p)}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────── 局部关系图(右栏 tab;当前笔记的出/入链) ───────────────────────────────

interface GNode { path: string; label: string; center: boolean; x: number; y: number; vx: number; vy: number }
interface GEdge { a: number; b: number }

const W = 320
const H = 280

/** 手写微型力导向(斥力 + 弹簧 + 向心,~300 tick 收敛后停):节点少(局部图),无需依赖。 */
function simulate(nodes: GNode[], edges: GEdge[], ticks: number): void {
  const cx = W / 2
  const cy = H / 2
  for (let t = 0; t < ticks; t++) {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]
      if (n.center) continue
      let fx = (cx - n.x) * 0.005 // 向心
      let fy = (cy - n.y) * 0.005
      for (let j = 0; j < nodes.length; j++) {
        if (i === j) continue
        const o = nodes[j]
        const dx = n.x - o.x
        const dy = n.y - o.y
        const d2 = Math.max(64, dx * dx + dy * dy)
        const f = 1400 / d2 // 斥力
        fx += (dx / Math.sqrt(d2)) * f
        fy += (dy / Math.sqrt(d2)) * f
      }
      for (const e of edges) {
        if (e.a !== i && e.b !== i) continue
        const o = nodes[e.a === i ? e.b : e.a]
        const dx = o.x - n.x
        const dy = o.y - n.y
        const d = Math.max(1, Math.hypot(dx, dy))
        const f = (d - 86) * 0.02 // 弹簧,静止长 86
        fx += (dx / d) * f
        fy += (dy / d) * f
      }
      n.vx = (n.vx + fx) * 0.82 // 阻尼
      n.vy = (n.vy + fy) * 0.82
      n.x = Math.min(W - 16, Math.max(16, n.x + n.vx))
      n.y = Math.min(H - 16, Math.max(16, n.y + n.vy))
    }
  }
}

export function AmadeusLocalGraphView() {
  const activePage = usePageStore((s) => s.activePage)
  const version = usePageStore((s) => s.linkGraphVersion)
  const [graph, setGraph] = useState<{ nodes: GNode[]; edges: GEdge[] } | null>(null)

  useEffect(() => {
    let live = true
    if (!activePage) { setGraph(null); return }
    void (async () => {
      const incoming = await amadeus.backlinks(activePage).catch(() => [])
      if (!live) return
      const st = ps()
      const contents = Object.values(st.blocks).map((b) => b.content).join('\n')
      const outs = [...new Set(
        parseWikiLinks(contents)
          .map((n) => resolvePageName(n, st.pages))
          .filter((x): x is string => !!x && x !== activePage),
      )]
      const others = [...new Set([...outs, ...incoming.map((r) => r.path).filter((p) => p !== activePage)])]
      const nodes: GNode[] = [
        { path: activePage, label: baseName(activePage), center: true, x: W / 2, y: H / 2, vx: 0, vy: 0 },
        ...others.map((p, i) => {
          const ang = (i / Math.max(1, others.length)) * Math.PI * 2
          return { path: p, label: baseName(p), center: false, x: W / 2 + Math.cos(ang) * 90, y: H / 2 + Math.sin(ang) * 90, vx: 0, vy: 0 }
        }),
      ]
      const idx = new Map(nodes.map((n, i) => [n.path, i]))
      const edges: GEdge[] = []
      const seen = new Set<string>()
      for (const p of [...outs, ...incoming.map((r) => r.path)]) {
        const b = idx.get(p)
        if (b === undefined || seen.has(p)) continue
        seen.add(p)
        edges.push({ a: 0, b })
      }
      simulate(nodes, edges, 300)
      if (live) setGraph({ nodes, edges })
    })()
    return () => { live = false }
  }, [activePage, version])

  return (
    <div className="amx-panel">
      <div className="amx-panel-head">关系图 · 当前笔记</div>
      {!activePage ? (
        <div className="amx-panel-empty">未打开笔记</div>
      ) : !graph || graph.nodes.length <= 1 ? (
        <div className="amx-panel-empty">这篇笔记还没有链接(出链 [[…]] 或反链)。</div>
      ) : (
        <svg className="amx-graph" viewBox={`0 0 ${W} ${H}`}>
          {graph.edges.map((e, i) => (
            <line
              key={i}
              x1={graph.nodes[e.a].x} y1={graph.nodes[e.a].y}
              x2={graph.nodes[e.b].x} y2={graph.nodes[e.b].y}
              className="amx-graph-edge"
            />
          ))}
          {graph.nodes.map((n) => (
            <g key={n.path} className={`amx-graph-node${n.center ? ' center' : ''}`} onClick={() => { if (!n.center) void openNote(n.path) }}>
              <circle cx={n.x} cy={n.y} r={n.center ? 8 : 5.5} />
              <text x={n.x} y={n.y + (n.center ? 20 : 16)} textAnchor="middle">{n.label.length > 12 ? `${n.label.slice(0, 12)}…` : n.label}</text>
            </g>
          ))}
        </svg>
      )}
    </div>
  )
}
