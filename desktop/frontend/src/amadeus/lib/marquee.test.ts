import { describe, expect, it } from 'vitest'
import { marqueeHits } from './marquee'

describe('marqueeHits', () => {
  const box = { left: 100, top: 100, right: 200, bottom: 140 }
  it('命中相交的块', () => {
    expect(marqueeHits({ x: 0, y: 0, w: 150, h: 150 }, box)).toBe(true) // 覆盖左上角
    expect(marqueeHits({ x: 120, y: 0, w: 10, h: 300 }, box)).toBe(true) // 竖直细条穿过
    expect(marqueeHits({ x: 150, y: 110, w: 5, h: 5 }, box)).toBe(true) // 完全在内
  })
  it('不命中框外的块', () => {
    expect(marqueeHits({ x: 0, y: 0, w: 50, h: 50 }, box)).toBe(false) // 左上方
    expect(marqueeHits({ x: 210, y: 100, w: 20, h: 20 }, box)).toBe(false) // 右侧
    expect(marqueeHits({ x: 0, y: 200, w: 300, h: 20 }, box)).toBe(false) // 下方
  })
  it('仅贴边(0 重叠)不算命中', () => {
    expect(marqueeHits({ x: 0, y: 0, w: 100, h: 100 }, box)).toBe(false) // 右下角恰贴左上角
  })
})
