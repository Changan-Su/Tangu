import { describe, expect, it } from 'vitest'
import { sectionOpenFrom } from './sectionOpen'

describe('sectionOpenFrom', () => {
  it('存过的值优先(用户手动开合要被记住)', () => {
    expect(sectionOpenFrom('1', false)).toBe(true)
    expect(sectionOpenFrom('0', true)).toBe(false)
  })
  it('⚠️没存过 → 回落 defaultOpen,**不能**当 false(否则 Vault 分区首次也被折叠 = 侧栏空白)', () => {
    expect(sectionOpenFrom(null, true)).toBe(true)
    expect(sectionOpenFrom(null, false)).toBe(false)
  })
  it('坏值同样回落 defaultOpen,不当 false', () => {
    expect(sectionOpenFrom('', true)).toBe(true)
    expect(sectionOpenFrom('true', true)).toBe(true)
    expect(sectionOpenFrom('yes', false)).toBe(false)
  })
})
