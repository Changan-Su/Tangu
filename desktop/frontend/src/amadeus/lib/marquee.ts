/** 框选(rubber-band)命中判定:纯几何,单测在 marquee.test.ts。 */
export type MarqueeRect = { x: number; y: number; w: number; h: number }
export type ElBox = { left: number; top: number; right: number; bottom: number }

/** 框选矩形与元素 AABB 是否相交(仅贴边=0 重叠不算命中,避免蹭到就选中)。 */
export function marqueeHits(rect: MarqueeRect, box: ElBox): boolean {
  return (
    rect.x < box.right &&
    rect.x + rect.w > box.left &&
    rect.y < box.bottom &&
    rect.y + rect.h > box.top
  )
}
