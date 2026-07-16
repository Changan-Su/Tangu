import { describe, expect, it } from 'vitest'
import { folderPadLeft, LEAD_GAP, LEAD_W, nameLeft, rowPadLeft, TOGGLE_PAD } from './treeIndent'

describe('树缩进', () => {
  it('笔记行:每层 +10.5', () => {
    expect(rowPadLeft(0)).toBe(14)
    expect(rowPadLeft(1)).toBe(24.5)
    expect(rowPadLeft(3)).toBe(45.5)
  })
  it('⚠️同层的文件夹行与笔记行,前导槽落在同一竖线(= 用户要的「所有图标左对齐」)', () => {
    // 文件夹槽的实际左边缘 = 外层 padding + toggle 自带内边距;笔记槽 = 行 padding。两者必须相等。
    for (const depth of [0, 1, 2, 5]) {
      expect(folderPadLeft(depth) + TOGGLE_PAD).toBe(rowPadLeft(depth))
    }
  })
  it('文件夹行 depth 0 也有正左内边距(别退化成贴边)', () => {
    expect(folderPadLeft(0)).toBe(9.5)
  })
  it('⚠️三个 view 同一范式:组头 depth 0、组内行 depth 1 —— 会话/文件/笔记的组内行必须同一竖线', () => {
    // 组头槽 = folderPadLeft(0)+TOGGLE_PAD = 14;组内行槽 = rowPadLeft(1) = 24.5(= 14 + 一级缩进)
    expect(folderPadLeft(0) + TOGGLE_PAD).toBe(14)
    expect(rowPadLeft(1)).toBe(24.5)
    expect(rowPadLeft(1) - (folderPadLeft(0) + TOGGLE_PAD)).toBe(10.5) // 恰好一级缩进
  })
  it('nameLeft = 行左内边距 + 槽宽 + gap(给没有槽、但要与名字对齐的元素:重命名框/载入中)', () => {
    expect(nameLeft(0)).toBe(rowPadLeft(0) + LEAD_W + LEAD_GAP)
    expect(nameLeft(1)).toBeCloseTo(48.4, 5)
  })
})
