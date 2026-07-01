import { memo, useEffect, useMemo, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { stripPageBasename } from '@amadeus-shared/compiler/names'
import { toAssetUrl } from '@amadeus-shared/assets'
import type { EmbedResolved } from '@amadeus-shared/ipc'
import { getBlockType } from '../blocks/registry'
import { usePageStore } from '../store/pageStore'
import { amadeus } from '../api'

const noop = (): void => {}

/** A block whose entire content is a single `![[ ]]` is a cross-note embed. */
const EMBED_RE = /^!\[\[([^\]\n]+)\]\]$/
/** `![[pic.png]]` (optionally `![[pic.png|width]]`) is an image transclusion, not a block embed. */
const IMG_EXT_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i
/** `![[report.pdf]]` — a non-image file transclusion (has a file extension, no block anchor `#`) → file card. */
const FILE_EXT_RE = /\.[a-z0-9]{1,8}$/i

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

  // Non-image file (has an extension, no block anchor) → a file card that opens on click.
  const embedFile = useMemo(() => {
    if (!embedTarget || embedImage) return null
    const t = embedTarget.split('|')[0].trim()
    if (t.includes('#') || !FILE_EXT_RE.test(t)) return null
    return { name: t }
  }, [embedTarget, embedImage])

  // Resolve a cross-note embed; re-resolve when the link graph changes (source edited externally).
  const [embed, setEmbed] = useState<EmbedResolved | null | 'loading'>('loading')
  useEffect(() => {
    if (!embedTarget || embedImage || embedFile) return
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
  }, [embedTarget, embedImage, embedFile, linkVersion])

  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: blockId })

  if (!block) return null

  const dragHandle = (
    <div className="block-gutter">
      <button
        ref={setActivatorNodeRef}
        className="drag-handle"
        {...attributes}
        {...listeners}
        title="拖动 / Drag"
        aria-label="drag block"
      >
        ⠿
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
        data-dragging={isDragging || undefined}
        style={{ transform: CSS.Translate.toString(transform), transition }}
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
        <div className="block-actions">
          <button
            className="block-act block-del"
            onClick={() => deleteBlock(blockId)}
            title="移除嵌入 / Remove embed"
            aria-label="remove embed"
          >
            ✕
          </button>
        </div>
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
        data-dragging={isDragging || undefined}
        style={{ transform: CSS.Translate.toString(transform), transition }}
      >
        {isDropTarget && <div className="drop-line" />}
        {dragHandle}
        <div className="block-body">
          <button
            className="embed-file"
            onClick={() => pagePath && void amadeus.openAttachment(pagePath, embedFile.name)}
            title="用系统默认程序打开"
          >
            <span className="embed-file-ic" aria-hidden>📄</span>
            <span className="embed-file-name">{embedFile.name}</span>
            <span className="embed-file-open">打开 ↗</span>
          </button>
        </div>
        <div className="block-actions">
          <button
            className="block-act block-del"
            onClick={() => deleteBlock(blockId)}
            title="移除嵌入 / Remove embed"
            aria-label="remove embed"
          >
            ✕
          </button>
        </div>
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
        data-dragging={isDragging || undefined}
        style={{ transform: CSS.Translate.toString(transform), transition }}
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
                onClick={() => openWikiLink(stripPageBasename(embed.owner))}
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
              onOpenWiki={(name) => openWikiLink(name)}
              getPageNames={() => usePageStore.getState().pages}
            />
          ) : (
            <div className="embed-missing">
              嵌入丢失：<code>{embedTarget}</code>
            </div>
          )}
        </div>
        <div className="block-actions">
          <button
            className="block-act block-del"
            onClick={() => deleteBlock(blockId)}
            title="移除嵌入 / Remove embed"
            aria-label="remove embed"
          >
            ✕
          </button>
        </div>
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
      data-dragging={isDragging || undefined}
      style={{ transform: CSS.Translate.toString(transform), transition }}
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
            onOpenWiki={(name) => openWikiLink(name)}
            onInsertEmbed={(t) => usePageStore.getState().insertEmbed(t)}
            getPageNames={() => usePageStore.getState().pages}
          />
        ) : (
          <div className="block-unknown">未知块类型：{block.type}</div>
        )}
      </div>
      <div className="block-actions">
        <button
          className="block-act"
          onClick={() =>
            void navigator.clipboard?.writeText(`![[${stripPageBasename(pagePath)}#${blockId}]]`)
          }
          title="复制嵌入引用 / Copy embed ref"
          aria-label="copy embed ref"
        >
          ↪
        </button>
        <button
          className="block-act"
          onClick={() => duplicateBlock(blockId)}
          title="复制 / Duplicate"
          aria-label="duplicate block"
        >
          ⎘
        </button>
        <button
          className="block-act block-del"
          onClick={() => deleteBlock(blockId)}
          title="删除 / Delete"
          aria-label="delete block"
        >
          ✕
        </button>
      </div>
    </div>
  )
})
