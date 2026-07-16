/** 全局快速查找(Notion quick-find 式,居中悬浮):按名称模糊搜 笔记 / 数据库 / chat 会话,回车打开。
 *  空态显示最近(localStorage 记录,回退最近更新的会话)。ribbon 搜索图标 / ⌘P 唤起;挂在 Root。 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { create } from 'zustand'
import './quickFind.css'
import { Search, FileText, Database, MessageSquare } from 'lucide-react'
import { openSession } from './sessionNav'
import { usePageStore } from './amadeus/store/pageStore'
import { useAllDatabases } from './amadeus/store/dbAggregateStore'
import { fuzzyScore } from './amadeus/lib/fuzzy'
import { useApp } from './stores/appStore'
import { openNote, openDb } from './amadeusNav'

interface QFState { open: boolean; openPalette(): void; close(): void }
export const useQuickFind = create<QFState>((set) => ({
  open: false,
  openPalette: () => set({ open: true }),
  close: () => set({ open: false }),
}))

type Kind = 'note' | 'db' | 'session'
interface Recent { kind: Kind; id: string; title: string; sub?: string; emoji?: string }
const RKEY = 'forsion.quickfind.recents'
const loadRecents = (): Recent[] => {
  try {
    return JSON.parse(localStorage.getItem(RKEY) || '[]') as Recent[]
  } catch {
    return []
  }
}
const pushRecent = (r: Recent): void => {
  const cur = loadRecents().filter((x) => !(x.kind === r.kind && x.id === r.id))
  try {
    localStorage.setItem(RKEY, JSON.stringify([r, ...cur].slice(0, 24)))
  } catch {
    /* ignore */
  }
}

const base = (p: string): string => (p.split(/[\\/]/).pop() ?? p).replace(/\.(md|db)$/i, '')
const dirOf = (p: string): string => p.replace(/\\/g, '/').split('/').slice(0, -1).join('/') || '/'

interface Item { kind: Kind; id: string; title: string; sub: string; emoji?: string; open: () => void }

export function QuickFind() {
  const open = useQuickFind((s) => s.open)
  if (!open) return null
  return <QuickFindInner />
}

function QuickFindInner() {
  const close = useQuickFind((s) => s.close)
  const pages = usePageStore((s) => s.pages)
  const dbs = useAllDatabases()
  const sessions = useApp((s) => s.sessions)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // 全部候选(名称快切)。open 内构建 → 只在面板打开时加载 .db。
  const all = useMemo<Item[]>(() => {
    const notes: Item[] = pages
      .filter((p) => /\.md$/i.test(p))
      .map((p) => ({ kind: 'note', id: p, title: base(p), sub: dirOf(p), open: () => void openNote(p) }))
    const dbItems: Item[] = dbs.map((d) => ({ kind: 'db', id: d.path, title: d.name || base(d.path), sub: dirOf(d.path), open: () => openDb(d.path) }))
    const sess: Item[] = sessions.map((s) => ({
      kind: 'session',
      id: s.id,
      title: s.title || '未命名会话',
      sub: '会话',
      emoji: s.emoji ?? undefined,
      open: () => openSession(s.id),
    }))
    return [...notes, ...dbItems, ...sess]
  }, [pages, dbs, sessions])

  const results = useMemo<Item[]>(() => {
    const needle = q.trim()
    if (needle) {
      return all
        .map((it) => ({ it, s: fuzzyScore(needle, it.title) }))
        .filter((x): x is { it: Item; s: number } => x.s !== null)
        .sort((a, b) => b.s - a.s)
        .slice(0, 30)
        .map((x) => x.it)
    }
    const byKey = new Map(all.map((it) => [`${it.kind}:${it.id}`, it]))
    const recent = loadRecents().map((r) => byKey.get(`${r.kind}:${r.id}`)).filter((x): x is Item => !!x)
    if (recent.length) return recent.slice(0, 12)
    // 回退:最近更新的会话(唯一有可靠时间戳的源)。
    return [...sessions]
      .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
      .slice(0, 8)
      .map((s) => byKey.get(`session:${s.id}`))
      .filter((x): x is Item => !!x)
  }, [q, all, sessions])

  useEffect(() => setSel(0), [q])
  useEffect(() => inputRef.current?.focus(), [])

  const openItem = (it: Item): void => {
    pushRecent({ kind: it.kind, id: it.id, title: it.title, sub: it.sub, emoji: it.emoji })
    it.open()
    close()
  }

  const onKey = (e: ReactKeyboardEvent): void => {
    if (e.key === 'Escape') { e.preventDefault(); close() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(i + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); const it = results[sel]; if (it) openItem(it) }
  }

  const icon = (k: Kind, emoji?: string): ReactNode =>
    emoji ? <span className="amx-qf-emoji">{emoji}</span> : k === 'db' ? <Database size={15} /> : k === 'session' ? <MessageSquare size={15} /> : <FileText size={15} />

  return (
    <div className="amx-qf-scrim" onMouseDown={close}>
      <div className="amx-qf" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="amx-qf-head">
          <Search size={16} className="amx-qf-searchicon" />
          <input ref={inputRef} className="amx-qf-input" placeholder="搜索笔记、数据库、会话…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="amx-qf-list">
          {!q.trim() && results.length > 0 && <div className="amx-qf-sec">最近</div>}
          {results.map((it, i) => (
            <button
              key={`${it.kind}:${it.id}`}
              className={`amx-qf-row${i === sel ? ' sel' : ''}`}
              onMouseMove={() => setSel(i)}
              onClick={() => openItem(it)}
            >
              <span className="amx-qf-icon">{icon(it.kind, it.emoji)}</span>
              <span className="amx-qf-title">{it.title}</span>
              <span className="amx-qf-sub">{it.sub}</span>
            </button>
          ))}
          {results.length === 0 && <div className="amx-qf-empty">{q.trim() ? '无匹配' : '还没有最近项'}</div>}
        </div>
        <div className="amx-qf-foot"><kbd>↑↓</kbd> 选择 · <kbd>↵</kbd> 打开 · <kbd>esc</kbd> 关闭</div>
      </div>
    </div>
  )
}
