import { describe, expect, it } from 'vitest'
import { matchTrigger } from './blockTriggers'

describe('matchTrigger(光标前文本 → 块触发)', () => {
  it('标题 1-6 级;7 个 # 不触发', () => {
    expect(matchTrigger('#')).toEqual({ kind: 'heading', level: 1 })
    expect(matchTrigger('##')).toEqual({ kind: 'heading', level: 2 })
    expect(matchTrigger('######')).toEqual({ kind: 'heading', level: 6 })
    expect(matchTrigger('#######')).toBeNull()
  })
  it('列表/有序/待办/引用', () => {
    expect(matchTrigger('-')).toEqual({ kind: 'bullet' })
    expect(matchTrigger('*')).toEqual({ kind: 'bullet' })
    expect(matchTrigger('+')).toEqual({ kind: 'bullet' })
    expect(matchTrigger('3.')).toEqual({ kind: 'ordered', order: 3 })
    expect(matchTrigger('[]')).toEqual({ kind: 'task', checked: false })
    expect(matchTrigger('[ ]')).toEqual({ kind: 'task', checked: false })
    expect(matchTrigger('[x]')).toEqual({ kind: 'task', checked: true })
    expect(matchTrigger('[X]')).toEqual({ kind: 'task', checked: true })
    expect(matchTrigger('>')).toEqual({ kind: 'quote' })
  })
  it('nbsp 空格("[ ]" 在 contenteditable 里的真实形态)也识别', () => {
    expect(matchTrigger('[ ]')).toEqual({ kind: 'task', checked: false })
  })
  it('非行首触发符/夹杂内容一律不触发', () => {
    expect(matchTrigger('a#')).toBeNull()
    expect(matchTrigger('# x')).toBeNull()
    expect(matchTrigger('')).toBeNull()
    expect(matchTrigger('1')).toBeNull()
    expect(matchTrigger('[y]')).toBeNull()
  })
})
