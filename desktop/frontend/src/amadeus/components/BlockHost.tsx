import { Suspense, lazy, memo, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { stripPageBasename } from '@amadeus-shared/compiler/names'
import { toAssetUrl } from '@amadeus-shared/assets'
import { isDrawingPath } from '@amadeus-shared/excalidraw/format'
import type { EmbedResolved } from '@amadeus-shared/ipc'
import { getBlockType } from '../blocks/registry'
import { DatabaseEmbed } from '../blocks/database/DatabaseEmbed'
import { ExcalidrawEmbed } from '../blocks/excalidraw/ExcalidrawEmbed'
import { BookmarkCard } from './BookmarkCard'
import { useBlockSelection } from '../store/blockSelection'
import { useClampedMenu } from '../lib/clampMenu'
import { usePageStore } from '../store/pageStore'
import { usePluginStore, findEmbedRenderer } from '../plugins/pluginStore'
import { PluginEmbed } from '../blocks/plugin/PluginEmbed'
import { amadeus } from '../api'
import { resolveFileName } from '../lib/vaultFiles'

// PDF 预览用自家可批注阅读器的只读形态(Chromium 内置 iframe 阅读器观感突兀且不认主题)。
// 懒加载:pdf.js viewer 较重,chunk 与独立 PDF 视图共用,笔记里真有 PDF 块才拉。
const PdfEmbedViewer = lazy(() => import('../pdf/PdfAnnotator').then((m) => ({ default: m.PdfAnnotator })))

const noop = (): void => {}

/** A block whose entire content is a single `![[ ]]` is a cross-note embed. */
const EMBED_RE = /^!\[\[([^\]\n]+)\]\]$/
/** `![[pic.png]]` (optionally `![[pic.png|width]]`) is an image transclusion, not a block embed. */
const IMG_EXT_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i
/** `![[report.pdf]]` — a non-image file transclusion (has a file extension, no block anchor `#`) → file card. */
const FILE_EXT_RE = /\.[a-z0-9]{1,8}$/i
/** `![[tasks.db]]` — a Database file transclusion → interactive table (see blocks/database). */
const DB_EXT_RE = /\.db$/i
/* 可内联预览的文件类型(经 amadeus-asset:// 协议;PDF 用 Chromium 内置阅读器,音视频靠协议的 Range 支持 seek)。 */
const PDF_EXT_RE = /\.pdf$/i
const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v)$/i
const AUDIO_EXT_RE = /\.(mp3|wav|ogg|m4a|flac)$/i

/** Universal wrapper around any block: drag handle + actions + the resolved BlockType editor.
 *  A block whose content is just `![[note#id]]` renders the target read-only with a source link. */
