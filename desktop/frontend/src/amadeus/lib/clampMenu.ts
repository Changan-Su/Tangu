// 光标菜单/上下文菜单的视口夹取:优先落在锚点 (x,y),溢出则左移/上移收进视口,
// 永不越过左/上边距。纵向溢出→上移,让下方选项可见;横向溢出→收进屏幕内(用户要求)。

import { useLayoutEffect, useRef, useState, type CSSProperties, type DependencyList, type RefObject } from 'react'

export function clampMenu(
  x: number,
  y: number,
  w: number,
  h: number,
  vw: number,
  vh: number,
  margin = 8,
): { left: number; top: number } {
  return {
    left: Math.max(margin, Math.min(x, vw - w - margin)),
    top: Math.max(margin, Math.min(y, vh - h - margin)),
  }
}

/** 挂在 fixed 菜单根上:量真实尺寸(offsetWidth/Height 不含 pop-in scale),useLayoutEffect
 *  在绘制前把位置夹进视口,故无闪。菜单未挂载(ref 空)时保持锚点位,挂载即校正。 */
export function useClampedMenu(
  x: number,
  y: number,
  deps: DependencyList = [],
): { ref: RefObject<HTMLDivElement | null>; style: CSSProperties } {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const apply = (): void =>
      setPos(clampMenu(x, y, el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight))
    apply()
    window.addEventListener('resize', apply) // 开着菜单缩窗口时重夹,防跑出屏
    return () => window.removeEventListener('resize', apply)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y, ...deps])
  return { ref, style: { left: pos.left, top: pos.top } }
}
