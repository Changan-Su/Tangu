import { create } from 'zustand'
import { generateColumnId, generateRowId, nextBlockId, stripPageBasename } from '@amadeus-shared/compiler/names'
import type {
  BlockEntry,
  BlockId,
  ColumnId,
  ColumnNode,
  LoadedPage,
  PageManifest,
  RowId,
  RowNode,
  StackNode,
} from '@amadeus-shared/compiler/types'
import { resolvePageName } from '@amadeus-shared/links'
import { amadeus } from '../api'

export interface BlockState {
  id: BlockId
  type: string
  content: string
}

interface Loc {
  rowIdx: number
  colIdx: number
  childIdx: number
}

const clone = <T>(x: T): T => structuredClone(x)

function locate(root: StackNode, id: BlockId): Loc | null {
  for (let r = 0; r < root.children.length; r++) {
    const row = root.children[r]
    for (let c = 0; c < row.columns.length; c++) {
      const i = row.columns[c].children.findIndex((ref) => ref.ref === id)
      if (i >= 0) return { rowIdx: r, colIdx: c, childIdx: i }
    }
  }
  return null
}

function findColumn(root: StackNode, colId: ColumnId): { row: RowNode; col: ColumnNode } | null {
  for (const row of root.children) {
    for (const col of row.columns) {
      if (col.id === colId) return { row, col }
    }
  }
  return null
}

function normalizeWidths(row: RowNode): void {
  if (row.columns.length === 1) {
    row.columns[0].width = 1
    return
  }
  const sum = row.columns.reduce((s, c) => s + (c.width > 0 ? c.width : 0), 0)
  if (sum <= 0) {
    const w = 1 / row.columns.length
    row.columns.forEach((c) => (c.width = w))
    return
  }
  row.columns.forEach((c) => (c.width = (c.width > 0 ? c.width : 0) / sum))
}

/** Drop empty columns and rows, renormalizing widths of survivors. */
function cleanup(root: StackNode): void {
  for (let r = root.children.length - 1; r >= 0; r--) {
    const row = root.children[r]
    for (let c = row.columns.length - 1; c >= 0; c--) {
      if (row.columns[c].children.length === 0) row.columns.splice(c, 1)
    }
    if (row.columns.length === 0) {
      root.children.splice(r, 1)
      continue
    }
    normalizeWidths(row)
  }
}

function appendToEnd(root: StackNode, id: BlockId): void {
  const lastRow = root.children[root.children.length - 1]
  if (lastRow) {
    lastRow.columns[lastRow.columns.length - 1].children.push({ ref: id })
  } else {
    root.children.push({
      type: 'row',
      id: generateRowId(),
      columns: [{ id: generateColumnId(), width: 1, children: [{ ref: id }] }],
    })
  }
}

export type Status = 'idle' | 'loading' | 'ready' | 'saving'
export type FocusPlace = 'start' | 'end'

interface PageState {
  vaultRoot: string | null
  pages: string[]
  folders: string[]
  /** Non-page files (attachments/.db/…), vault-relative — shown in the vault tree. */
  files: string[]
  activePage: string | null
  manifest: PageManifest | null
  blocks: Record<BlockId, BlockState>
  status: Status
  error: string | null
  /** A pending request to move the caret into a specific block (after create/delete/nav). */
  focusRequest: { id: BlockId; place: FocusPlace } | null
  /** Transient drag state for drop-target feedback (the block being dragged / hovered). */
  dndActiveId: string | null
  dndOverId: string | null
  /** Bumped whenever on-disk links may have changed (save / external reconcile); backlink & tag panels watch it. */
  linkGraphVersion: number

  openVault(): Promise<void>
  restoreVault(): Promise<void>
  refreshPages(): Promise<void>
  loadPage(path: string): Promise<void>
  createPage(): Promise<void>
  /** Create a new untitled page inside `folder` (vault-relative; '' = vault root) and open it. */
  createPageInFolder(folder: string): Promise<void>
  /** 打开某路径的笔记;不存在则先创建(日记等「打开或新建」语义)。 */
  openOrCreate(path: string): Promise<void>
  renamePage(newName: string): Promise<boolean>
  /** Open the page named by a [[wikilink]] (creating it if missing). */
  openWikiLink(name: string): void

