/**
 * 选区几何:把窗口文本选区换算成各页 PDF 用户空间的 QuadPoints(下划线/波浪线/删除线用),
 * 以及「点击点→页内 PDF 坐标」(便签用)。
 *
 * ⚠️参考系必须用页内容盒(textLayer / canvasWrapper),不能用 .page div——
 *   pdf_viewer.css 给 .page 画了 9px 透明边框,直接用 page div 会整体偏 9px。
 * 旋转页依赖 viewport.convertToPdfPoint(带逆变换),再取 min/max 回轴对齐。
 */
import type { PageQuads } from './pdfMarkup'

interface Box { left: number; top: number; right: number; bottom: number }

/** 同一行内的选区碎块合并:行判定=垂直中心落在对方高度带内;水平间隙 < 行高(≈1em)才并,
 *  这样词间空隙连成整条线,而多栏间距(通常 > 1em)不会被误连。导出供单测。 */
export function mergeLineRects(rects: Box[]): Box[] {
  const lines: { top: number; bottom: number; segs: { left: number; right: number }[] }[] = []
  const sorted = [...rects].sort((a, b) => a.top - b.top || a.left - b.left)
  for (const r of sorted) {
    const cy = (r.top + r.bottom) / 2
    let line = lines.find((l) => cy > l.top && cy < l.bottom)
    if (!line) {
      line = { top: r.top, bottom: r.bottom, segs: [] }
      lines.push(line)
    } else {
      line.top = Math.min(line.top, r.top)
      line.bottom = Math.max(line.bottom, r.bottom)
    }
    const h = r.bottom - r.top
    const seg = line.segs.find((s) => r.left < s.right + h && r.right > s.left - h)
    if (seg) {
      seg.left = Math.min(seg.left, r.left)
      seg.right = Math.max(seg.right, r.right)
    } else {
      line.segs.push({ left: r.left, right: r.right })
    }
  }
  return lines.flatMap((l) => l.segs.map((s) => ({ left: s.left, top: l.top, right: s.right, bottom: l.bottom })))
}

/** 页内容盒(选区/点击/手写坐标的参考系);页未渲染时返回 null(跳过)。 */
export const frameOf = (pv: any): DOMRect | null => {
  const el: HTMLElement | null = pv?.textLayer?.div ?? pv?.div?.querySelector('.canvasWrapper') ?? null
  return el ? el.getBoundingClientRect() : null
}

/** 一条客户区矩形 → PDF 用户空间 quad [x1,y1(左上), x2,y2(右上), x3,y3(左下), x4,y4(右下)]。 */
const rectToQuad = (viewport: any, frame: DOMRect, r: Box): number[] => {
  const [ax, ay] = viewport.convertToPdfPoint(r.left - frame.left, r.top - frame.top)
  const [bx, by] = viewport.convertToPdfPoint(r.right - frame.left, r.bottom - frame.top)
  const xL = Math.min(ax, bx), xR = Math.max(ax, bx)
  const yT = Math.max(ay, by), yB = Math.min(ay, by)
  return [xL, yT, xR, yT, xL, yB, xR, yB]
}

/** 当前 window 选区 → 各页 QuadPoints。无选区/选区不在页面上 → []。 */
export function selectionToQuads(viewer: any): PageQuads[] {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return []
  const rects: Box[] = []
  for (let i = 0; i < sel.rangeCount; i++) {
    for (const r of Array.from(sel.getRangeAt(i).getClientRects())) {
      if (r.width >= 1 && r.height >= 1) rects.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })
    }
  }
  if (!rects.length) return []

  const out: PageQuads[] = []
  for (let p = 0; p < (viewer.pagesCount ?? 0); p++) {
    const pv = viewer.getPageView(p)
    const frame = frameOf(pv)
    if (!frame) continue
    const inPage = rects.filter((r) => {
      const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2
      return cx >= frame.left && cx <= frame.right && cy >= frame.top && cy <= frame.bottom
    })
    if (!inPage.length) continue
    const quads = mergeLineRects(inPage).map((r) => rectToQuad(pv.viewport, frame, r))
    out.push({ pageIndex: p, quads })
  }
  return out
}

/** 点击点落在哪页 + 页内 PDF 坐标(便签放置)。 */
export function pageAt(viewer: any, clientX: number, clientY: number): { pageIndex: number; x: number; y: number } | null {
  for (let p = 0; p < (viewer.pagesCount ?? 0); p++) {
    const pv = viewer.getPageView(p)
    const frame = frameOf(pv)
    if (!frame) continue
    if (clientX >= frame.left && clientX <= frame.right && clientY >= frame.top && clientY <= frame.bottom) {
      const [x, y] = pv.viewport.convertToPdfPoint(clientX - frame.left, clientY - frame.top)
      return { pageIndex: p, x, y }
    }
  }
  return null
}

/** 客户区点 → **指定页**的 PDF 坐标(不做命中测试,页外也钳进页内)。
 *  形状拖拽必须用它:起止点锁在同一页,否则拖出页边界时终点会落到别页/丢失。 */
export function pointOnPage(viewer: any, pageIndex: number, clientX: number, clientY: number): [number, number] | null {
  const pv = viewer.getPageView(pageIndex)
  const frame = frameOf(pv)
  if (!frame) return null
  const cx = Math.min(frame.right, Math.max(frame.left, clientX))
  const cy = Math.min(frame.bottom, Math.max(frame.top, clientY))
  const [x, y] = pv.viewport.convertToPdfPoint(cx - frame.left, cy - frame.top)
  return [x, y]
}

