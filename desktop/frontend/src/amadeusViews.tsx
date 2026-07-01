/** Amadeus Space 的引擎视图 —— 外壳用 Tangu 原生 UI 重建(复刻侧栏 t2s- 视觉 + base.css 的 .ctx-menu),
 *  只复用 Amadeus 的数据层(pageStore)与块编辑器内核(PageView/Milkdown)。
 *  左 笔记库 / 主 编辑器 / 右 大纲·反链。除编辑器(块组件用 Amadeus 契约 token,需 .am-app+bridge)外,
 *  外壳直接用 Tangu token/类 → 与 Tangu Desktop 一致,并随其换肤/明暗同步。 */
import { type ReactNode, type DragEvent as RDragEvent, type MouseEvent as RMouseEvent, useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import {
  SquarePen, FolderOpen, Folder, FolderPlus, Plus, MoreHorizontal, Pencil, Trash2, FolderInput,
  FolderSymlink, ChevronDown, ChevronRight, Search, Code2, Eye,
} from 'lucide-react'
import { useTheme } from './stores/themeStore'
import { usePageStore } from '@amadeus/store/pageStore'
import { useUiStore } from '@amadeus/store/uiStore'
import { amadeus } from '@amadeus/api'
import { compile, parsePageSource } from '@amadeus-shared/compiler'
import { recordNav } from './engine'
import { PageView } from '@amadeus/components/PageView'
import '@amadeus/blocks' // 注册内置块类型(markdown→Milkdown);缺此 side-effect 导入则块显示「未知块类型」
import './views/chat2/sidebar2.css' // t2s- 侧栏样式(通常已随 SessionsView 全局加载;显式引入以防独立挂载)

const ps = () => usePageStore.getState()
const baseName = (p: string): string => p.split('/').pop()!.replace(/\.md$/, '')
const parentOf = (p: string): string => { const a = p.split('/'); a.pop(); return a.join('/') }
const folderName = (p: string): string => p.split('/').pop() || p

/** 把某页改名:renamePage 作用于当前活动页,故先 loadPage 再改名(修复非活动页改名失效)。 */
async function renameAt(path: string, newName: string): Promise<void> {
  if (ps().activePage !== path) await ps().loadPage(path)
  await ps().renamePage(newName)
}

/** 跨视图定位信号:编辑器面包屑点击 → 左栏笔记库展开 / 滚动 / 高亮该 folder 或 page。n 自增以重触发同路径。 */
const useAmadeusNav = create<{ locate: { path: string; n: number } | null; requestLocate: (p: string) => void }>((set) => ({
  locate: null,
  requestLocate: (path) => set((s) => ({ locate: { path, n: (s.locate?.n ?? 0) + 1 } })),
}))

// ── 笔记切换喂给主面板导航历史(Workbench 级前进/后退;箭头由引擎在主区左上角渲染,见 WorkspaceHost)。
//    recordNav 内部有 navigating 闸,back/forward 复原触发的 activePage 变化不会被重记。 ──
usePageStore.subscribe((state, prev) => {
  const p = state.activePage
  if (!p || p === prev.activePage) return
  recordNav(`amadeus:${p}`, () => usePageStore.getState().loadPage(p))
})

/** 编辑器顶部面包屑:笔记路径(文件夹 / 文件),点任意段在左栏定位高亮。 */
function Breadcrumb() {
  const activePage = usePageStore((s) => s.activePage)
  const requestLocate = useAmadeusNav((s) => s.requestLocate)
  if (!activePage) return null
  const segs = activePage.replace(/\.md$/, '').split('/')
  return (
    <div className="amx-crumbs">
      {segs.map((seg, i) => {
        const isLast = i === segs.length - 1
        const target = isLast ? activePage : segs.slice(0, i + 1).join('/') // 文件夹段=累积路径;末段=完整页路径
        return (
          <span className="amx-crumb-seg" key={i}>
            {i > 0 && <span className="amx-crumb-sep">/</span>}
            <button className="amx-crumb" title={target} onClick={() => requestLocate(target)}>{seg}</button>
          </span>
        )
      })}
    </div>
  )
}

// ─────────────────────────────── 左:笔记库(原生 t2s 外壳) ───────────────────────────────

interface Ctx { kind: 'page' | 'folder'; path: string; x: number; y: number }

export function AmadeusPagesView() {
  const pages = usePageStore((s) => s.pages)
  const folders = usePageStore((s) => s.folders)
  const activePage = usePageStore((s) => s.activePage)
  const vaultRoot = usePageStore((s) => s.vaultRoot)
  const toast = useUiStore((s) => s.toast)

  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<Ctx | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const renameRef = useRef<HTMLInputElement>(null)
  const nav = useAmadeusNav((s) => s.locate)
  const [flash, setFlash] = useState<string | null>(null)
  const flashRef = useRef<HTMLElement | null>(null)

  // 首次挂载恢复上次 Vault(跨启动持久)+ 订阅外部文件变更(agent/其它进程改 .md → 实时重载/刷新结构)。
  useEffect(() => {
    if (!restoreTried) { restoreTried = true; void ps().restoreVault() }
    const offExt = amadeus.onExternalChange?.((p) => void ps().reconcileExternal(p))
    const offStruct = amadeus.onStructureChange?.(() => void ps().refreshStructure())
    return () => { offExt?.(); offStruct?.() }
  }, [])
  useEffect(() => { if (renaming) renameRef.current?.select() }, [renaming])
  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    return () => { window.removeEventListener('click', close); window.removeEventListener('contextmenu', close) }
  }, [menu])
  // 面包屑定位:展开目标 folder(或 page 的父 folder)→ 滚动到目标行 → 短暂高亮。
  useEffect(() => {
    if (!nav) return
    const open = folders.includes(nav.path) ? nav.path : parentOf(nav.path)
    if (open) setCollapsed((prev) => { if (!prev.has(open)) return prev; const n = new Set(prev); n.delete(open); return n })
    setFlash(nav.path)
    const t = setTimeout(() => setFlash(null), 1200)
    return () => clearTimeout(t)
  }, [nav?.n]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (flash) flashRef.current?.scrollIntoView({ block: 'nearest' }) }, [flash])

  const q = query.trim().toLowerCase()
  const rootPages = useMemo(() => pages.filter((p) => !p.includes('/')), [pages])
  const groups = useMemo(
    () => folders.slice().sort().map((f) => ({ folder: f, items: pages.filter((p) => parentOf(p) === f) })),
    [folders, pages],
  )
  const matches = useMemo(() => (q ? pages.filter((p) => baseName(p).toLowerCase().includes(q)) : []), [q, pages])

  const toggle = (f: string): void => setCollapsed((prev) => {
    const n = new Set(prev); n.has(f) ? n.delete(f) : n.add(f); return n
  })
  const commitRename = (): void => {
    const path = renaming
    setRenaming(null)
    if (path && draft.trim() && draft.trim() !== baseName(path)) void renameAt(path, draft.trim())
  }
  const startRename = (path: string): void => { setDraft(baseName(path)); setRenaming(path); setMenu(null) }
  const newFolder = (parent: string): void => {
    const name = window.prompt(parent ? `在「${folderName(parent)}」中新建文件夹` : '新建文件夹', '新文件夹')?.trim()
    if (name) void ps().createFolder(parent, name)
    setMenu(null)
  }

  const row = (path: string): ReactNode => (
    <button
      key={path}
      ref={(el) => { if (path === flash) flashRef.current = el }}
      className={`t2s-srow${path === activePage ? ' active' : ''}${path === flash ? ' amx-flash' : ''}`}
      onClick={() => void ps().loadPage(path)}
      onContextMenu={(e) => { e.preventDefault(); setMenu({ kind: 'page', path, x: e.clientX, y: e.clientY }) }}
      title={path}
    >
      {renaming === path ? (
        <input
          ref={renameRef}
          className="t2s-rename"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(null) }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="t2s-srow-title">{baseName(path)}</span>
      )}
      <span className="t2s-srow-menu" onClick={(e) => { e.stopPropagation(); setMenu({ kind: 'page', path, x: e.clientX, y: e.clientY }) }}>
        <MoreHorizontal size={14} />
      </span>
    </button>
  )

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, minWidth: 0 }}>
      <aside className="t2s-side">
        <div className="t2s-search">
          <Search size={13} className="t2s-dim" />
          <input value={query} placeholder="搜索笔记" onChange={(e) => setQuery(e.target.value)} />
        </div>

        <div className="t2s-scroll">
          {q ? (
            matches.length ? matches.map(row) : <div className="t2s-hint">没有匹配的笔记</div>
          ) : (
            <>
              <div className="t2s-special-group">
                <button className="t2s-special" onClick={() => void ps().createPage()}>
                  <span className="t2s-special-ic"><SquarePen size={15} /></span>
                  <span className="t2s-special-title">新建笔记</span>
                </button>
                <button className="t2s-special" onClick={() => void ps().openVault()} title={vaultRoot || undefined}>
                  <span className="t2s-special-ic"><FolderOpen size={15} /></span>
                  <span className="t2s-special-title">{vaultRoot ? `Vault：${baseName(vaultRoot)}` : '打开 Vault'}</span>
                </button>
              </div>

              {!vaultRoot && <div className="t2s-hint">打开一个 Vault 文件夹开始。</div>}
              {rootPages.map(row)}

              {groups.map(({ folder, items }) => {
                const isCol = collapsed.has(folder)
                return (
                  <div key={folder}>
                    <div ref={(el) => { if (folder === flash) flashRef.current = el }} className={`t2s-group${folder === flash ? ' amx-flash' : ''}`}>
                      <button className="t2s-group-toggle" onClick={() => toggle(folder)}>
                        <span className="t2s-chev">{isCol ? <ChevronRight size={12} /> : <ChevronDown size={12} />}</span>
                        <span className="t2s-group-name"><Folder size={12} /><span className="t2s-group-label">{folderName(folder)}</span><span className="t2s-count">{items.length}</span></span>
                      </button>
                      <button className="t2s-group-add" title="在此文件夹新建笔记" onClick={() => void ps().createPageInFolder(folder)}><Plus size={14} /></button>
                      <button className="t2s-group-add" title="文件夹操作" onClick={(e) => { e.stopPropagation(); setMenu({ kind: 'folder', path: folder, x: e.clientX, y: e.clientY }) }}><MoreHorizontal size={14} /></button>
                    </div>
                    {!isCol && <div className="t2s-group-sessions">{items.map(row)}</div>}
                  </div>
                )
              })}

              {vaultRoot && <button className="t2s-add-ws" onClick={() => newFolder('')}><FolderPlus size={14} /> 新建文件夹</button>}
            </>
          )}
        </div>
      </aside>

      {menu?.kind === 'page' && (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => startRename(menu.path)}><Pencil size={13} /> 重命名</button>
          {parentOf(menu.path) !== '' && (
            <button onClick={() => { void ps().movePage(menu.path, ''); setMenu(null) }}><FolderInput size={13} /> 移到根目录</button>
          )}
          {folders.filter((f) => f !== parentOf(menu.path)).map((f) => (
            <button key={f} onClick={() => { void ps().movePage(menu.path, f); setMenu(null) }}><FolderSymlink size={13} /> 移到「{folderName(f)}」</button>
          ))}
          <button onClick={() => { void amadeus.revealInFileManager(menu.path); setMenu(null) }}><FolderOpen size={13} /> 在文件管理器中显示</button>
          <button className="danger" onClick={() => { const p = menu.path; setMenu(null); if (window.confirm(`删除笔记「${baseName(p)}」?此操作不可撤销。`)) void ps().deletePage(p) }}><Trash2 size={13} /> 删除</button>
        </div>
      )}
      {menu?.kind === 'folder' && (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { void ps().createPageInFolder(menu.path); setMenu(null) }}><SquarePen size={13} /> 新建笔记</button>
          <button onClick={() => newFolder(menu.path)}><FolderPlus size={13} /> 新建子文件夹</button>
          <button onClick={() => { const f = menu.path; setMenu(null); const name = window.prompt('重命名文件夹', folderName(f))?.trim(); if (name) void ps().renameFolder(f, name) }}><Pencil size={13} /> 重命名</button>
          <button onClick={() => { void amadeus.revealInFileManager(menu.path); setMenu(null) }}><FolderOpen size={13} /> 在文件管理器中显示</button>
          <button className="danger" onClick={() => { const f = menu.path; setMenu(null); if (window.confirm(`删除文件夹「${folderName(f)}」及其全部内容?不可撤销。`)) void ps().deleteFolder(f) }}><Trash2 size={13} /> 删除</button>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

let restoreTried = false

// ─────────────────────────────── 主:编辑器(Amadeus 内核 + Tangu 排版) ───────────────────────────────

/** 编辑器需 Amadeus 契约 token → 包 .am-app.tangu-lovable + 镜像 Tangu mode/flat,经 bridge 取色。 */
function EditorScope({
  children, dragging, onDrop, onDragOver, onDragLeave, onClick,
}: {
  children: ReactNode
  dragging?: boolean
  onDrop?: (e: RDragEvent<HTMLDivElement>) => void
  onDragOver?: (e: RDragEvent<HTMLDivElement>) => void
  onDragLeave?: (e: RDragEvent<HTMLDivElement>) => void
  onClick?: (e: RMouseEvent<HTMLDivElement>) => void
}) {
  const mode = useTheme((s) => s.mode)
  const flat = useTheme((s) => s.flat)
  return (
    <div
      className={`am-app tangu-lovable amx-pane amx-editor${dragging ? ' amx-dragover' : ''}`}
      data-mode={mode}
      data-flat={flat ? '1' : '0'}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onClick={onClick}
    >
      {children}
    </div>
  )
}

/** 附件链接(关预览时)Markdown 形式;含空格/括号的路径包 `<>` 保证合法。 */
function mdLink(name: string, rel: string): string {
  const dest = /[ ()<>]/.test(rel) ? `<${rel}>` : rel
  return `[${name.replace(/[[\]]/g, '')}](${dest})`
}

/** 可编辑笔记标题 = 文件名(manifest.title 恒取 basename),提交即 renamePage。在编辑器内联改标题。 */
function NoteTitle() {
  const activePage = usePageStore((s) => s.activePage)
  const manifest = usePageStore((s) => s.manifest)
  const current = manifest?.title || (activePage ? baseName(activePage) : '')
  const [val, setVal] = useState(current)
  // 切换笔记 / 改名后(activePage=newPath)把输入重置为最新标题。
  useEffect(() => { setVal(current) }, [activePage]) // eslint-disable-line react-hooks/exhaustive-deps
  const commit = (): void => {
    const next = val.trim()
    if (next && next !== current) void ps().renamePage(next)
    else setVal(current)
  }
  return (
    <input
      className="amx-title-input"
      value={val}
      placeholder="未命名"
      onChange={(e) => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
        if (e.key === 'Escape') { setVal(current); e.currentTarget.blur() }
      }}
    />
  )
}

