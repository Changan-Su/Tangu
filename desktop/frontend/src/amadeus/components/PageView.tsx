import { Fragment, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { usePageStore, type Status } from '../store/pageStore'
import { Row } from './Row'
import { BacklinksPanel } from './BacklinksPanel'

function statusLabel(s: Status): string {
  return s === 'saving' ? '保存中…' : s === 'loading' ? '加载中…' : s === 'ready' ? '已保存' : ''
}

function previewText(content?: string): string {
  if (!content) return '空块'
  const line = content.replace(/[#>*_`\-[\]]/g, '').trim().split('\n')[0]
  return line.length > 48 ? line.slice(0, 48) + '…' : line || '空块'
}

function RowGap({ index }: { index: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `gap:${index}` })
  return <div ref={setNodeRef} className="row-gap" data-over={isOver || undefined} />
}

export function PageView({ bare = false }: { bare?: boolean } = {}) {
  const manifest = usePageStore((s) => s.manifest)
  const blocks = usePageStore((s) => s.blocks)
  const status = usePageStore((s) => s.status)
  const activePage = usePageStore((s) => s.activePage)
  const moveBlock = usePageStore((s) => s.moveBlock)
  const addColumnWithBlock = usePageStore((s) => s.addColumnWithBlock)
  const addRowWithBlock = usePageStore((s) => s.addRowWithBlock)
  const insertBlockAfter = usePageStore((s) => s.insertBlockAfter)
  const renamePage = usePageStore((s) => s.renamePage)
  const setDnd = usePageStore((s) => s.setDnd)

  const [activeId, setActiveId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  if (!manifest) return <div className="empty-state">打开一个 Vault，或新建页面开始。</div>
  const root = manifest.root

  const titleText = manifest.title || activePage?.split('/').pop() || ''
  const startTitleEdit = (): void => {
    setTitleDraft(titleText)
    setEditingTitle(true)
  }
  const commitTitle = async (): Promise<void> => {
    setEditingTitle(false)
    const name = titleDraft.trim()
    if (name && name !== titleText) await renamePage(name)
  }

  const columnOfBlock = (id: string): string | null => {
    for (const row of root.children)
      for (const col of row.columns) if (col.children.some((r) => r.ref === id)) return col.id
    return null
  }

  const onDragStart = (e: DragStartEvent): void => {
    setActiveId(String(e.active.id))
    setDnd(String(e.active.id), null)
  }

  const onDragOver = (e: DragOverEvent): void => {
    const active = String(e.active.id)
    const overId = e.over ? String(e.over.id) : ''
    // Only blocks get the insertion line; columns/edges/gaps highlight themselves.
    const overBlock = overId && !overId.includes(':') && overId !== active ? overId : null
    setDnd(active, overBlock)
  }

  const onDragCancel = (): void => {
    setActiveId(null)
    setDnd(null, null)
  }

  const onDragEnd = (e: DragEndEvent): void => {
    setActiveId(null)
    setDnd(null, null)
    const activeBlock = String(e.active.id)
    if (!e.over) return
    const overId = String(e.over.id)

    if (overId.startsWith('edge:')) {
      const [, rowId, side] = overId.split(':')
      addColumnWithBlock(rowId, activeBlock, side === 'left' ? 'left' : 'right')
    } else if (overId.startsWith('gap:')) {
      addRowWithBlock(Number(overId.slice(4)), activeBlock)
    } else if (overId.startsWith('col:')) {
      moveBlock(activeBlock, overId.slice(4), null)
    } else if (overId !== activeBlock) {
      const colId = columnOfBlock(overId)
      if (colId) moveBlock(activeBlock, colId, overId)
    }
  }

  return (
    <div className="page-view" data-bare={bare || undefined}>
      {!bare && (
      <header className="page-header">
        {editingTitle ? (
          <input
            className="page-title-edit"
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => void commitTitle()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void commitTitle()
              } else if (e.key === 'Escape') {
                setEditingTitle(false)
              }
            }}
          />
        ) : (
          <div className="page-title" onClick={startTitleEdit} title="点击重命名页面">
            {titleText}
          </div>
        )}
        <div className="page-status" data-status={status}>
          {statusLabel(status)}
        </div>
      </header>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        // 桌面壳把 edge-zone 静止时压成零宽、拖拽中才浮现 → 必须拖拽期间持续重测 droppable 矩形。
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <div className="stack" data-dnd={activeId ? '' : undefined}>
          <RowGap index={-1} />
          {root.children.map((row, i) => (
            <Fragment key={row.id}>
              <Row row={row} />
              <RowGap index={i} />
            </Fragment>
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeId ? <div className="drag-overlay">{previewText(blocks[activeId]?.content)}</div> : null}
        </DragOverlay>
      </DndContext>

      {!bare && (
        <div className="page-footer">
          <button className="add-block" onClick={() => insertBlockAfter(null)}>
            ＋ 新块
          </button>
          <span className="hint-inline">拖动 ⠿ 到列边缘可分栏 · 拖到行间可新建行</span>
        </div>
      )}

      {!bare && <BacklinksPanel />}
    </div>
  )
}
