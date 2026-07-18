/** 侧栏「本次布局变更是否算用户拖宽、该记住宽度」的纯判定 —— 单独成文件以便单测
 *  (captureSideWidths 依赖 dockview/DOM/zustand,测试里进不去;同 sideWidth.ts 先例)。 */

export interface RecordDecisionInput {
  /** 实测组宽(px)。 */
  measured: number
  /** 当前目标宽(computeSideWidth 算出的黄金分割/记忆宽)。 */
  target: number
  /** 已记住的宽;null = 该侧还没记过。 */
  prev: number | null
  /** 是否正处于 pinSides 的延迟钉宽窗口 —— 此窗口内的宽是系统过渡态,绝不能当用户拖宽记下。 */
  pinPending: boolean
}

/** 该不该把这次实测宽记为「用户拖出来的、要持久」的宽度。true = 记。 */
export function shouldRecordSideWidth({ measured, target, prev, pinPending }: RecordDecisionInput): boolean {
  // pinSides 挂起期:build/切 Space/resize 后侧栏可能瞬时停在 dockview 默认 ~50% 宽,钉宽还没落地。
  // 这一窗口内的宽是系统态、不是用户拖的 —— 记下就会污染 localStorage,并被下次 pinSides 当「记忆」
  // 从脏值算、被 2px 容差焊死在错宽(= 侧栏抽风根因 R1)。故 pin 期一律不记。
  if (pinPending) return false
  // 过窄(收起补间的中间值等)不记。
  if (measured < 120) return false
  // 宽 ≈ 当前目标宽 = 系统钉的、不是用户拖动 → 不记(否则默认宽被记死,窗口变宽后不再自适应黄金分割)。
  if (Math.abs(measured - target) <= 2) return false
  // 与已记值几乎相同则不重复写。
  return prev == null || Math.abs(prev - measured) > 2
}
