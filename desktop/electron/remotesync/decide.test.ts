import { describe, expect, it } from 'vitest'
import { decide } from './decide'

const L = (h: string) => ({ h })
const P = (h: string, r: string) => ({ h, r })
const R = (id: string) => ({ id })

describe('remotesync decide', () => {
  it('无基线', () => {
    expect(decide(null, null, null)).toBe('noop')
    expect(decide(L('a'), null, null)).toBe('push')
    expect(decide(null, null, R('x'))).toBe('pull')
    expect(decide(L('a'), null, R('x'))).toBe('join')
  })

  it('有基线:单侧变更定向传播', () => {
    expect(decide(L('a'), P('a', 'x'), R('x'))).toBe('noop')
    expect(decide(L('b'), P('a', 'x'), R('x'))).toBe('push')
    expect(decide(L('a'), P('a', 'x'), R('y'))).toBe('pull')
    expect(decide(null, P('a', 'x'), R('x'))).toBe('pushDelete')
    expect(decide(L('a'), P('a', 'x'), null)).toBe('deleteLocal')
  })

  it('双侧都变:编辑赢过删除,双改为冲突', () => {
    expect(decide(null, P('a', 'x'), null)).toBe('forget')
    expect(decide(null, P('a', 'x'), R('y'))).toBe('pull')
    expect(decide(L('b'), P('a', 'x'), null)).toBe('push')
    expect(decide(L('b'), P('a', 'x'), R('y'))).toBe('conflict')
  })
})
