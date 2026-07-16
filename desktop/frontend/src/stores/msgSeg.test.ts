import { describe, it, expect } from 'vitest'
import { pushTextSeg, pushToolSeg } from './appStore'

// Item 3 直播穿插的核心:文字/工具按发生顺序成段,连续工具并块,文字介入即分块。
describe('msg segments (interleave + consecutive grouping)', () => {
  it('preserves order and merges consecutive same-kind segments', () => {
    let segs = pushTextSeg(undefined, 'hi ')
    segs = pushTextSeg(segs, 'there')              // 文字并入同段
    segs = pushToolSeg(segs, 't1')
    segs = pushToolSeg(segs, 't2')                 // 连续工具并入同块
    segs = pushTextSeg(segs, 'done')               // 文字介入 → 新段
    segs = pushToolSeg(segs, 't3')                 // 又一独立工具块
    expect(segs).toEqual([
      { t: 'text', text: 'hi there' },
      { t: 'tools', ids: ['t1', 't2'] },
      { t: 'text', text: 'done' },
      { t: 'tools', ids: ['t3'] },
    ])
  })

  it('empty text delta is a no-op (no phantom text segment)', () => {
    expect(pushTextSeg([{ t: 'tools', ids: ['t1'] }], '')).toEqual([{ t: 'tools', ids: ['t1'] }])
  })
})
