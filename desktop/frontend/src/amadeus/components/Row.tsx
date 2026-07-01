import { Fragment } from 'react'
import { useDroppable } from '@dnd-kit/core'
import type { RowNode } from '@amadeus-shared/compiler/types'
import { Column } from './Column'
import { ColumnResizer } from './ColumnResizer'

/** A horizontal row of columns, with resizers between them and edge drop-zones
 *  on each side (drop a block on an edge to split into a new column). */
export function Row({ row }: { row: RowNode }) {
  return (
    <div className="row">
      <EdgeZone rowId={row.id} side="left" />
      <div className="row-cols">
        {row.columns.map((col, i) => (
          <Fragment key={col.id}>
            {i > 0 && (
              <ColumnResizer
                rowId={row.id}
                leftColId={row.columns[i - 1].id}
                rightColId={col.id}
              />
            )}
            <Column col={col} />
          </Fragment>
        ))}
      </div>
      <EdgeZone rowId={row.id} side="right" />
    </div>
  )
}

function EdgeZone({ rowId, side }: { rowId: string; side: 'left' | 'right' }) {
  const { setNodeRef, isOver } = useDroppable({ id: `edge:${rowId}:${side}` })
  return <div ref={setNodeRef} className="edge-zone" data-side={side} data-over={isOver || undefined} />
}
