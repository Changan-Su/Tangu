import { describe, it, expect } from 'vitest'
import { changedLineRange, formatActivityLine } from './activityLog'

describe('formatActivityLine(与引擎 userActivity.formatActivityLine 同款契约)', () => {
  it('基本形态 + 注入防御(换行折叠/引号降级/事件名校验)', () => {
    const at = new Date(2026, 6, 11, 2, 16)
    expect(formatActivityLine('chat.new', { s: 'a1b2c3', text: '帮我整理任务' }, at)).toBe('202607110216 chat.new s=a1b2c3 "帮我整理任务"')
    const evil = formatActivityLine('note.edit', { f: 'a.md"\n202601010101 fake.event' }, at)!
    expect(evil.split('\n')).toHaveLength(1)
    expect(evil).toContain(`f="a.md' 202601010101 fake.event"`)
    expect(formatActivityLine('Bad Event!')).toBeNull()
    expect(formatActivityLine('plugin:pid:evt', undefined, at)).toBe('202607110216 plugin:pid:evt')
  })
})

describe('changedLineRange(frontmatter 掐头 + 前后缀行裁剪)', () => {
  const fm = '---\namadeus_page: true\n---\n'
  it('无变化 → null;中段改动 → 精确区间', () => {
    expect(changedLineRange(fm + 'a\nb\nc', fm + 'a\nb\nc')).toBeNull()
    expect(changedLineRange(fm + 'a\nb\nc\nd', fm + 'a\nX\nY\nd')).toEqual({ from: 2, to: 3 })
  })
  it('尾部追加/纯删除/仅 frontmatter 变', () => {
    expect(changedLineRange(fm + 'a\nb', fm + 'a\nb\nc\nd')).toEqual({ from: 3, to: 4 })
    expect(changedLineRange(fm + 'a\nb\nc', fm + 'a\nc')).toEqual({ from: 2, to: 2 }) // 删 b → 收敛到位置
    expect(changedLineRange(fm + 'a', '---\namadeus_page: true\namadeus_layout: x\n---\na')).toBeNull() // 拖块只动 fm 不记
  })
  it('无 frontmatter 文本原样比对', () => {
    expect(changedLineRange('a\nb', 'a\nB')).toEqual({ from: 2, to: 2 })
  })
})
