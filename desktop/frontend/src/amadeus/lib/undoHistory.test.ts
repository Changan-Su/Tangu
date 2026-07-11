import { describe, it, expect } from 'vitest'
import { makeUndoStack, type Snap } from './undoHistory'

const snap = (page: string, data: string): Snap<string> => ({ page, data })

describe('undoHistory', () => {
  it('undo/redo round-trips a single change', () => {
    const h = makeUndoStack<string>()
    h.push(snap('A', 'v0'), 'edit', 1000) // 变更前快照 v0;此后状态变为 v1
    expect(h.undo(snap('A', 'v1'))?.data).toBe('v0')
    expect(h.redo(snap('A', 'v0'))?.data).toBe('v1')
  })

  it('coalesces same-kind changes within the window into one step', () => {
    const h = makeUndoStack<string>({ coalesceMs: 500 })
    h.push(snap('A', 'v0'), 'edit', 1000)
    h.push(snap('A', 'v1'), 'edit', 1200) // 500ms 内同类 → 跳过,不建新步
    expect(h.undo(snap('A', 'v2'))?.data).toBe('v0') // 一次撤销直接回到打字前
    expect(h.undo(snap('A', 'v0'))).toBeNull()
  })

  it('does NOT coalesce across kinds', () => {
    const h = makeUndoStack<string>({ coalesceMs: 500 })
    h.push(snap('A', 'v0'), 'edit', 1000)
    h.push(snap('A', 'v1'), 'struct', 1100) // 不同类 → 单独一步
    expect(h.undo(snap('A', 'v2'))?.data).toBe('v1')
    expect(h.undo(snap('A', 'v1'))?.data).toBe('v0')
  })

  it('data-loss guard: refuses to undo into a different page and clears history', () => {
    const h = makeUndoStack<string>()
    h.push(snap('A', 'a0'), 'edit', 1000) // 快照属于笔记 A
    expect(h.undo(snap('B', 'b1'))).toBeNull() // 已切到 B,绝不把 A 的内容恢复到 B
    expect(h.undo(snap('A', 'a1'))).toBeNull() // 历史已清空 → 回到 A 也无残留(安全)
  })

  it('caps history growth', () => {
    const h = makeUndoStack<number>({ cap: 3, coalesceMs: 0 })
    for (let i = 0; i < 10; i++) h.push({ page: 'A', data: i }, 'edit', i)
    let n = 0
    while (h.undo({ page: 'A', data: 999 })) n++
    expect(n).toBe(3) // 只保留最近 3 步
  })
})