  /** Refresh both the page list and the folder list from disk. */
  refreshStructure(): Promise<void>
  /** Delete a page; if it was active, open another (or clear). */
  deletePage(pagePath: string): Promise<void>
  /** Move a page into another folder ('' = vault root). */
  movePage(pagePath: string, destFolder: string): Promise<void>
  /** Create a folder under `parentFolder` ('' = vault root). */
  createFolder(parentFolder: string, name: string): Promise<void>
  /** Rename a folder; remaps the active page's path if it lived inside. */
  renameFolder(folderPath: string, newName: string): Promise<void>
  /** Delete a folder and its contents; if the active page was inside, open another (or clear). */
  deleteFolder(folderPath: string): Promise<void>

  requestFocus(id: BlockId, place: FocusPlace): void
  consumeFocus(id: BlockId): void
  flatOrder(): BlockId[]
  focusAdjacent(id: BlockId, dir: 'prev' | 'next'): void
  deleteBlockFocusPrev(id: BlockId): void
  /** Merge a block's content into the previous block, then delete it (Backspace at start). */
  mergeWithPrev(id: BlockId): void

  setBlockContent(id: BlockId, content: string): void
  insertBlockAfter(afterId: BlockId | null, colId?: ColumnId, initialContent?: string): BlockId
  /** Insert several blocks after `afterId`(模板插入;单次 _commit,布局依序排在其后)。 */
  insertBlocksAfter(afterId: BlockId | null, contents: string[]): void
  /** Append a cross-note embed cell (`![[target]]`) as a new full-width row. */
  insertEmbed(target: string): void
  duplicateBlock(id: BlockId): void
  deleteBlock(id: BlockId): void
  /** Move a block into a column, before `beforeId` (or to the end when null). */
  moveBlock(id: BlockId, toColId: ColumnId, beforeId: BlockId | null): void
  /** Move a block up/down within its column (keyboard reorder). */
  moveBlockDir(id: BlockId, dir: 'up' | 'down'): void
  /** Transient drag feedback. */
  setDnd(activeId: string | null, overId: string | null): void
  /** Split: pull a block into a new column on one side of a row (Notion-style columns). */
  addColumnWithBlock(rowId: RowId, id: BlockId, side: 'left' | 'right'): void
  /** Split the block's OWN row: pull it out into a new column beside it(菜单式分栏,免拖拽)。 */
  splitToColumn(id: BlockId, side: 'left' | 'right'): void
  /** Pull a block into a brand-new full-width row after the given row index. */
  addRowWithBlock(afterRowIndex: number, id: BlockId): void
  /** Resize the divider between two adjacent columns (leftFraction of their combined width). */
  resizeColumns(rowId: RowId, leftColId: ColumnId, rightColId: ColumnId, leftFraction: number): void

  /** Overwrite the note's foreign frontmatter(属性面板;'' = 清空)。 */
  setFmExtra(text: string): void

  save(): Promise<void>
  /** Force any pending debounced save to disk now, so the main index is fresh before navigating/searching. */
  flushSave(): Promise<void>
  reconcileExternal(path: string): Promise<void>