export const BlockHost = memo(function BlockHost({
  blockId,
  autoFocus,
}: {
  blockId: string
  autoFocus?: boolean
}) {
  const block = usePageStore((s) => s.blocks[blockId])
  const setBlockContent = usePageStore((s) => s.setBlockContent)
  const insertBlockAfter = usePageStore((s) => s.insertBlockAfter)
  const duplicateBlock = usePageStore((s) => s.duplicateBlock)
  const splitToColumn = usePageStore((s) => s.splitToColumn)
  const deleteBlock = usePageStore((s) => s.deleteBlock)
  const deleteBlockFocusPrev = usePageStore((s) => s.deleteBlockFocusPrev)
  const mergeWithPrev = usePageStore((s) => s.mergeWithPrev)
  const focusAdjacent = usePageStore((s) => s.focusAdjacent)
  const moveBlockDir = usePageStore((s) => s.moveBlockDir)
  const requestFocus = usePageStore((s) => s.requestFocus)
  const consumeFocus = usePageStore((s) => s.consumeFocus)
  const openWikiLink = usePageStore((s) => s.openWikiLink)
  const focusPlace = usePageStore((s) => (s.focusRequest?.id === blockId ? s.focusRequest.place : null))
  const isDropTarget = usePageStore(
    (s) => s.dndOverId === blockId && s.dndActiveId !== null && s.dndActiveId !== blockId,
  )
  const pagePath = usePageStore((s) => s.activePage ?? '')
  const embedRenderers = usePluginStore((s) => s.embedRenderers)
  const selected = useBlockSelection((s) => s.ids.has(blockId))
  // linkGraphVersion 每次 save 都 bump;只有嵌入块(![[...]])需要跟着重解析。
  // 纯文本块订阅恒 0 → 不再「每次保存全页重渲染」(大页高频打字时的隐性卡源)。
  const linkVersion = usePageStore((s) =>
    (s.blocks[blockId]?.content ?? '').includes('![[') ? s.linkGraphVersion : 0,
  )

  const embedTarget = useMemo(() => {
    const m = EMBED_RE.exec((block?.content ?? '').trim())
    return m ? m[1] : null
  }, [block?.content])

  // `![[pic.png|200]]` → image transclusion: resolve the target (basename or vault path) to an
  // asset URL; the main asset protocol finds a bare basename anywhere in the vault (Obsidian-style).
  const embedImage = useMemo(() => {
    if (!embedTarget) return null
    const [rawPath, size] = embedTarget.split('|')
    const p = rawPath.trim()
    if (!IMG_EXT_RE.test(p)) return null
    const w = size?.trim()
    return { url: toAssetUrl(p), width: w && /^\d+$/.test(w) ? Number(w) : undefined, name: p }
  }, [embedTarget])

  // `![[xxx.db]]` → Database 嵌入(交互式表格,数据在独立 .db 文件;必须先于 embedFile 判定)。
  const embedDb = useMemo(() => {
    if (!embedTarget || embedImage) return null
    const [rawPath, viewName] = embedTarget.split('|') // `![[tasks.db|看板]]` 的管道段 = 激活视图名(存笔记 md,不碰 .db)
    const t = rawPath.trim()
    if (t.includes('#') || !DB_EXT_RE.test(t)) return null
    return { name: t, view: viewName?.trim() || null }
  }, [embedTarget, embedImage])

  // `![[画板.excalidraw]]` → Excalidraw 画板(文件其实是 `画板.excalidraw.md`,Obsidian 链接省略 .md 的
  // 惯例;主进程解析 ref 时会补回来)。同 embedDb:必须先于 embedFile 判定,否则被文件卡吃掉。
  const embedDraw = useMemo(() => {
    if (!embedTarget || embedImage || embedDb) return null
    const t = embedTarget.split('|')[0].trim()
    return !t.includes('#') && isDrawingPath(t) ? t : null
  }, [embedTarget, embedImage, embedDb])

  // 插件声明的文件类型嵌入(如 `![[x.mindmap.md]]`)→ 插件自渲染只读预览块。必须先于 embedFile,否则被文件卡吃掉。
  const embedPlugin = useMemo(() => {
    if (!embedTarget || embedImage || embedDb || embedDraw) return null
    // 先拿**完整 target** 问一次插件 matcher:`#` 和 `|` 也可以是文件夹/文件名的一部分
    // (笔记 `C# 日记.md` → `![[C# 日记.fd/x.mindmap.md]]`),无条件按 `#`/`|` 切断会把它误判成块锚点/别名
    // 而拒绝渲染(Codex)。完整串仍以插件声明的后缀结尾,足以与真正的 `file#block` 区分。
    const raw = embedTarget.trim()
    if (findEmbedRenderer(embedRenderers, raw)) return raw
    const t = raw.split('|')[0].trim()
    if (t.includes('#')) return null
    return findEmbedRenderer(embedRenderers, t) ? t : null
  }, [embedTarget, embedImage, embedDb, embedDraw, embedRenderers])

  // Non-image file (has an extension, no block anchor) → inline preview (pdf/video/audio) or file card.
  const embedFile = useMemo(() => {
    if (!embedTarget || embedImage || embedDb || embedDraw || embedPlugin) return null
    const t = embedTarget.split('|')[0].trim()
    if (t.includes('#') || !FILE_EXT_RE.test(t)) return null
    const kind = PDF_EXT_RE.test(t) ? 'pdf' : VIDEO_EXT_RE.test(t) ? 'video' : AUDIO_EXT_RE.test(t) ? 'audio' : 'other'
    return { name: t, kind, url: kind === 'other' ? '' : toAssetUrl(t) }
  }, [embedTarget, embedImage, embedDb, embedDraw, embedPlugin])
  const [previewOpen, setPreviewOpen] = useState(true)
  // PDF 嵌入:链接目标(可能是裸文件名)→ vault 路径,给只读阅读器读字节;解析不出退回 iframe。
  const vaultFiles = usePageStore((s) => s.files)
  const pdfVaultPath = useMemo(
    () => (embedFile?.kind === 'pdf' ? resolveFileName(embedFile.name, vaultFiles, pagePath) : null),
    [embedFile, vaultFiles, pagePath],
  )

  // 整块恰是一条裸 URL → 书签卡(og 元数据/YouTube 嵌入);md 落盘仍是那行 URL,零私有语法。
  const bookmarkUrl = useMemo(() => {
    const t = (block?.content ?? '').trim()
    return !embedTarget && /^https?:\/\/\S+$/i.test(t) ? t : null
  }, [block?.content, embedTarget])

  // Resolve a cross-note embed; re-resolve when the link graph changes (source edited externally).
  const [embed, setEmbed] = useState<EmbedResolved | null | 'loading'>('loading')
  useEffect(() => {
    if (!embedTarget || embedImage || embedDb || embedDraw || embedPlugin || embedFile) return
    let alive = true
    setEmbed('loading')
    amadeus
      .resolveEmbed(embedTarget)
      .then((r) => {
        if (alive) setEmbed(r)
      })
      .catch(() => {
        if (alive) setEmbed(null)
      })
    return () => {
      alive = false
    }
  }, [embedTarget, embedImage, embedDb, embedDraw, embedPlugin, embedFile, linkVersion])

  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: blockId })

  // 块级左右边缘落点(Notion 式两栏配对):仅拖拽进行中且非自身时激活/显示。
  const dndPairing = usePageStore((s) => s.dndActiveId !== null && s.dndActiveId !== blockId)
  const leftEdge = useDroppable({ id: `bedge:${blockId}:left`, disabled: !dndPairing })
  const rightEdge = useDroppable({ id: `bedge:${blockId}:right`, disabled: !dndPairing })
  const blockEdges = dndPairing ? (
    <>
      <div ref={leftEdge.setNodeRef} className="block-edge" data-side="left" data-over={leftEdge.isOver || undefined} />
      <div ref={rightEdge.setNodeRef} className="block-edge" data-side="right" data-over={rightEdge.isOver || undefined} />
    </>
  ) : null

  // Notion 式块菜单:点 ⠿(不动即点击,动 5px 起才是拖拽)或块上右键呼出;替代原右侧悬浮小图标列。
  const [blockMenu, setBlockMenu] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    if (!blockMenu) return
    // 捕获相 pointerdown/contextmenu:打开路径的 stopPropagation(止于 React 根)与 dnd-kit
    // 拖后吞 click(document 捕获)都拦不住它 → 别的块开菜单/起拖时旧菜单必被关(防同屏残留+拖拽期错位)。
    const close = (e: Event): void => {
      if (e.target instanceof Element && e.target.closest('.ctx-menu')) return // 点菜单项自身不先行卸载
      setBlockMenu(null)
    }
    window.addEventListener('pointerdown', close, { capture: true })
    window.addEventListener('contextmenu', close, { capture: true })
    return () => {
      window.removeEventListener('pointerdown', close, { capture: true })
      window.removeEventListener('contextmenu', close, { capture: true })
    }
  }, [blockMenu])
  // 菜单量真实尺寸后夹进视口(纵向溢出上移、横向溢出收进屏幕)。关闭态哨兵用 -1(非 0),
  // 否则恰在 (0,0) 打开时 deps 不变、layout effect 不触发 → 菜单不量测(codex P3)。
  const menuPos = useClampedMenu(blockMenu?.x ?? -1, blockMenu?.y ?? -1)

  if (!block) return null

  const onCtxMenu = (e: ReactMouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setBlockMenu({ x: e.clientX, y: e.clientY })
  }

  const gutter = (
    <div className="block-gutter">
      <button
        ref={setActivatorNodeRef}
        className="drag-handle"
        {...attributes}
        {...listeners}
        onClick={(e) => {
          e.stopPropagation()
          useBlockSelection.getState().select(blockId) // Notion 式:点手柄=选中块(键盘删/复制可用)
          const r = e.currentTarget.getBoundingClientRect()
          setBlockMenu({ x: r.left, y: r.bottom + 4 })
        }}
        title="点击打开菜单,按住拖动 / Click for menu, hold to drag"
        aria-label="block menu / drag"
      >
        ⠿
      </button>
      <button
        className="block-add"
        onClick={(e) => {
          e.stopPropagation()
          insertBlockAfter(blockId, undefined, '') // 自带 requestFocus,新块聚焦
        }}
        title="在下方插入块 / Add block below"
        aria-label="add block below"
      >
        ＋
      </button>
    </div>
  )

  /** 块菜单(fixed .ctx-menu):普通块四个动作;嵌入块只有 移到新列/移除。 */
  const blockMenuNode = blockMenu && (
    <div ref={menuPos.ref} className="ctx-menu" style={menuPos.style} onClick={(e) => e.stopPropagation()}>
      {!embedTarget && (
        <button onClick={() => { void navigator.clipboard?.writeText(`![[${stripPageBasename(pagePath)}#${blockId}]]`); setBlockMenu(null) }}>
          ↪ 复制嵌入引用
        </button>
      )}
      {!embedTarget && (
        <button onClick={() => { duplicateBlock(blockId); setBlockMenu(null) }}>⎘ 复制块</button>
      )}
      <button onClick={() => { splitToColumn(blockId, 'right'); setBlockMenu(null) }}>⫿ 移到新列</button>
      <button className="danger" onClick={() => { setBlockMenu(null); deleteBlock(blockId) }}>
        ✕ {embedTarget ? '移除嵌入' : '删除'}
      </button>
    </div>
  )

  // --- Image transclusion (`![[pic.png]]`) ---
  if (embedImage) {
    return (
      <div
        ref={setNodeRef}
        className="block-host"
        data-block-id={blockId}
        data-selected={selected || undefined}
        data-embed
        data-menu={blockMenu ? '' : undefined}
        data-dragging={isDragging || undefined}
        style={{ transform: CSS.Translate.toString(transform), transition }}
        onContextMenu={onCtxMenu}
        onFocusCapture={() => { if (useBlockSelection.getState().ids.size) useBlockSelection.getState().clear() }}
      >
        {isDropTarget && <div className="drop-line" />}
        {blockEdges}
        {gutter}
        <div className="block-body embed-image-body">
          <img
            className="embed-image"
            src={embedImage.url}
            alt={embedImage.name}
            draggable={false}
            style={embedImage.width ? { width: embedImage.width } : undefined}
          />
        </div>
        {blockMenuNode}
      </div>
    )
  }

  // --- 裸 URL 块 → 书签卡(✎ 就地改地址;删除走块菜单) ---
  if (bookmarkUrl) {
    return (
      <div
        ref={setNodeRef}
        className="block-host"
        data-block-id={blockId}
        data-selected={selected || undefined}
        data-embed
        data-menu={blockMenu ? '' : undefined}
        data-dragging={isDragging || undefined}
        style={{ transform: CSS.Translate.toString(transform), transition }}
        onContextMenu={onCtxMenu}
        onFocusCapture={() => { if (useBlockSelection.getState().ids.size) useBlockSelection.getState().clear() }}
      >
        {isDropTarget && <div className="drop-line" />}
        {blockEdges}
        {gutter}
        <div className="block-body">
          <BookmarkCard url={bookmarkUrl} onChangeUrl={(next) => setBlockContent(blockId, next)} />
        </div>
        {blockMenuNode}
      </div>
    )
  }

  // --- Database transclusion (`![[tasks.db]]`) → interactive table (✕ removes the block, not the file) ---
  if (embedDb) {
    return (
      <div
        ref={setNodeRef}
        className="block-host"
        data-block-id={blockId}
        data-selected={selected || undefined}
        data-embed
        data-menu={blockMenu ? '' : undefined}
        data-dragging={isDragging || undefined}
        style={{ transform: CSS.Translate.toString(transform), transition }}
        onContextMenu={onCtxMenu}
        onFocusCapture={() => { if (useBlockSelection.getState().ids.size) useBlockSelection.getState().clear() }}
      >
        {isDropTarget && <div className="drop-line" />}
        {blockEdges}
        {gutter}
        <div className="block-body">
          <DatabaseEmbed
            target={embedDb.name}
            pagePath={pagePath}
            initialView={embedDb.view}
            onViewChange={(v) => setBlockContent(blockId, v ? `![[${embedDb.name}|${v}]]` : `![[${embedDb.name}]]`)}
          />
        </div>
        {blockMenuNode}
      </div>
    )
  }

  // --- Excalidraw 画板(`![[画板.excalidraw]]`)→ 可编辑画布(✕ 只移除块,不删文件) ---
  if (embedDraw) {
    return (
      <div
        ref={setNodeRef}
        className="block-host"
        data-block-id={blockId}
        data-selected={selected || undefined}
        data-embed
        data-menu={blockMenu ? '' : undefined}
        data-dragging={isDragging || undefined}
        style={{ transform: CSS.Translate.toString(transform), transition }}
        onContextMenu={onCtxMenu}
        onFocusCapture={() => { if (useBlockSelection.getState().ids.size) useBlockSelection.getState().clear() }}
      >
        {isDropTarget && <div className="drop-line" />}
        {blockEdges}
        {gutter}
        <div className="block-body">
          <ExcalidrawEmbed target={embedDraw} pagePath={pagePath} />
        </div>
        {blockMenuNode}
      </div>
    )
  }

  // --- 插件文件类型嵌入(`![[x.mindmap.md]]`)→ 插件只读预览块(✕ 只移除块,不删文件) ---
  if (embedPlugin) {
    return (
      <div
        ref={setNodeRef}
        className="block-host"
        data-block-id={blockId}
        data-selected={selected || undefined}
        data-embed
        data-menu={blockMenu ? '' : undefined}
        data-dragging={isDragging || undefined}
        style={{ transform: CSS.Translate.toString(transform), transition }}
        onContextMenu={onCtxMenu}
        onFocusCapture={() => { if (useBlockSelection.getState().ids.size) useBlockSelection.getState().clear() }}
      >
        {isDropTarget && <div className="drop-line" />}
        {blockEdges}
        {gutter}
        <div className="block-body">
          <PluginEmbed target={embedPlugin} pagePath={pagePath} />
        </div>
        {blockMenuNode}
      </div>
    )
  }

  // --- Non-image file transclusion (`![[report.pdf]]`) → openable file card ---
  if (embedFile) {
    return (
      <div
        ref={setNodeRef}
        className="block-host"
        data-block-id={blockId}
        data-selected={selected || undefined}
        data-embed
        data-menu={blockMenu ? '' : undefined}
        data-dragging={isDragging || undefined}
        style={{ transform: CSS.Translate.toString(transform), transition }}
        onContextMenu={onCtxMenu}
        onFocusCapture={() => { if (useBlockSelection.getState().ids.size) useBlockSelection.getState().clear() }}
      >
        {isDropTarget && <div className="drop-line" />}
        {blockEdges}
        {gutter}
        <div className="block-body">
          {embedFile.kind === 'other' ? (
            <button
              className="embed-file"
              onClick={() => pagePath && void amadeus.openAttachment(pagePath, embedFile.name)}
              title="用系统默认程序打开"
            >
              <span className="embed-file-ic" aria-hidden>📄</span>
              <span className="embed-file-name">{embedFile.name}</span>
              <span className="embed-file-open">打开 ↗</span>
            </button>
          ) : (
            <div className="embed-media">
              <div className="embed-media-head">
                <span className="embed-file-ic" aria-hidden>
                  {embedFile.kind === 'pdf' ? '📕' : embedFile.kind === 'video' ? '🎬' : '🎵'}
                </span>
                <span className="embed-file-name">{embedFile.name}</span>
                <button className="embed-media-btn" onClick={() => setPreviewOpen((o) => !o)}>
                  {previewOpen ? '收起' : '展开'}
                </button>
                <button
                  className="embed-media-btn"
                  title={embedFile.kind === 'pdf' ? '在 Forsion 标签页中打开(可批注)' : '用系统默认程序打开'}
                  onClick={() => {
                    // PDF 在应用内新 tab 打开可批注阅读器(openWikiLink 的 .pdf 分支);音视频仍交给系统播放器。
                    if (embedFile.kind === 'pdf') openWikiLink(embedFile.name, pagePath)
                    else if (pagePath) void amadeus.openAttachment(pagePath, embedFile.name)
                  }}
                >
                  打开 ↗
                </button>
              </div>
              {previewOpen && embedFile.kind === 'pdf' && (
                pdfVaultPath ? (
                  <div className="embed-pdf embed-pdf-live">
                    <Suspense fallback={<div className="embed-pdf-loading">加载 PDF…</div>}>
                      <PdfEmbedViewer pdfPath={pdfVaultPath} readOnly />
                    </Suspense>
                  </div>
                ) : (
                  <iframe className="embed-pdf" src={embedFile.url} title={embedFile.name} />
                )
              )}
              {previewOpen && embedFile.kind === 'video' && (
                <video className="embed-video" src={embedFile.url} controls preload="metadata" />
              )}
              {previewOpen && embedFile.kind === 'audio' && (
                <audio className="embed-audio" src={embedFile.url} controls preload="metadata" />
              )}
            </div>
          )}
        </div>
        {blockMenuNode}
      </div>
    )
  }

  // --- Cross-note embed (read-only) ---
  if (embedTarget) {
    const et = embed && embed !== 'loading' ? getBlockType(embed.type) : undefined
    const EmbedEditor = et?.Editor
    return (
      <div
        ref={setNodeRef}
        className="block-host"
        data-block-id={blockId}
        data-selected={selected || undefined}
        data-embed
        data-menu={blockMenu ? '' : undefined}
        data-dragging={isDragging || undefined}
        style={{ transform: CSS.Translate.toString(transform), transition }}
        onContextMenu={onCtxMenu}
        onFocusCapture={() => { if (useBlockSelection.getState().ids.size) useBlockSelection.getState().clear() }}
      >
        {isDropTarget && <div className="drop-line" />}
        {blockEdges}
        {gutter}
        <div className="block-body embed-body">
          <div className="embed-head">
            <span className="embed-badge" title="跨笔记嵌入（只读）">
              ↪ 嵌入
            </span>
            {embed && embed !== 'loading' && (
              <button
                className="embed-src"
                onClick={() => void usePageStore.getState().loadPage(embed.owner)} // 已持有全路径,不走 basename 往返(重名会开错)
                title="去源头编辑"
              >
                {stripPageBasename(embed.owner)} ↗
              </button>
            )}
          </div>
          {embed === 'loading' ? (
            <div className="embed-loading">解析中…</div>
          ) : embed && EmbedEditor ? (
            <EmbedEditor
              blockId={blockId}
              content={embed.content}
              pagePath={embed.owner}
              readOnly
              onChange={noop}
              onInsertAfter={noop}
              onDeleteEmpty={noop}
              onMergePrev={noop}
              onArrowOut={noop}
              onMoveDir={noop}
              focusPlace={null}
              onFocused={noop}
              requestSelfFocus={noop}
              onOpenWiki={(name) => openWikiLink(name, embed.owner)} // 嵌入内容里的链接按其所有者解析
              getPageNames={() => usePageStore.getState().pages}
            />
          ) : (
            <div className="embed-missing">
              嵌入丢失：<code>{embedTarget}</code>
            </div>
          )}
        </div>
        {blockMenuNode}
      </div>
    )
  }

  // --- Normal (owned) block ---
  const bt = getBlockType(block.type)
  const Editor = bt?.Editor

  return (
    <div
      ref={setNodeRef}
      className="block-host"
      data-block-id={blockId}
      data-selected={selected || undefined}
      data-menu={blockMenu ? '' : undefined}
      data-dragging={isDragging || undefined}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      onContextMenu={onCtxMenu}
        onFocusCapture={() => { if (useBlockSelection.getState().ids.size) useBlockSelection.getState().clear() }}
    >
      {isDropTarget && <div className="drop-line" />}
      {blockEdges /* 七个 embed 分支都有,唯独普通块(text)漏了 → text 块左右分栏从来没有落点(实报根因) */}
      {gutter}
      <div className="block-body">
        {Editor ? (
          <Editor
            blockId={blockId}
            content={block.content}
            pagePath={pagePath}
            autoFocus={autoFocus}
            onChange={(c) => setBlockContent(blockId, c)}
            onInsertAfter={(content) => insertBlockAfter(blockId, undefined, content)}
            onDeleteEmpty={() => deleteBlockFocusPrev(blockId)}
            onMergePrev={() => mergeWithPrev(blockId)}
            onArrowOut={(dir) => focusAdjacent(blockId, dir)}
            onMoveDir={(dir) => moveBlockDir(blockId, dir)}
            focusPlace={focusPlace}
            onFocused={() => consumeFocus(blockId)}
            requestSelfFocus={(place) => requestFocus(blockId, place)}
            onOpenWiki={(name) => openWikiLink(name, pagePath)}
            onInsertEmbed={(t) => usePageStore.getState().insertEmbed(t)}
            getPageNames={() => usePageStore.getState().pages}
          />
        ) : (
          <div className="block-unknown">未知块类型：{block.type}</div>
        )}
      </div>
      {blockMenuNode}
    </div>
  )
})
