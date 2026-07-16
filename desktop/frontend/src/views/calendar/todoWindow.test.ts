import { describe, expect, it } from 'vitest'
import { centeredRange, windowTotal } from './todoWindow'

const iso = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

describe('todoWindow 前后对称窗口', () => {
  const today = new Date(2026, 6, 14) // 2026-07-14

  it('日 = 当天', () => {
    const r = centeredRange(1, today)
    expect([iso(r.start), iso(r.end)]).toEqual(['2026-07-14', '2026-07-14'])
  })
  it('3日 = 前后各一天', () => {
    const r = centeredRange(3, today)
    expect([iso(r.start), iso(r.end)]).toEqual(['2026-07-13', '2026-07-15'])
  })
  it('周 = 前后各三天', () => {
    const r = centeredRange(7, today)
    expect([iso(r.start), iso(r.end)]).toEqual(['2026-07-11', '2026-07-17'])
  })
  it('月(31)= 前后各十五天', () => {
    const r = centeredRange(31, today)
    expect([iso(r.start), iso(r.end)]).toEqual(['2026-06-29', '2026-07-29'])
  })
  it('偶数自定义 = 后侧多一天', () => {
    const r = centeredRange(4, today)
    expect([iso(r.start), iso(r.end)]).toEqual(['2026-07-13', '2026-07-16'])
  })
  it('windowTotal', () => {
    expect(windowTotal('week', 5)).toBe(7)
    expect(windowTotal('custom', 5)).toBe(5)
    expect(windowTotal('custom', 0)).toBe(1)
  })
})
