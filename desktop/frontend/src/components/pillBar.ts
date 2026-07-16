/** pill 选择条的翻页数学(纯函数,便于单测;组件在 EnginePicker.tsx)。 */

export interface PillView {
  /** 当前 scrollLeft */
  left: number
  /** 可视宽(clientWidth) */
  width: number
  /** 内容总宽(scrollWidth) */
  content: number
}
/** 每个 pill 相对内容起点的左右边缘。 */
export interface PillEdge {
  start: number
  end: number
}

/**
 * 点「⋯」后的落点 scrollLeft。
 * 规则(用户拍板):按 pill 边界对齐(不把 pill 切一半);**已在末页 → 回 0(循环)**,故一直点 = 一直转。
 */
export function nextPageLeft(view: PillView, pills: PillEdge[]): number {
  const max = Math.max(0, view.content - view.width)
  if (view.left >= max - 1) return 0 // 末页 → 循环回第一页
  const right = view.left + view.width
  // 第一个没被完整露出的 pill = 下一页的页首
  const next = pills.find((p) => p.end > right + 1)
  const target = next ? Math.min(next.start, max) : max
  // ponytail: 单个 pill 比视口还宽时 target 会不动甚至倒退 → 退化成整屏翻,保证每次点击都有进展
  return target > view.left + 1 ? target : Math.min(right, max)
}

/** 内容溢出(= 该显示「⋯」)。留 1px 容差:pill 宽度是小数,scrollWidth 会有取整误差。 */
export function isOverflowing(scrollWidth: number, clientWidth: number): boolean {
  return scrollWidth - clientWidth > 1
}
