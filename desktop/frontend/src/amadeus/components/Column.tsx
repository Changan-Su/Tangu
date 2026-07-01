import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { ColumnNode } from '@amadeus-shared/compiler/types'
import { usePageStore } from '../store/pageStore'
import { BlockHost } from './BlockHost'

/** A vertical, sortable stack of blocks. Width is proportional (flex-grow = fraction). */
export function Column({ col }: { col: ColumnNode }) {
  const insertBlockAfter = usePageStore((s) => s.insertBlockAfter)
  const { setNodeRef, isOver } = useDroppable({ id: `col:${col.id}` })
  const ids = col.children.map((r) => r.ref)

  return (
    <div
      ref={setNodeRef}
      className="column"
      data-col={col.id}
      data-over={isOver || undefined}
      style={{ flexGrow: col.width, flexBasis: 0 }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {ids.map((id) => (
          <BlockHost key={id} blockId={id} />
        ))}
      </SortableContext>
      <button className="col-add" onClick={() => insertBlockAfter(null, col.id)}>
        ＋ 块
      </button>
    </div>
  )
}
