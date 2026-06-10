/**
 * 会话侧栏:列表/新建/重命名/归档/删除 + running·unread 指示。
 * 交互逻辑对齐 AI Studio Sidebar(右键/省略号菜单,内联重命名),标记层 token CSS。
 */
import React, { useEffect, useRef, useState } from 'react'
import { Plus, MoreHorizontal, Pencil, Archive, ArchiveRestore, Trash2, Settings } from 'lucide-react'
import type { SessionRecord } from '../types'
import { BrandLogo } from './BrandLogo'

interface SidebarProps {
  collapsed: boolean
  sessions: SessionRecord[]
  archivedSessions: SessionRecord[]
  activeId: string | null
  runningIds: Set<string>
  unreadIds: Set<string>
  onSelect: (id: string) => void
  onNew: () => void
  onRename: (id: string, title: string) => void
  onArchive: (id: string, archived: boolean) => void
  onDelete: (id: string) => void
  onOpenSettings: () => void
}

interface MenuState {
  id: string
  x: number
  y: number
  archived: boolean
}

export const Sidebar: React.FC<SidebarProps> = (p) => {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const renameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renaming) renameRef.current?.select()
  }, [renaming])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
    }
  }, [menu])

  const openMenu = (e: React.MouseEvent, s: SessionRecord) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ id: s.id, x: e.clientX, y: e.clientY, archived: s.archived })
  }

  const commitRename = () => {
    if (renaming && draft.trim()) p.onRename(renaming, draft.trim())
    setRenaming(null)
  }

  const renderItem = (s: SessionRecord) => (
    <button
      key={s.id}
      className={`session-item${s.id === p.activeId ? ' active' : ''}`}
      onClick={() => p.onSelect(s.id)}
      onContextMenu={(e) => openMenu(e, s)}
    >
      <span className="session-emoji">{s.emoji || '💬'}</span>
      {renaming === s.id ? (
        <input
          ref={renameRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename()
            if (e.key === 'Escape') setRenaming(null)
          }}
          onClick={(e) => e.stopPropagation()}
          style={{
            flex: 1, minWidth: 0, background: 'var(--bg-card)', fontSize: 13,
            border: 'var(--border-width) solid var(--accent)', borderRadius: 'var(--radius-sm)',
            padding: '1px 5px', outline: 'none',
          }}
        />
      ) : (
        <span className="session-title">{s.title || 'New Chat'}</span>
      )}
      {p.runningIds.has(s.id) && <span className="session-dot running" title="运行中" />}
      {!p.runningIds.has(s.id) && p.unreadIds.has(s.id) && <span className="session-dot unread" title="有新回复" />}
      <span className="session-menu-btn" onClick={(e) => openMenu(e as any, s)}>
        <MoreHorizontal size={14} />
      </span>
    </button>
  )

  return (
    <aside className={`sidebar${p.collapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-header">
        <span className="sidebar-brand">
          <BrandLogo size={20} />
          Tangu
        </span>
      </div>

      <button className="new-chat-btn" onClick={p.onNew}>
        <Plus size={15} />
        新建会话
      </button>

      <div className="session-list">
        {p.sessions.map(renderItem)}
        {p.archivedSessions.length > 0 && (
          <>
            <button className="session-item" onClick={() => setShowArchived(!showArchived)}>
              <span className="session-emoji"><Archive size={13} /></span>
              <span className="session-title" style={{ color: 'var(--text-faint)' }}>
                已归档 ({p.archivedSessions.length})
              </span>
            </button>
            {showArchived && p.archivedSessions.map(renderItem)}
          </>
        )}
      </div>

      <div className="sidebar-footer">
        <span className="grow" />
        <button className="icon-btn" onClick={p.onOpenSettings} title="设置 (Ctrl+,)">
          <Settings size={16} />
        </button>
      </div>

      {menu && (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => {
              const s = [...p.sessions, ...p.archivedSessions].find((x) => x.id === menu.id)
              setDraft(s?.title || '')
              setRenaming(menu.id)
              setMenu(null)
            }}
          >
            <Pencil size={13} /> 重命名
          </button>
          <button
            onClick={() => {
              p.onArchive(menu.id, !menu.archived)
              setMenu(null)
            }}
          >
            {menu.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
            {menu.archived ? '取消归档' : '归档'}
          </button>
          <button
            className="danger"
            onClick={() => {
              p.onDelete(menu.id)
              setMenu(null)
            }}
          >
            <Trash2 size={13} /> 删除
          </button>
        </div>
      )}
    </aside>
  )
}
