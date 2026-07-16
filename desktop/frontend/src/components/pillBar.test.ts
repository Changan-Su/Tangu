import { describe, expect, it } from 'vitest'
import { isOverflowing, nextPageLeft } from './pillBar'

/** 8 个 40px pill + 4px gap → 内容 348,视口 100(放得下 2 个),max scrollLeft = 248。 */
const pills = [0, 44, 88, 132, 176, 220, 264, 308].map((start) => ({ start, end: start + 40 }))
const CONTENT = 348
const view = (left: number, width = 100): { left: number; width: number; content: number } => ({ left, width, content: CONTENT })

describe('nextPageLeft', () => {
  // 连点一轮:0 → 88 → 176 → 248(末页) → 0,每步都落在 pill 左边缘上。
  it('第一页 → 对齐到第一个没完整露出的 pill 的左边缘(不切一半)', () => {
    // 视口 [0,100):#0 #1 完整,#2 从 88 起被切 → 落到 88
    expect(nextPageLeft(view(0), pills)).toBe(88)
  })
  it('中间页 → 继续按 pill 边界前进', () => {
    // 视口 [88,188):#2 #3 完整,#4 从 176 起被切 → 落到 176
    expect(nextPageLeft(view(88), pills)).toBe(176)
  })
  it('落点超过最大 scrollLeft → clamp 到末页(不越过内容尾留空白)', () => {
    // 视口 [176,276):#6 被切,其 start=264 > max=248 → clamp 到 248
    expect(nextPageLeft(view(176), pills)).toBe(248)
  })
  it('⚠️末页再点 → 回 0(循环,用户拍板:一直点 = 一直转,不卡死)', () => {
    expect(nextPageLeft(view(248), pills)).toBe(0)
  })
  it('内容不溢出 → 0(无页可翻)', () => {
    expect(nextPageLeft(view(0, 400), pills)).toBe(0)
  })
  it('⚠️单个 pill 比视口还宽 → 整屏翻(既不倒退也不原地卡住)', () => {
    const wide = [{ start: 0, end: 500 }]
    // 视口 [30,80):唯一 pill 的 start(0) < left → 不能落回 0,退化成整屏翻 = 80
    expect(nextPageLeft({ left: 30, width: 50, content: 500 }, wide)).toBe(80)
  })
})

describe('isOverflowing', () => {
  it('留 1px 容差(pill 是小数宽,scrollWidth 取整会虚报 1px)', () => {
    expect(isOverflowing(101, 100)).toBe(false)
    expect(isOverflowing(102, 100)).toBe(true)
    expect(isOverflowing(100, 100)).toBe(false)
  })
})
