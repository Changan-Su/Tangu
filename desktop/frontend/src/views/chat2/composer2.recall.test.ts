import { describe, it, expect } from 'vitest'
import { pickRecall } from './Composer2'

// Item 1 历史召回索引算术:↑ 由新到旧、↓ 回到暂存草稿,越界不动。
describe('pickRecall (composer history nav)', () => {
  const hist = ['first', 'second', 'third'] // 旧→新

  it('ArrowUp walks newest→oldest, then stops at oldest', () => {
    expect(pickRecall(hist, 0, true, 'draft')).toEqual({ pos: 1, val: 'third' })
    expect(pickRecall(hist, 1, true, 'draft')).toEqual({ pos: 2, val: 'second' })
    expect(pickRecall(hist, 2, true, 'draft')).toEqual({ pos: 3, val: 'first' })
    expect(pickRecall(hist, 3, true, 'draft')).toBeNull() // 已到最旧
  })

  it('ArrowDown walks back toward the stashed draft, then stops', () => {
    expect(pickRecall(hist, 3, false, 'draft')).toEqual({ pos: 2, val: 'second' })
    expect(pickRecall(hist, 1, false, 'draft')).toEqual({ pos: 0, val: 'draft' }) // 回到草稿
    expect(pickRecall(hist, 0, false, 'draft')).toBeNull() // 已在草稿
  })

  it('empty history never recalls', () => {
    expect(pickRecall([], 0, true, 'draft')).toBeNull()
  })
})
