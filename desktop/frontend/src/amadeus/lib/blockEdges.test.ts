import { describe, expect, it } from 'vitest'
import type { StackNode } from '@amadeus-shared/compiler/types'
import { edgeBlock } from './blockEdges'

/** rows[i][j] = 第 i 行第 j 列的块 id 列表。 */
const stack = (rows: string[][][]): StackNode => ({
  type: 'stack',
  children: rows.map((cols, i) => ({
    type: 'row' as const,
    id: `row_${i}`,
    columns: cols.map((ids, j) => ({ id: `col_${i}${j}`, width: 1 / cols.length, children: ids.map((ref) => ({ ref })) })),
  })),
})

describe('edgeBlock', () => {
  it('空正文两端都是 null', () => {
    expect(edgeBlock(stack([]), 'first')).toBeNull()
    expect(edgeBlock(stack([[[]]]), 'last')).toBeNull() // 有行有列但无块
  })

  it('单行单列取首尾块', () => {
    const s = stack([[['a', 'b', 'c']]])
    expect(edgeBlock(s, 'first')).toBe('a')
    expect(edgeBlock(s, 'last')).toBe('c')
  })

  it('多行:first 取首行、last 取末行', () => {
    const s = stack([[['a']], [['b']], [['c']]])
    expect(edgeBlock(s, 'first')).toBe('a')
    expect(edgeBlock(s, 'last')).toBe('c')
  })

  it('分栏行:first 取首列、last 取「末列」(对齐 appendToEnd 落点)', () => {
    const s = stack([[['a', 'b'], ['c', 'd']]])
    expect(edgeBlock(s, 'first')).toBe('a')
    expect(edgeBlock(s, 'last')).toBe('d')
  })
})
