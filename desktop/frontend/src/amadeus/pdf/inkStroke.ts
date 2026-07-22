/**
 * 手写笔画几何:**逐字照搬 Excalidraw 的 freedraw 实现**(MIT,renderElement.ts 的
 * getFreeDrawSvgPath / getSvgPathFromStroke)——perfect-freehand 出轮廓多边形,再串成
 * 「M p0 Q(控制点=轮廓点,终点=相邻中点)… L p0 Z」的闭合二次样条,按笔色**填充**。
 * 参数(size=strokeWidth*4.25 / thinning .6 / smoothing .5 / streamline .5 / sin 缓动)
 * 一个都不能改,改了手感就不是 Excalidraw 了。
 *
 * 两个出口:SVG path d(书写时的实时预览层)、PDF 内容流 ops(写进 /Ink 注释的 /AP)。
 * PDF 没有二次贝塞尔算子 → 二次转三次(c1=s+2/3(q-s), c2=e+2/3(q-e)),几何完全等价。
 */
import { getStroke } from 'perfect-freehand'

/** 输入点 [x, y, pressure]。坐标单位任意(预览用 px、写入用 PDF pt),算法尺度协变。 */
export type InkPoints = number[][]

/** Excalidraw 手感的轮廓多边形。simulate=鼠标/触摸(压感由速度模拟);last=笔画已收尾(闭合笔锋)。 */
export function strokeOutline(pts: InkPoints, width: number, simulate: boolean, last = true): number[][] {
  return getStroke(pts, {
    simulatePressure: simulate,
    size: width * 4.25,
    thinning: 0.6,
    smoothing: 0.5,
    streamline: 0.5,
    easing: (t) => Math.sin((t * Math.PI) / 2),
    last,
  })
}

const avg = (a: number[], b: number[]): number[] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]

/** 轮廓 → SVG path d(Excalidraw getSvgPathFromStroke 同构,供预览 <path> 填充)。 */
export function outlineToSvgPath(outline: number[][]): string {
  if (outline.length < 3) return ''
  const last = outline.length - 1
  const parts: string[] = [`M ${outline[0][0]} ${outline[0][1]}`]
  for (let i = 0; i < outline.length; i++) {
    const q = outline[i]
    const e = i === last ? avg(q, outline[0]) : avg(q, outline[i + 1])
    parts.push(`Q ${q[0]} ${q[1]} ${e[0]} ${e[1]}`)
  }
  parts.push(`L ${outline[0][0]} ${outline[0][1]} Z`)
  return parts.join(' ')
}

/** 点到线段距离平方(橡皮命中测试核心)。 */
const distSqPtSeg = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax, dy = by - ay
  const len = dx * dx + dy * dy
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0
  const qx = ax + t * dx - px, qy = ay + t * dy - py
  return qx * qx + qy * qy
}

/** 点到折线距离平方。pts=[x,y,…][](手写笔画的采点)。 */
export function distToPointsSq(p: readonly [number, number], pts: readonly number[][]): number {
  if (!pts.length) return Infinity
  if (pts.length === 1) return distSqPtSeg(p[0], p[1], pts[0][0], pts[0][1], pts[0][0], pts[0][1])
  let best = Infinity
  for (let i = 1; i < pts.length; i++) {
    const d = distSqPtSeg(p[0], p[1], pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1])
    if (d < best) best = d
  }
  return best
}

/** 点到折线距离平方。flat=[x1,y1,x2,y2,…](PDF /InkList 的形态)。 */
export function distToFlatSq(p: readonly [number, number], flat: ArrayLike<number>): number {
  if (flat.length < 2) return Infinity
  if (flat.length < 4) return distSqPtSeg(p[0], p[1], flat[0], flat[1], flat[0], flat[1])
  let best = Infinity
  for (let i = 3; i < flat.length; i += 2) {
    const d = distSqPtSeg(p[0], p[1], flat[i - 3], flat[i - 2], flat[i - 1], flat[i])
    if (d < best) best = d
  }
  return best
}

const n4 = (x: number): string => x.toFixed(4)

/** 轮廓 → PDF 路径算子(m/c/l/h,未含颜色与 f)+ 包围盒。轮廓退化(<3 点)返回 null。
 *  二次样条的控制点全是轮廓点/中点 → 曲线不出其凸包,min/max 即安全包围盒。 */
export function outlineToPdfPath(outline: number[][]): { path: string; bbox: [number, number, number, number] } | null {
  if (outline.length < 3) return null
  const lastI = outline.length - 1
  let s = outline[0]
  let path = `${n4(s[0])} ${n4(s[1])} m\n`
  for (let i = 0; i < outline.length; i++) {
    const q = outline[i]
    const e = i === lastI ? avg(q, outline[0]) : avg(q, outline[i + 1])
    const c1x = s[0] + (2 / 3) * (q[0] - s[0]), c1y = s[1] + (2 / 3) * (q[1] - s[1])
    const c2x = e[0] + (2 / 3) * (q[0] - e[0]), c2y = e[1] + (2 / 3) * (q[1] - e[1])
    path += `${n4(c1x)} ${n4(c1y)} ${n4(c2x)} ${n4(c2y)} ${n4(e[0])} ${n4(e[1])} c\n`
    s = e
  }
  path += `${n4(outline[0][0])} ${n4(outline[0][1])} l h\n`
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of outline) {
    if (x < x0) x0 = x
    if (y < y0) y0 = y
    if (x > x1) x1 = x
    if (y > y1) y1 = y
  }
  return { path, bbox: [x0, y0, x1, y1] }
}