  _commit(manifest: PageManifest, blocks?: Record<BlockId, BlockState>): void
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let loadSeq = 0

function hydrate(page: LoadedPage): {
  manifest: PageManifest
  blocks: Record<BlockId, BlockState>
} {
  const blocks: Record<BlockId, BlockState> = {}
  for (const [id, b] of Object.entries(page.blocks)) {
    blocks[id] = { id, type: b.type, content: b.content }
  }
  return { manifest: page.manifest, blocks }
}

export const usePageStore = create<PageState>((set, get) => {
  const scheduleSave = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      void get().save()
    }, 400)
  }

  return {
    vaultRoot: null,
    pages: [],
    folders: [],
    files: [],
    activePage: null,
    manifest: null,
    blocks: {},
    status: 'idle',
    error: null,
    focusRequest: null,
    dndActiveId: null,
    dndOverId: null,
    linkGraphVersion: 0,

    setDnd(activeId, overId) {
      set({ dndActiveId: activeId, dndOverId: overId })
    },

    requestFocus(id, place) {
      set({ focusRequest: { id, place } })
    },
    consumeFocus(id) {
      const fr = get().focusRequest
      if (fr && fr.id === id) set({ focusRequest: null })
    },
    flatOrder() {
      const m = get().manifest
      if (!m) return []
      const out: BlockId[] = []
      for (const row of m.root.children)
        for (const col of row.columns) for (const ref of col.children) out.push(ref.ref)
      return out
    },
    focusAdjacent(id, dir) {
      const order = get().flatOrder()
      const i = order.indexOf(id)
      if (i < 0) return
      const j = dir === 'prev' ? i - 1 : i + 1
      if (j < 0 || j >= order.length) return
      get().requestFocus(order[j], dir === 'prev' ? 'end' : 'start')
    },
    deleteBlockFocusPrev(id) {
      const order = get().flatOrder()
      const i = order.indexOf(id)
      const prev = i > 0 ? order[i - 1] : null
      const next = i >= 0 && i < order.length - 1 ? order[i + 1] : null
      get().deleteBlock(id)
      const target = prev ?? next
      if (target) get().requestFocus(target, prev ? 'end' : 'start')
    },

    mergeWithPrev(id) {
      const order = get().flatOrder()
      const i = order.indexOf(id)
      if (i <= 0) return // no previous block
      const prevId = order[i - 1]
      const blocks = get().blocks
      const prevContent = blocks[prevId]?.content ?? ''
      const curContent = blocks[id]?.content ?? ''
      const merged = prevContent && curContent ? `${prevContent}\n\n${curContent}` : prevContent + curContent
      set((s) => ({ blocks: { ...s.blocks, [prevId]: { ...s.blocks[prevId], content: merged } } }))
      get().deleteBlock(id) // commits manifest + schedules a save that persists merged content
      get().requestFocus(prevId, 'end')
    },

    async openVault() {
      try {
        const info = await amadeus.openVault()
        if (!info) return
        set({ vaultRoot: info.root, pages: info.pages, folders: info.folders ?? [], error: null })
        void amadeus.listFiles?.().then((files) => set({ files })).catch(() => {})
        if (info.pages.length > 0) await get().loadPage(info.pages[0])
      } catch (e) {
        set({ error: String(e) })
      }
    },

    async restoreVault() {
      try {
        const info = await amadeus.restoreVault()
        if (!info) return
        set({ vaultRoot: info.root, pages: info.pages, folders: info.folders ?? [], error: null })
        void amadeus.listFiles?.().then((files) => set({ files })).catch(() => {})
        const target =
          info.lastPage && info.pages.includes(info.lastPage) ? info.lastPage : info.pages[0]
        if (target) await get().loadPage(target)
      } catch (e) {
        set({ error: String(e) })
      }
    },

    async refreshPages() {
      const pages = await amadeus.listPages()
      set({ pages })
    },

    async loadPage(path) {
      const seq = ++loadSeq // last-request-wins:双击/多 tab 竞速时,迟到的结果不得覆盖新导航
      await get().flushSave() // persist the outgoing page so its links are indexed before navigating
      set({ status: 'loading', error: null })
      try {
        const page = await amadeus.loadPage(path)
        if (seq !== loadSeq) return // 已被更新的导航取代
        set({ activePage: path, ...hydrate(page), status: 'ready' })
      } catch (e) {
        if (seq === loadSeq) set({ status: 'idle', error: String(e) })
      }
    },

    async createPage() {
      await get().createPageInFolder('')
    },

    async openOrCreate(path) {
      // 一律走 loadPage:主进程 loadPage 本就是「存在则解析、不存在才 newPage」,绝不覆盖已有文件
      // (缓存 pages[] 可能落后于磁盘,直接 newPage 会把已有笔记清空)。
      const known = get().pages.includes(path)
      await get().loadPage(path)
      if (!known) await get().refreshPages()
    },

    async createPageInFolder(folder) {
      await get().flushSave() // 换页前落盘,防 400ms 待存的上一页内容被丢/写错对象
      const norm = folder.replace(/\\/g, '/').replace(/\/+$/, '')
      const existing = new Set(get().pages)
      const join = (base: string): string => (norm ? `${norm}/${base}` : base)
      let base = 'untitled.md'
      let n = 1
      while (existing.has(join(base))) {
        n++
        base = `untitled-${n}.md`
      }
      const path = join(base)
      const page = await amadeus.newPage(path)
      await get().refreshPages()
      set({ activePage: path, ...hydrate(page), status: 'ready' })
    },

    async renamePage(newName) {
      const { manifest, blocks, activePage } = get()
      if (!manifest || !activePage) return false
      if (saveTimer) {
        clearTimeout(saveTimer) // cancel a pending save aimed at the OLD filename
        saveTimer = null
      }
      const contents: Record<string, string> = {}
      for (const [id, b] of Object.entries(blocks)) contents[id] = b.content
      try {
        const { newPath, page } = await amadeus.renamePage(activePage, newName, manifest, contents)
        set({ activePage: newPath, ...hydrate(page), status: 'ready', error: null })
        await get().refreshPages()
        return true
      } catch (e) {
        set({ error: String(e) })
        return false
      }
    },

    openWikiLink(name) {
      const raw = name.trim()
      if (!raw) return
      const match = resolvePageName(raw, get().pages)
      if (match) {
        void get().loadPage(match)
        return
      }
      const base = raw.replace(/[\\/]/g, '') // filesystem-safe basename for the new page
      if (!base) return
      void (async () => {
        try {
          await get().flushSave() // 换页前落盘,防待存的上一页内容被丢/写错对象
          const path = `${base}.md`
          const page = await amadeus.newPage(path)
          await get().refreshPages()
          set({ activePage: path, ...hydrate(page), status: 'ready' })
        } catch (e) {
          set({ error: String(e) })
        }
      })()
    },

    async refreshStructure() {
      const [pages, folders, files] = await Promise.all([
        amadeus.listPages(),
        amadeus.listFolders(),
        amadeus.listFiles?.() ?? [], // 旧 preload(无 listFiles)下优雅降级为空
      ])
      set({ pages, folders, files })
    },

    async deletePage(pagePath) {
      const wasActive = get().activePage === pagePath
      if (wasActive && saveTimer) {
        clearTimeout(saveTimer) // don't let a pending save resurrect the deleted page
        saveTimer = null
      }
      try {
        await amadeus.deletePage(pagePath)
      } catch (e) {
        set({ error: String(e) })
        return
      }
      await get().refreshStructure()
      if (wasActive) {
        const next = get().pages.find((p) => p !== pagePath) ?? null
        if (next) await get().loadPage(next)
        else set({ activePage: null, manifest: null, blocks: {}, status: 'idle' })
      }
    },

    async movePage(pagePath, destFolder) {
      const wasActive = get().activePage === pagePath
      if (wasActive) await get().flushSave() // persist before the files relocate
      try {
        const newPath = await amadeus.movePage(pagePath, destFolder)
        if (wasActive) set({ activePage: newPath })
      } catch (e) {
        set({ error: String(e) })
        return
      }
      await get().refreshStructure()
    },

    async createFolder(parentFolder, name) {
      try {
        await amadeus.createFolder(parentFolder, name)
      } catch (e) {
        set({ error: String(e) })
        return
      }
      await get().refreshStructure()
    },

    async renameFolder(folderPath, newName) {
      const active = get().activePage
      await get().flushSave()
      try {
        const newFolder = await amadeus.renameFolder(folderPath, newName)
        if (active && (active === folderPath || active.startsWith(folderPath + '/'))) {
          set({ activePage: newFolder + active.slice(folderPath.length) })
        }
      } catch (e) {
        set({ error: String(e) })
        return
      }
      await get().refreshStructure()
    },

    async deleteFolder(folderPath) {
      const active = get().activePage
      const activeInside = !!active && (active === folderPath || active.startsWith(folderPath + '/'))
      if (activeInside && saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = null
      }
      try {
        await amadeus.deleteFolder(folderPath)
      } catch (e) {
        set({ error: String(e) })
        return
      }
      await get().refreshStructure()
      if (activeInside) {
        const next = get().pages[0] ?? null
        if (next) await get().loadPage(next)
        else set({ activePage: null, manifest: null, blocks: {}, status: 'idle' })
      }
    },

    setBlockContent(id, content) {
      set((s) => ({ blocks: { ...s.blocks, [id]: { ...s.blocks[id], content } } }))
      scheduleSave()
    },

    insertBlockAfter(afterId, colId, initialContent = '') {
      const m = get().manifest
      const page = get().activePage
      if (!m || !page) return ''
      const newId = nextBlockId(Object.keys(m.blocks))
      const root = clone(m.root)

      if (afterId) {
        const loc = locate(root, afterId)
        if (loc) root.children[loc.rowIdx].columns[loc.colIdx].children.splice(loc.childIdx + 1, 0, { ref: newId })
        else appendToEnd(root, newId)
      } else if (colId) {
        const t = findColumn(root, colId)
        if (t) t.col.children.push({ ref: newId })
        else appendToEnd(root, newId)
      } else {
        appendToEnd(root, newId)
      }

      const entry: BlockEntry = { type: 'markdown' }
      const blocks = {
        ...get().blocks,
        [newId]: { id: newId, type: 'markdown', content: initialContent },
      }
      get()._commit({ ...m, root, blocks: { ...m.blocks, [newId]: entry } }, blocks)
      get().requestFocus(newId, initialContent ? 'end' : 'start')
      return newId
    },

    insertBlocksAfter(afterId, contents) {
      const m = get().manifest
      if (!m || !contents.length) return
      const root = clone(m.root)
      // 逐个生成 id(nextBlockId 需已知全集防撞)。
      const ids: BlockId[] = []
      let known = Object.keys(m.blocks)
      for (let i = 0; i < contents.length; i++) {
        const id = nextBlockId(known)
        ids.push(id)
        known = [...known, id]
      }
      const loc = afterId ? locate(root, afterId) : null
      if (loc) root.children[loc.rowIdx].columns[loc.colIdx].children.splice(loc.childIdx + 1, 0, ...ids.map((ref) => ({ ref })))
      else for (const id of ids) appendToEnd(root, id)
      const bm = { ...m.blocks }
      const blocks = { ...get().blocks }
      ids.forEach((id, i) => {
        bm[id] = { type: 'markdown' }
        blocks[id] = { id, type: 'markdown', content: contents[i] }
      })
      get()._commit({ ...m, root, blocks: bm }, blocks)
      get().requestFocus(ids[ids.length - 1], 'end')
    },

    insertEmbed(target) {
      // An embed is just a normal block whose content is an `![[ ]]` directive; BlockHost
      // renders such a block read-only by resolving the target. Append it as a new row.
      get().insertBlockAfter(null, undefined, `![[${target}]]`)
    },

    duplicateBlock(id) {
      const src = get().blocks[id]
      if (!src) return
      get().insertBlockAfter(id, undefined, src.content)
    },

    async deleteBlock(id) {
      const m = get().manifest
      const page = get().activePage
      if (!m) return
      // Embedded elsewhere? Warn before its content is removed. Block ids are note-local,
      // so the backlink query is scoped by the active note.
      if (m.blocks[id] && page) {
        try {
          const refs = await amadeus.blockBacklinks(`${stripPageBasename(page)}#${id}`)
          if (refs.length > 0) {
            const ok = window.confirm(
              `有 ${refs.length} 处笔记嵌入了这个块，删除后那些嵌入会显示「丢失」。仍要删除？`,
            )
            if (!ok) return
          }
        } catch {
          /* backlink check is best-effort */
        }
      }
      const root = clone(m.root)
      const loc = locate(root, id)
      if (loc) root.children[loc.rowIdx].columns[loc.colIdx].children.splice(loc.childIdx, 1)
      cleanup(root)
      const blocks = { ...get().blocks }
      delete blocks[id]
      const bm = { ...m.blocks }
      delete bm[id]
      get()._commit({ ...m, root, blocks: bm }, blocks)
    },

    moveBlock(id, toColId, beforeId) {
      const m = get().manifest
      if (!m) return
      const root = clone(m.root)
      const loc = locate(root, id)
      if (!loc) return
      const [ref] = root.children[loc.rowIdx].columns[loc.colIdx].children.splice(loc.childIdx, 1)
      const target = findColumn(root, toColId)
      if (!target) return
      const idx = beforeId
        ? (() => {
            const i = target.col.children.findIndex((r) => r.ref === beforeId)
            return i >= 0 ? i : target.col.children.length
          })()
        : target.col.children.length
      target.col.children.splice(idx, 0, ref)
      cleanup(root)
      get()._commit({ ...m, root })
    },

    moveBlockDir(id, dir) {
      const m = get().manifest
      if (!m) return
      const root = clone(m.root)
      const loc = locate(root, id)
      if (!loc) return
      const col = root.children[loc.rowIdx].columns[loc.colIdx]
      const target = loc.childIdx + (dir === 'up' ? -1 : 1)
      if (target < 0 || target >= col.children.length) return // within-column only (P2)
      const tmp = col.children[loc.childIdx]
      col.children[loc.childIdx] = col.children[target]
      col.children[target] = tmp
      get()._commit({ ...m, root })
    },

    splitToColumn(id, side) {
      const m = get().manifest
      if (!m) return
      const loc = locate(m.root, id)
      if (!loc) return
      const row = m.root.children[loc.rowIdx]
      if (row.columns.length >= 4) return // ponytail: 4 列封顶,再多没法读
      // 整行只有这一个块时分栏无意义(拆出去原行就空了)。
      if (row.columns.length === 1 && row.columns[0].children.length === 1) return
      get().addColumnWithBlock(row.id, id, side)
    },

    addColumnWithBlock(rowId, id, side) {
      const m = get().manifest
      if (!m) return
      const root = clone(m.root)
      const loc = locate(root, id)
      if (!loc) return
      const [ref] = root.children[loc.rowIdx].columns[loc.colIdx].children.splice(loc.childIdx, 1)
      const row = root.children.find((r) => r.id === rowId)
      if (!row) {
        // target row vanished — fall back to a fresh row
        root.children.push({
          type: 'row',
          id: generateRowId(),
          columns: [{ id: generateColumnId(), width: 1, children: [ref] }],
        })
      } else {
        const col: ColumnNode = { id: generateColumnId(), width: 1, children: [ref] }
        if (side === 'left') row.columns.unshift(col)
        else row.columns.push(col)
        // equal split on structural change; user can fine-tune via the resizer
        const w = 1 / row.columns.length
        row.columns.forEach((c) => (c.width = w))
      }
      cleanup(root)
      get()._commit({ ...m, root })
    },

    addRowWithBlock(afterRowIndex, id) {
      const m = get().manifest
      if (!m) return
      const root = clone(m.root)
      const loc = locate(root, id)
      if (!loc) return
      const [ref] = root.children[loc.rowIdx].columns[loc.colIdx].children.splice(loc.childIdx, 1)
      const newRow: RowNode = {
        type: 'row',
        id: generateRowId(),
        columns: [{ id: generateColumnId(), width: 1, children: [ref] }],
      }
      const insertAt = Math.min(afterRowIndex + 1, root.children.length)
      root.children.splice(insertAt, 0, newRow)
      cleanup(root)
      get()._commit({ ...m, root })
    },

    resizeColumns(rowId, leftColId, rightColId, leftFraction) {
      const m = get().manifest
      if (!m) return
      const root = clone(m.root)
      const row = root.children.find((r) => r.id === rowId)
      if (!row) return
      const left = row.columns.find((c) => c.id === leftColId)
      const right = row.columns.find((c) => c.id === rightColId)
      if (!left || !right) return
      const combined = left.width + right.width
      const f = Math.max(0.12, Math.min(0.88, leftFraction))
      left.width = combined * f
      right.width = combined * (1 - f)
      get()._commit({ ...m, root })
    },

    setFmExtra(text) {
      const m = get().manifest
      if (!m) return
      const fmExtra = text.replace(/^\n+|\n+$/g, '')
      const next: PageManifest = { ...m }
      if (fmExtra) next.fmExtra = fmExtra
      else delete next.fmExtra
      get()._commit(next)
    },

    async save() {
      const { manifest, activePage, blocks } = get()
      if (!manifest || !activePage) return
      set({ status: 'saving' })
      try {
        const contents: Record<string, string> = {}
        for (const [id, b] of Object.entries(blocks)) contents[id] = b.content
        const toSave: PageManifest = { ...manifest, updatedAt: new Date().toISOString() }
        await amadeus.savePage(activePage, toSave, contents)
        set((s) => ({ manifest: toSave, status: 'ready', linkGraphVersion: s.linkGraphVersion + 1 }))
      } catch (e) {
        set({ status: 'ready', error: String(e) })
      }
    },

    async flushSave() {
      if (!saveTimer) return
      clearTimeout(saveTimer)
      saveTimer = null
      await get().save()
    },

    async reconcileExternal(path) {
      const { manifest, blocks, activePage } = get()
      if (!manifest || path !== activePage) return
      const contents: Record<string, string> = {}
      for (const [id, b] of Object.entries(blocks)) contents[id] = b.content
      try {
        const page = await amadeus.reconcilePage(path, manifest, contents)
        set((s) => ({ ...hydrate(page), linkGraphVersion: s.linkGraphVersion + 1 }))
      } catch (e) {
        set({ error: String(e) })
      }
    },

    _commit(manifest, blocks) {
      set(blocks ? { manifest, blocks } : { manifest })
      scheduleSave()
    },
  }
})
