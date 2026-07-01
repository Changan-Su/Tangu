// Recursive folder tree for the sidebar. Each node owns its own collapse / rename
// state, so there is no prop drilling — actions come from the store. Right-click on a
// row raises a context menu (handled by VaultSidebar) for file/folder operations.

import { useState } from 'react'
import { usePageStore } from '../store/pageStore'
import type { TreeNode } from '../lib/pageTree'

export interface CtxTarget {
  kind: 'file' | 'folder'
  path: string
  name: string
}

type OnContext = (target: CtxTarget, x: number, y: number) => void

export function FolderTree({
  node,
  depth,
  onContext,
}: {
  node: TreeNode
  depth: number
  onContext: OnContext
}) {
  return (
    <>
      {node.children.map((child) =>
        child.kind === 'folder' ? (
          <FolderRow key={`d:${child.path}`} node={child} depth={depth} onContext={onContext} />
        ) : (
          <FileRow key={`f:${child.path}`} node={child} depth={depth} onContext={onContext} />
        ),
      )}
    </>
  )
}

function FolderRow({ node, depth, onContext }: { node: TreeNode; depth: number; onContext: OnContext }) {
  const [open, setOpen] = useState(true)
  const createPageInFolder = usePageStore((s) => s.createPageInFolder)
  return (
    <div className="tree-group">
      <div
        className="tree-row tree-folder"
        style={{ paddingLeft: depth * 14 + 4 }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onContext({ kind: 'folder', path: node.path, name: node.name }, e.clientX, e.clientY)
        }}
      >
        <button
          className="tree-chevron"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? '折叠' : '展开'}
        >
          {open ? '▾' : '▸'}
        </button>
        <span className="tree-name" onClick={() => setOpen((o) => !o)}>
          {node.name}
        </span>
        <button
          className="tree-add"
          title="在此文件夹新建页面"
          onClick={() => void createPageInFolder(node.path)}
        >
          ＋
        </button>
      </div>
      {open && <FolderTree node={node} depth={depth + 1} onContext={onContext} />}
    </div>
  )
}

function FileRow({ node, depth, onContext }: { node: TreeNode; depth: number; onContext: OnContext }) {
  const activePage = usePageStore((s) => s.activePage)
  const loadPage = usePageStore((s) => s.loadPage)
  const renamePage = usePageStore((s) => s.renamePage)
  const display = node.name.replace(/\.md$/i, '')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(display)

  const startRename = (): void => {
    setDraft(display)
    setEditing(true)
  }
  const commit = async (): Promise<void> => {
    const name = draft.trim()
    setEditing(false)
    if (!name || name === display) return
    if (node.path !== activePage) await loadPage(node.path) // rename acts on the active page
    await renamePage(name)
  }

  if (editing) {
    return (
      <input
        className="page-rename tree-rename"
        style={{ marginLeft: depth * 14 + 4 }}
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void commit()
          } else if (e.key === 'Escape') {
            setEditing(false)
          }
        }}
      />
    )
  }
  return (
    <button
      className="page-item tree-file"
      style={{ paddingLeft: depth * 14 + 22 }}
      data-active={node.path === activePage || undefined}
      onClick={() => void loadPage(node.path)}
      onDoubleClick={startRename}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onContext({ kind: 'file', path: node.path, name: display }, e.clientX, e.clientY)
      }}
      title={`${node.path} · 双击重命名 · 右键更多`}
    >
      {display}
    </button>
  )
}
