import { describe, expect, it } from 'vitest'
import { planSessionOpen } from './sessionOpenPlan'

describe('planSessionOpen', () => {
  it('主区无 leaf → fresh(兜底新建)', () => {
    expect(planSessionOpen(null)).toBe('fresh')
  })
  it('焦点=跟随主聊天 → follow(只切 activeId)', () => {
    expect(planSessionOpen({ type: 'chat', followActive: true })).toBe('follow')
    expect(planSessionOpen({ type: 'chat' })).toBe('follow') // followActive 缺省视为 true
  })
  it('焦点=固定会话聊天 → pin(就地改会话,勿被跟随引擎回拽)', () => {
    expect(planSessionOpen({ type: 'chat', followActive: false })).toBe('pin')
  })
  it('焦点=空白新标签 / 笔记 / 其它 → pin(就地固定为该会话)', () => {
    expect(planSessionOpen({ type: 'launcher' })).toBe('pin')
    expect(planSessionOpen({ type: 'home' })).toBe('pin')
    expect(planSessionOpen({ type: 'amadeus-editor' })).toBe('pin')
  })
})
