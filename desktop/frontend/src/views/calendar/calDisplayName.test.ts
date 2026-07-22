import { describe, it, expect } from 'vitest'
import { calDisplayName } from './calDisplayName'

describe('calDisplayName', () => {
  it('默认 Calendar 加 Vault 后缀', () => {
    expect(calDisplayName('Calendar', '云端')).toBe('Calendar · 云端')
    expect(calDisplayName('Calendar', 'MyVault')).toBe('Calendar · MyVault')
  })
  it('非默认名保留原名', () => {
    expect(calDisplayName('Work', '云端')).toBe('Work')
    expect(calDisplayName('日程', 'MyVault')).toBe('日程')
  })
  it('无 Vault 标签不加后缀', () => {
    expect(calDisplayName('Calendar', '')).toBe('Calendar')
  })
})
