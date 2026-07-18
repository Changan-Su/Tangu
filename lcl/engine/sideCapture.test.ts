import { describe, it, expect } from 'vitest'
import { shouldRecordSideWidth } from './sideCapture'

/** 复刻「修复前」的判定(无 pinPending 守卫)—— 用来在测试里坐实 R1 抽风确实发生。 */
function oldShouldRecord(measured: number, target: number, prev: number | null): boolean {
  if (measured < 120) return false
  if (Math.abs(measured - target) <= 2) return false
  return prev == null || Math.abs(prev - measured) > 2
}

describe('shouldRecordSideWidth', () => {
  // R1 抽风复现:pinSides 延迟落地前,侧栏瞬时停在 dockview 默认 ~50%(1600 容器 → 800),
  // 目标黄金分割宽 280。旧逻辑把 800 当「用户拖宽」记下 → 下次 pinSides 从脏值算 → 焊死错宽。
  it('⚠️回归:pin 挂起窗口内的过渡宽绝不记录(旧逻辑会污染,这是抽风根因)', () => {
    expect(oldShouldRecord(800, 280, null)).toBe(true) // 红:旧逻辑污染(bug 实证)
    expect(shouldRecordSideWidth({ measured: 800, target: 280, prev: null, pinPending: true })).toBe(false) // 绿:守住
  })

  it('非 pin 期、真·用户拖宽 → 记录', () => {
    expect(shouldRecordSideWidth({ measured: 800, target: 280, prev: null, pinPending: false })).toBe(true)
  })

  it('宽 ≈ 目标(系统钉的)→ 不记', () => {
    expect(shouldRecordSideWidth({ measured: 281, target: 280, prev: null, pinPending: false })).toBe(false)
  })

  it('过窄(<120,收起补间中间值)→ 不记', () => {
    expect(shouldRecordSideWidth({ measured: 50, target: 280, prev: null, pinPending: false })).toBe(false)
  })

  it('与已记值差 ≤2 → 不重复写;差 >2 → 记新值', () => {
    expect(shouldRecordSideWidth({ measured: 419, target: 280, prev: 420, pinPending: false })).toBe(false)
    expect(shouldRecordSideWidth({ measured: 500, target: 280, prev: 420, pinPending: false })).toBe(true)
  })
})
