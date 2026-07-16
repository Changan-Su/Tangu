import { describe, it, expect } from 'vitest'
import { reconcileElements, mergeScenes, sameElements, type SceneElement } from './reconcile'

const el = (id: string, version = 1, versionNonce = 0, extra: Partial<SceneElement> = {}): SceneElement => ({
  id,
  version,
  versionNonce,
  index: extra.index ?? 'a0',
  ...extra,
})

describe('reconcileElements', () => {
  it('不同元素取并集(两端各画各的都保留)', () => {
    const merged = reconcileElements([el('L', 1, 0, { index: 'a1' })], [el('R', 1, 0, { index: 'a0' })])
    expect(merged.map((e) => e.id)).toEqual(['R', 'L']) // 按 fractional index 排序
  })

  it('同 id:version 高者胜', () => {
    const merged = reconcileElements([el('x', 5, 9, { w: 'local' })], [el('x', 3, 1, { w: 'remote' })])
    expect(merged).toHaveLength(1)
    expect(merged[0].w).toBe('local')
  })

  it('同 id 平局:versionNonce 小者胜(本地 <= 远端时本地留)', () => {
    expect(reconcileElements([el('x', 2, 1, { w: 'l' })], [el('x', 2, 2, { w: 'r' })])[0].w).toBe('l')
    expect(reconcileElements([el('x', 2, 3, { w: 'l' })], [el('x', 2, 2, { w: 'r' })])[0].w).toBe('r')
  })

  it('删除墓碑参与合并(远端高版删除压过本地旧版)', () => {
    const merged = reconcileElements([el('x', 2, 0)], [el('x', 3, 0, { isDeleted: true })])
    expect(merged[0].isDeleted).toBe(true)
  })

  it('无 index 的老元素排末尾且保持相对位序', () => {
    const merged = reconcileElements(
      [el('b', 1, 0, { index: null }), el('c', 1, 0, { index: null })],
      [el('a', 1, 0, { index: 'a0' })],
    )
    expect(merged.map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('sameElements', () => {
  it('id/version/versionNonce 全同 = 收敛', () => {
    expect(sameElements([el('a', 1, 7)], [el('a', 1, 7)])).toBe(true)
    expect(sameElements([el('a', 1, 7)], [el('a', 2, 7)])).toBe(false)
    expect(sameElements([el('a')], [el('a'), el('b')])).toBe(false)
  })
})

describe('mergeScenes', () => {
  it('elements 合并、files 并集、appState 本地优先、顶层键保留', () => {
    const merged = mergeScenes(
      { type: 'excalidraw', elements: [el('L')], appState: { gridSize: 20 }, files: { f1: { a: 1 } } },
      { type: 'excalidraw', elements: [el('R', 1, 0, { index: 'b0' })], appState: { gridSize: 5 }, files: { f2: { b: 2 } } },
    )
    expect((merged.elements ?? []).map((e) => e.id)).toEqual(['L', 'R'])
    expect(merged.appState).toEqual({ gridSize: 20 })
    expect(Object.keys(merged.files ?? {}).sort()).toEqual(['f1', 'f2'])
    expect(merged.type).toBe('excalidraw')
  })
})
