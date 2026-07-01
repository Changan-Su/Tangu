// Id generation + note path helpers. v3 is single-file, so there are no block/folder
// filenames to derive — a note's blocks live inline in its one `.md`.

import { customAlphabet } from 'nanoid'
import type { BlockId, ColumnId, RowId } from './types'

// Lowercase alphanumerics only: safe on case-insensitive filesystems (macOS/Windows).
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'
const nano = customAlphabet(ALPHABET, 8)

/** The next free block id for a note: a short integer, one past the highest in use.
 *  Block ids are local to one file and only delimit ranges (the meaning is in the layout),
 *  so a number suffices. They are assigned-and-kept (never renumbered), so a cross-note
 *  `![[note#3]]` keeps pointing at the same block across edits. */
export function nextBlockId(existing: Iterable<BlockId>): BlockId {
  let max = 0
  for (const id of existing) {
    const n = Number.parseInt(String(id), 10)
    if (Number.isInteger(n) && String(n) === String(id) && n > max) max = n
  }
  return String(max + 1)
}
export function generatePageId(): string {
  return `pg_${nano()}`
}
export function generateRowId(): RowId {
  return `row_${nano()}`
}
export function generateColumnId(): ColumnId {
  return `col_${nano()}`
}

/** Last path segment of a page path with its trailing extension removed ("Notes/abc.md" -> "abc"). */
export function stripPageBasename(pagePath: string): string {
  const seg = pagePath.split(/[\\/]/).pop() ?? pagePath
  const dot = seg.lastIndexOf('.')
  return dot > 0 ? seg.slice(0, dot) : seg
}

/** Just the note file name within its folder ("Notes/abc.md" -> "abc.md"). */
export function pageFileName(pagePath: string): string {
  return pagePath.split(/[\\/]/).pop() ?? pagePath
}
