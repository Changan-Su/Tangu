import { memo, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { stripPageBasename } from '@amadeus-shared/compiler/names'
import { toAssetUrl } from '@amadeus-shared/assets'
import type { EmbedResolved } from '@amadeus-shared/ipc'
import { getBlockType } from '../blocks/registry'
import { DatabaseEmbed } from '../blocks/database/DatabaseEmbed'
import { usePageStore } from '../store/pageStore'
import { amadeus } from '../api'

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
  const linkVersion = usePageStore((s) => s.linkGraphVersion)

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
    const t = embedTarget.split('|')[0].trim()
    if (t.includes('#') || !DB_EXT_RE.test(t)) return null
    return { name: t }
  }, [embedTarget, embedImage])

  // Non-image file (has an extension, no block anchor) → inline preview (pdf/video/audio) or file card.
  const embedFile = useMemo(() => {
    if (!embedTarget || embedImage || embedDb) return null
    const t = embedTarget.split('|')[0].trim()
    if (t.includes('#') || !FILE_EXT_RE.test(t)) return null
    const kind = PDF_EXT_RE.test(t) ? 'pdf' : VIDEO_EXT_RE.test(t) ? 'video' : AUDIO_EXT_RE.test(t) ? 'audio' : 'other'
    return { name: t, kind, url: kind === 'other' ? '' : toAssetUrl(t) }
  }, [embedTarget, embedImage, embedDb])
  const [previewOpen, setPreviewOpen] = useState(true)

  // Resolve a cross-note embed; re-resolve when the link graph changes (source edited externally).
  const [embed, setEmbed] = useState<EmbedResolved | null | 'loading'>('loading')
  useEffect(() => {
    if (!embedTarget || embedImage || embedDb || embedFile) return
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
  }, [embedTarget, embedImage, embedDb, embedFile, linkVersion])

  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: blockId })

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

  if (!block) return null

  const onCtxMenu = (e: ReactMouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setBlockMenu({ x: e.clientX, y: e.clientY })
  }

  const dragHandle = (
    <div className="block-gutter">
      <button
        ref={setActivatorNodeRef}
        className="drag-handle"
        {...attributes}
        {...listeners}
        onClick={(e) => {
          e.stopPropagation()
          const r = e.currentTarget.getBoundingClientRect()
          setBlockMenu({ x: r.left, y: r.bottom + 4 })
        }}
        title="点击打开菜单,按住拖动 / Click for menu, hold to drag"
        aria-label="block menu / drag"
      >
        ⠿
      </button>
    </div>
  )

  /** 块菜单(fixed .ctx-menu):普通块四个动作;嵌入块只有 移到新列/移除。 */
  const blockMenuNode = blockMenu && (
    <div className="ctx-menu" style={{ left: Math.min(blockMenu.x, window.innerWidth - 190), top: Math.min(blockMenu.y, window.innerHeight - 170) }} onClick={(e) => e.stopPropagation()}>
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
        data-embed
        data-menu={blockMenu ? '' : undefined}
        data-dragging={isDragging || undefined}
        style={{ transform: CSS.Translate.toString(transform), transition }}
        onContextMenu={onCtxMenu}
      >
        {isDropTarget && <div className="drop-line" />}
        {dragHandle}
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

  // --- Database transclusion (`![[tasks.db]]`) → interactive table (✕ removes the block, not the file) ---
  if (embedDb) {
    return (
      <div
        ref={setNodeRef}
        className="block-host"
        data-block-id={blockId}
        data-embed
        data-menu={blockMenu ? '' : undefined}
        data-dragging={isDragging || undefined}
        style={{ transform: CSS.Translate.toString(transform), transition }}
        onContextMenu={onCtxMenu}
      >
        {isDropTarget && <div className="drop-line" />}
        {dragHandle}
        <div className="block-body">
          <DatabaseEmbed target={embedDb.name} pagePath={pagePath} />
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
        data-embed
        data-menu={blockMenu ? '' : undefined}
        data-dragging={isDragging || undefined}
        style={{ transform: CSS.Translate.toString(transform), transition }}
        onContextMenu={onCtxMenu}
      >
        {isDropTarget && <div className="drop-line" />}
        {dragHandle}
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
                  onClick={() => pagePath && void amadeus.openAttachment(pagePath, embedFile.name)}
                >
                  打开 ↗
                </button>
              </div>
              {previewOpen && embedFile.kind === 'pdf' && (
                <iframe className="embed-pdf" src={embedFile.url} title={embedFile.name} />
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
        data-embed
        data-menu={blockMenu ? '' : undefined}
        data-dragging={isDragging || undefined}
        style={{ transform: CSS.Translate.toString(transform), transition }}
        onContextMenu={onCtxMenu}
      >
        {isDropTarget && <div className="drop-line" />}
        {dragHandle}
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
      data-menu={blockMenu ? '' : undefined}
      data-dragging={isDragging || undefined}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      onContextMenu={onCtxMenu}
    >
      {isDropTarget && <div className="drop-line" />}
      {dragHandle}
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
