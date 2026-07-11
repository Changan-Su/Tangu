import { describe, expect, it } from 'vitest'
import type { DbRow } from './schema'
import { applyFilters, computeStat, matchFilter } from './viewQuery'

const rows: DbRow[] = [
  { id: 'r1', cells: { name: '写文档', n: 3, done: true, tag: ['红'], d: '2026-07-10' } },
  { id: 'r2', cells: { name: '开会', n: 10, done: false, tag: ['蓝', '红'], d: '2026-07-08T14:00/2026-07-09T10:00' } },
  { id: 'r3', cells: {} },
]

describe('viewQuery 筛选求值', () => {
  it('text contains / empty / notempty', () => {
    expect(matchFilter('写文档', { colId: 'name', op: 'contains', value: '文档' }, 'text')).toBe(true)
    expect(matchFilter('写文档', { colId: 'name', op: 'notcontains', value: '会' }, 'text')).toBe(true)
    expect(matchFilter(undefined, { colId: 'name', op: 'empty' }, 'text')).toBe(true)
    expect(matchFilter('x', { colId: 'name', op: 'notempty' }, 'text')).toBe(true)
  })

  it('number 比较缺值不命中;checkbox 一元', () => {
    expect(matchFilter(3, { colId: 'n', op: 'gt', value: 2 }, 'number')).toBe(true)
    expect(matchFilter(undefined, { colId: 'n', op: 'gt', value: 2 }, 'number')).toBe(false)
    expect(matchFilter(true, { colId: 'done', op: 'checked' }, 'checkbox')).toBe(true)
    expect(matchFilter(undefined, { colId: 'done', op: 'unchecked' }, 'checkbox')).toBe(true)
  })

  it('date:单日与 calendarDate 区间统一取开始日', () => {
    expect(matchFilter('2026-07-10', { colId: 'd', op: 'on', value: '2026-07-10' }, 'date')).toBe(true)
    expect(matchFilter('2026-07-08T14:00/2026-07-09T10:00', { colId: 'd', op: 'before', value: '2026-07-09' }, 'date')).toBe(true)
    expect(matchFilter('2026-07-08T14:00/2026-07-09T10:00', { colId: 'd', op: 'after', value: '2026-07-07' }, 'date')).toBe(true)
  })

  it('multiselect has;未知 op 恒真;未知列跳过条件', () => {
    expect(matchFilter(['红', '蓝'], { colId: 'tag', op: 'has', value: '红' }, 'multiselect')).toBe(true)
    expect(matchFilter('x', { colId: 'name', op: '2030年的新op', value: 'y' }, 'text')).toBe(true)
    const out = applyFilters(rows, [{ colId: '不存在', op: 'eq', value: 'x' }], () => null)
    expect(out).toHaveLength(3)
  })

  it('applyFilters AND 组合', () => {
    const out = applyFilters(
      rows,
      [
        { colId: 'n', op: 'gt', value: 1 },
        { colId: 'tag', op: 'has', value: '红' },
      ],
      (colId) => (colId === 'n' ? 'number' : colId === 'tag' ? 'multiselect' : 'text'),
    )
    expect(out.map((r) => r.id)).toEqual(['r1', 'r2'])
  })

  it('统计:count/sum/avg/checked', () => {
    expect(computeStat(rows, 'name', 'text', 'count')).toBe('2')
    expect(computeStat(rows, 'name', 'text', 'empty')).toBe('1')
    expect(computeStat(rows, 'n', 'number', 'sum')).toBe('13')
    expect(computeStat(rows, 'n', 'number', 'avg')).toBe('6.5')
    expect(computeStat(rows, 'done', 'checkbox', 'checked')).toBe('1')
    expect(computeStat(rows, 'done', 'checkbox', 'unchecked')).toBe('2')
  })
})