/** 源码模式 = 真实 .md 文件:frontmatter(amadeus_page/schema/layout)+ `<!-- a id -->` 块标记 + 内容,
 *  经 compile() 呈现、parsePageSource() 往返(保留块与 2D 布局;标记只由 <!-- a id --> 切分)。
 *  失焦提交(仅在真正改动时);破坏 frontmatter 则退化为外部单块(优雅降级,不丢内容)。 */
function SourceEditor() {
  const readSrc = (): string => {
    const m = ps().manifest
    if (!m) return ''
    const contents: Record<string, string> = {}
    for (const [id, b] of Object.entries(ps().blocks)) contents[id] = b.content
    return compile(m, contents)
  }
  const [src, setSrc] = useState(readSrc)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const grow = (): void => { const el = taRef.current; if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px` } }
  useEffect(grow, [src])
  const commit = (): void => {
    const page = ps().activePage
    if (!page || src === readSrc()) return
    const parsed = parsePageSource(page, src, new Date().toISOString())
    ps()._commit(parsed.manifest, parsed.blocks)
  }
  return (
    <textarea
      ref={taRef}
      className="amx-source"
      value={src}
      spellCheck={false}
      onChange={(e) => setSrc(e.target.value)}
      onBlur={commit}
    />
  )
}

export function AmadeusEditorView() {
  const activePage = usePageStore((s) => s.activePage)
  const [mode, setMode] = useState<'wysiwyg' | 'source'>('wysiwyg')
  const [dragging, setDragging] = useState(false)

  // 拖入文件 → 按 Tangu 笔记设置存放(attachments/同目录/固定夹)→ 预览开则插 ![[base]],否则插 [名](相对路径)。
  const onDrop = async (e: RDragEvent<HTMLDivElement>): Promise<void> => {
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (!files.length) return
    e.preventDefault()
    setDragging(false)
    const page = ps().activePage
    if (!page) return
    const cfg = await window.tangu?.getConfig?.().catch(() => null)
    const opts = { mode: cfg?.notesAttachmentMode ?? 'attachments', folder: cfg?.notesAttachmentFolder ?? 'assets' }
    const preview = cfg?.notesImportPreview !== false
    for (const f of files) {
      try {
        const bytes = new Uint8Array(await f.arrayBuffer())
        const { pageRel, base } = await amadeus.saveAttachment(page, f.name, bytes, opts)
        ps().insertBlockAfter(null, undefined, preview ? `![[${base}]]` : mdLink(f.name, pageRel))
      } catch { /* 单个文件失败跳过 */ }
    }
    ps().refreshStructure?.() // 新附件出现在左栏结构
  }
  const onDragOver = (e: RDragEvent<HTMLDivElement>): void => {
    if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return
    e.preventDefault()
    if (!dragging) setDragging(true)
  }
  const onDragLeave = (e: RDragEvent<HTMLDivElement>): void => {
    if (e.currentTarget === e.target) setDragging(false)
  }
  // 关预览的附件是 [名](相对路径);点击其渲染的 <a>(href=原始相对路径)在系统默认程序打开。
  const onClick = (e: RMouseEvent<HTMLDivElement>): void => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a || a.classList.contains('wikilink')) return
    const href = a.getAttribute('href') || ''
    if (!href || /^(https?:|mailto:|amadeus-asset:|#)/i.test(href)) return
    e.preventDefault()
    const page = ps().activePage
    if (page) void amadeus.openAttachment(page, href)
  }

  return (
    <EditorScope dragging={dragging} onDrop={(e) => void onDrop(e)} onDragOver={onDragOver} onDragLeave={onDragLeave} onClick={onClick}>
      {activePage && (
        <div className="amx-toolbar">
          <Breadcrumb />
          <button
            className="amx-mode-btn"
            onClick={() => setMode((m) => (m === 'source' ? 'wysiwyg' : 'source'))}
            title={mode === 'source' ? '切换到可视编辑(所见即所得)' : '切换到源码 Markdown'}
          >
            {mode === 'source' ? <><Eye size={14} /> 可视</> : <><Code2 size={14} /> 源码</>}
          </button>
        </div>
      )}
      {!activePage ? (
        <div className="amx-empty">从左栏选择一篇笔记,或新建 / 打开一个 Vault 开始。</div>
      ) : mode === 'source' ? (
        <SourceEditor key={activePage} />
      ) : (
        <>
          <div className="amx-doc"><NoteTitle /></div>
          <PageView bare />
        </>
      )}
    </EditorScope>
  )
}

// ─────────────────────────────── 右:大纲 / 反链(原生 Tangu 列表) ───────────────────────────────

interface Head { id: string; level: number; text: string; key: string }

export function AmadeusOutlineView() {
  const manifest = usePageStore((s) => s.manifest)
  const blocks = usePageStore((s) => s.blocks)
  const heads = useMemo<Head[]>(() => {
    if (!manifest) return []
    const out: Head[] = []
    for (const r of manifest.root.children)
      for (const c of r.columns)
        for (const ref of c.children)
          for (const line of (blocks[ref.ref]?.content ?? '').split('\n')) {
            const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line.trim())
            if (m) out.push({ id: ref.ref, level: m[1].length, text: m[2], key: `${ref.ref}:${out.length}` })
          }
    return out
  }, [manifest, blocks])
  const goto = (id: string): void => { document.querySelector(`[data-block-id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }

  return (
    <div className="amx-panel">
      <div className="amx-panel-head">大纲</div>
      {heads.length === 0 ? (
        <div className="amx-panel-empty">没有标题</div>
      ) : (
        <div className="amx-list">
          {heads.map((h) => (
            <button key={h.key} className="amx-list-item" style={{ paddingLeft: 10 + (h.level - 1) * 12 }} onClick={() => goto(h.id)} title={h.text}>{h.text}</button>
          ))}
        </div>
      )}
    </div>
  )
}

export function AmadeusBacklinksView() {
  const activePage = usePageStore((s) => s.activePage)
  const version = usePageStore((s) => s.linkGraphVersion)
  const [refs, setRefs] = useState<Array<{ path: string; title: string; snippet: string }>>([])
  useEffect(() => {
    let live = true
    if (!activePage) { setRefs([]); return }
    void amadeus.backlinks(activePage).then((r) => { if (live) setRefs(r) })
    return () => { live = false }
  }, [activePage, version])

  return (
    <div className="amx-panel">
      <div className="amx-panel-head">反链 · {refs.length}</div>
      {!activePage ? (
        <div className="amx-panel-empty">未打开笔记</div>
      ) : refs.length === 0 ? (
        <div className="amx-panel-empty">还没有其它笔记链接到这里</div>
      ) : (
        <div className="amx-list">
          {refs.map((r) => (
            <button key={r.path} className="amx-list-item" onClick={() => void ps().loadPage(r.path)} title={r.path}>
              {r.title}
              {r.snippet && <span className="amx-backlink-snippet">{r.snippet}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
