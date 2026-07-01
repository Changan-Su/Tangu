// The `amadeus_layout` frontmatter codec (StackNode <-> compact JSON) + in-memory layout
// helpers. Layout is the only structured metadata; block content lives inline in the body
// (see markers.ts) and there is no separate registry file.

import { z } from 'zod'
import {
  COMPILER_VERSION,
  PAGE_SCHEMA,
  type BlockEntry,
  type BlockId,
  type ColumnNode,
  type PageManifest,
  type RowNode,
  type StackNode,
} from './types'

const blockRefSchema = z.object({ ref: z.string() })
const columnNodeSchema = z.object({
  id: z.string(),
  width: z.number(),
  children: z.array(blockRefSchema),
})
const rowNodeSchema = z.object({
  type: z.literal('row'),
  id: z.string(),
  columns: z.array(columnNodeSchema),
})
const stackNodeSchema = z.object({
  type: z.literal('stack'),
  children: z.array(rowNodeSchema),
})

/** Serialize the layout to a single-line JSON string for the `amadeus_layout` frontmatter value. */
export function serializeLayout(root: StackNode): string {
  return JSON.stringify(root)
}

/** Parse the `amadeus_layout` frontmatter value back to a StackNode (empty on anything invalid). */
export function parseLayout(value: string | undefined): StackNode {
  if (!value) return { type: 'stack', children: [] }
  try {
    return stackNodeSchema.parse(JSON.parse(value)) as StackNode
  } catch {
    return { type: 'stack', children: [] }
  }
}

export function createEmptyManifest(opts: { id: string; title: string; now: string }): PageManifest {
  return {
    schema: PAGE_SCHEMA,
    id: opts.id,
    title: opts.title,
    createdAt: opts.now,
    updatedAt: opts.now,
    compiler: { version: COMPILER_VERSION },
    root: { type: 'stack', children: [] },
    blocks: {},
  }
}

/** A block resolved with its position context, in document order. */
export interface FlatBlock {
  ref: BlockId
  entry?: BlockEntry
  row: RowNode
  col: ColumnNode
}

/** Walk the layout in document order (row → column → cell). */
export function flattenBlocks(m: PageManifest): FlatBlock[] {
  const out: FlatBlock[] = []
  for (const row of m.root.children) {
    for (const col of row.columns) {
      for (const ref of col.children) {
        out.push({ ref: ref.ref, entry: m.blocks[ref.ref], row, col })
      }
    }
  }
  return out
}

/** Set of block ids actually placed by the layout (vs. parsed-but-unplaced). */
export function referencedBlockIds(m: PageManifest): Set<BlockId> {
  const ids = new Set<BlockId>()
  for (const row of m.root.children) {
    for (const col of row.columns) {
      for (const ref of col.children) ids.add(ref.ref)
    }
  }
  return ids
}
