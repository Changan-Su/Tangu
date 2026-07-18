import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useWorkspace, captureSideWidths } from './dockviewStore'
import { computeSideWidth } from './sideWidth'
import type { DockviewApi } from 'dockview-react'

/** 最小 dockview api 桩:两侧各一 panel(带 __loc),group.api 有可读写的 width + setSize。 */
function mkApi(width: number) {
  const mk = (loc: 'left' | 'right') => ({
    params: { __loc: loc },
    group: { api: { width: 0, setSize(s: { width: number }) { this.width = s.width } } },
  })
  const panels = [mk('left'), mk('right')]
  return { api: { width, panels } as unknown as DockviewApi, panels }
}
const groupW = (p: { group: { api: { width: number } } }): number => p.group.api.width
const setGroupW = (p: { group: { api: { width: number } } }, w: number): void => { p.group.api.width = w }

beforeEach(() => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => store.clear(),
  })
  vi.useFakeTimers() // pinSides 的 setTimeout(60) 手动推进;node 无 requestAnimationFrame → rAF 兜底为同步
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('pinSides / repinSides / captureSideWidths(抽风集成:R1 + R3)', () => {
  it('R3:repinSides 按当前容器宽把 pinned 两侧钉回黄金分割', () => {
    const { api, panels } = mkApi(1600)
    useWorkspace.getState().setApi(api)
    useWorkspace.getState().setSideProfile('sp', {}, {}) // 两侧 pinned(非 free)
    useWorkspace.getState().repinSides()
    // rAF 兜底同步 → apply 已执行
    expect(groupW(panels[0])).toBe(computeSideWidth(1600, 'left', { free: false, saved: null })) // 280(钳 max)
    expect(groupW(panels[1])).toBe(computeSideWidth(1600, 'right', { free: false, saved: null })) // 300(钳 max)
    vi.runAllTimers()
  })

  it('R1:pin 窗口内 captureSideWidths 不记宽(过渡态不污染);窗口关闭后真拖宽才记', () => {
    const { api, panels } = mkApi(1600)
    useWorkspace.getState().setApi(api)
    useWorkspace.getState().setSideProfile('sp', { left: true }, {}) // 左 free(可记宽)
    useWorkspace.getState().repinSides() // pinPending=true(setTimeout 未触发)
    // 模拟 dockview 把左组瞬时铺到 ~50%(800),钉宽尚未最终落地
    setGroupW(panels[0], 800)
    captureSideWidths(api)
    expect(localStorage.getItem('lcl.sideWidth2.sp')).toBeNull() // pin 期:绝不污染(旧代码会记 800)

    vi.runAllTimers() // pin 窗口关闭(pinPending=false)
    setGroupW(panels[0], 460) // 用户真拖到 460
    captureSideWidths(api)
    expect(JSON.parse(localStorage.getItem('lcl.sideWidth2.sp')!).left).toBe(460) // 真拖宽才记
  })
})
