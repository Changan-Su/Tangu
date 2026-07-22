/**
 * pdf-lib 写入层:pdf.js 编辑器只管 高亮/添加文字,下划线/波浪线/删除线/便签/书签(大纲)/形状/手写(Ink)
 * 这几类得自己往 PDF 里写原生对象。全部是 bytes→bytes 纯函数,由 PdfAnnotator 的串行写队列调用
 * (写完必须重载 viewer 文档,否则 pdf.js 下次 saveDocument 会基于旧字节丢掉这里写的内容)。
 *
 * 文本标记(下划线族)不写 /AP:pdf.js / PDFium / Acrobat / 预览 都会为其自动生成外观。
 * **形状必须写 /AP**:PDFium(Chrome 内置阅读器)只为 Square/Circle 生成外观,Line 不管 → 不写就看不见。
 * 加密 PDF:PDFDocument.load 直接抛错 → 上层提示不支持写入。
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString } from 'pdf-lib'
import { outlineToPdfPath, strokeOutline } from './inkStroke'

export type MarkupKind = 'underline' | 'squiggly' | 'strikeout'
export type ShapeKind = 'rect' | 'circle' | 'line' | 'arrow'
/** 一笔手写:pts=[x,y,pressure][](PDF 用户空间);simulate=非笔设备(压感按速度模拟)。 */
export interface InkStroke { pageIndex: number; pts: number[][]; simulate: boolean; color: string; width: number; opacity: number }
/** 每条 quad = [x1,y1(左上), x2,y2(右上), x3,y3(左下), x4,y4(右下)],PDF 用户空间(y 向上)。 */
export interface PageQuads { pageIndex: number; quads: number[][] }
/** 形状样式:描边色/填充色(null=不填充)/线宽 pt/不透明度 0-1。 */
export interface ShapeStyle { stroke: string; fill: string | null; width: number; opacity: number }

const SUBTYPE: Record<MarkupKind, string> = { underline: 'Underline', squiggly: 'Squiggly', strikeout: 'StrikeOut' }

const hexToRgb = (hex: string): number[] => {
  const n = parseInt(hex.replace('#', ''), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

const pdfDate = (): string => {
  const d = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  return `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

let seq = 0
const freshNM = (): string => `forsion-${Date.now().toString(36)}-${++seq}`

const load = (bytes: Uint8Array): Promise<PDFDocument> => PDFDocument.load(bytes, { updateMetadata: false })
const save = (doc: PDFDocument): Promise<Uint8Array> => doc.save({ useObjectStreams: false })

/** 注册注释对象并挂到页 /Annots(共有键 Type/P/M/NM/F 在此统一补)。 */
function addAnnot(doc: PDFDocument, pageIndex: number, entries: Record<string, unknown>): void {
  const page = doc.getPage(pageIndex)
  const dict = doc.context.obj({
    Type: 'Annot', P: page.ref, F: 4,
    M: PDFString.of(pdfDate()), NM: PDFString.of(freshNM()),
    ...entries,
  })
  const ref = doc.context.register(dict)
  const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
  if (annots) annots.push(ref)
  else page.node.set(PDFName.of('Annots'), doc.context.obj([ref]))
}

/** 文本标记注释:下划线 / 波浪线 / 删除线(每页一条注释,多行选区=多组 QuadPoints)。 */
export async function addTextMarkup(bytes: Uint8Array, kind: MarkupKind, colorHex: string, marks: PageQuads[]): Promise<Uint8Array> {
  const doc = await load(bytes)
  const color = hexToRgb(colorHex)
  for (const { pageIndex, quads } of marks) {
    if (!quads.length) continue
    const flat = quads.flat()
    const xs = flat.filter((_, i) => i % 2 === 0)
    const ys = flat.filter((_, i) => i % 2 === 1)
    addAnnot(doc, pageIndex, {
      Subtype: SUBTYPE[kind],
      Rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      QuadPoints: flat,
      C: color,
      CA: 1,
    })
  }
  return save(doc)
}

/** 便签评论:/Text 注释(粘性便签,任何阅读器悬停/点击可看 Contents)。(x,y)=图标左上角。 */
export async function addNote(bytes: Uint8Array, pageIndex: number, x: number, y: number, text: string, colorHex: string): Promise<Uint8Array> {
  const doc = await load(bytes)
  addAnnot(doc, pageIndex, {
    Subtype: 'Text',
    Rect: [x, y - 20, x + 20, y],
    Contents: PDFHexString.fromText(text),
    Name: 'Comment',
    C: hexToRgb(colorHex),
    Open: false,
  })
  return save(doc)
}

/** 圆的四段贝塞尔逼近常数(控制点 = 半径 × K)。 */
const KAPPA = 0.5522847498

const n6 = (x: number): string => x.toFixed(6)

/** 生成形状的绘制指令 + 包围盒。坐标 = PDF 用户空间(y 向上)。 */
function shapeContent(kind: ShapeKind, a: [number, number], b: [number, number], s: ShapeStyle): { ops: string; bbox: number[] } {
  const [sr, sg, sb] = hexToRgb(s.stroke)
  let ops = `${n6(s.width)} w 1 J 1 j ${n6(sr)} ${n6(sg)} ${n6(sb)} RG\n`
  const filled = !!s.fill
  if (s.fill) {
    const [fr, fg, fb] = hexToRgb(s.fill)
    ops += `${n6(fr)} ${n6(fg)} ${n6(fb)} rg\n`
  }
  const paint = filled ? 'B' : 'S' // B=填充+描边;S=只描边
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0])
  const y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1])
  let pad = s.width // 包围盒要含线宽(否则描边被裁)

  if (kind === 'rect') {
    ops += `${n6(x0)} ${n6(y0)} ${n6(x1 - x0)} ${n6(y1 - y0)} re ${paint}\n`
  } else if (kind === 'circle') {
    // 内接椭圆:从右中点起,四段贝塞尔顺时针闭合。
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
    const rx = (x1 - x0) / 2, ry = (y1 - y0) / 2
    const ox = rx * KAPPA, oy = ry * KAPPA
    ops += `${n6(cx + rx)} ${n6(cy)} m\n`
    ops += `${n6(cx + rx)} ${n6(cy + oy)} ${n6(cx + ox)} ${n6(cy + ry)} ${n6(cx)} ${n6(cy + ry)} c\n`
    ops += `${n6(cx - ox)} ${n6(cy + ry)} ${n6(cx - rx)} ${n6(cy + oy)} ${n6(cx - rx)} ${n6(cy)} c\n`
    ops += `${n6(cx - rx)} ${n6(cy - oy)} ${n6(cx - ox)} ${n6(cy - ry)} ${n6(cx)} ${n6(cy - ry)} c\n`
    ops += `${n6(cx + ox)} ${n6(cy - ry)} ${n6(cx + rx)} ${n6(cy - oy)} ${n6(cx + rx)} ${n6(cy)} c\n`
    ops += `h ${paint}\n`
  } else {
    // 直线/箭头:用原始端点(非归一化包围盒),方向有意义。
    ops += `${n6(a[0])} ${n6(a[1])} m ${n6(b[0])} ${n6(b[1])} l S\n`
    if (kind === 'arrow') {
      const head = Math.max(6, s.width * 3.5)
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0])
      const wing = Math.PI / 7
      const p1: [number, number] = [b[0] - head * Math.cos(ang - wing), b[1] - head * Math.sin(ang - wing)]
      const p2: [number, number] = [b[0] - head * Math.cos(ang + wing), b[1] - head * Math.sin(ang + wing)]
      // 箭头实心三角:用描边色填充(fill 是形状内部色,与箭头无关)。
      ops += `${n6(sr)} ${n6(sg)} ${n6(sb)} rg\n`
      ops += `${n6(b[0])} ${n6(b[1])} m ${n6(p1[0])} ${n6(p1[1])} l ${n6(p2[0])} ${n6(p2[1])} l h f\n`
      pad += head
    }
  }
  return { ops, bbox: [x0 - pad, y0 - pad, x1 + pad, y1 + pad] }
}

/** 形状批注:矩形 /Square、圆 /Circle、直线与箭头 /Line。带 /AP 外观流(PDFium 不为 Line 生成外观)。 */
export async function addShape(bytes: Uint8Array, pageIndex: number, kind: ShapeKind, a: [number, number], b: [number, number], style: ShapeStyle): Promise<Uint8Array> {
  const doc = await load(bytes)
  const ctx = doc.context
  const { ops, bbox } = shapeContent(kind, a, b, style)
  // 外观流的坐标系与页面一致(无 /Matrix),故直接用页面坐标绘制、BBox 取同一区间。
  const ap = ctx.stream(ops, {
    Type: 'XObject', Subtype: 'Form', FormType: 1,
    BBox: bbox,
    Resources: ctx.obj({}),
  })
  const entries: Record<string, unknown> = {
    Subtype: kind === 'rect' ? 'Square' : kind === 'circle' ? 'Circle' : 'Line',
    Rect: bbox,
    C: hexToRgb(style.stroke),
    CA: style.opacity,
    BS: ctx.obj({ W: style.width, S: 'S' }),
    AP: ctx.obj({ N: ctx.register(ap) }),
  }
  if (style.fill) entries.IC = hexToRgb(style.fill) // 内部色(仅 Square/Circle 有意义)
  if (kind === 'line' || kind === 'arrow') {
    entries.L = [a[0], a[1], b[0], b[1]]
    if (kind === 'arrow') entries.LE = ['None', 'OpenArrow']
  }
  addAnnot(doc, pageIndex, entries)
  return save(doc)
}

/** 手写笔画 → 原生 /Ink 注释,**一笔一条**(橡皮按笔擦;曾按批合并,一擦连坐整批,已废)。
 *  外观流 = Excalidraw 同款填充轮廓(inkStroke.ts);/InkList 存原始笔迹中心线
 *  (互操作:其他编辑器按标准 Ink 认识/可删)。pdf.js 自带 INK 编辑器故意不用:等宽无压感。 */
export async function addInk(bytes: Uint8Array, strokes: InkStroke[]): Promise<Uint8Array> {
  const doc = await load(bytes)
  const ctx = doc.context
  for (const s of strokes) {
    const drawn = outlineToPdfPath(strokeOutline(s.pts, s.width, s.simulate))
    if (!drawn) continue
    const [r, g, b] = hexToRgb(s.color)
    // 不透明度必须以 ExtGState 写进外观流:带 /AP 的注释,pdf.js 等渲染器不会替你把 /CA 合成进去。
    const ops = `/GS0 gs\n${n6(r)} ${n6(g)} ${n6(b)} rg\n${drawn.path}f\n`
    const rect = [drawn.bbox[0] - 1, drawn.bbox[1] - 1, drawn.bbox[2] + 1, drawn.bbox[3] + 1]
    const ap = ctx.stream(ops, {
      Type: 'XObject', Subtype: 'Form', FormType: 1,
      BBox: rect,
      Resources: ctx.obj({ ExtGState: { GS0: { Type: 'ExtGState', ca: s.opacity, CA: s.opacity } } }),
    })
    addAnnot(doc, s.pageIndex, {
      Subtype: 'Ink',
      Rect: rect,
      InkList: [s.pts.flatMap(([x, y]) => [x, y])],
      C: hexToRgb(s.color),
      CA: s.opacity,
      BS: ctx.obj({ W: s.width, S: 'S' }),
      AP: ctx.obj({ N: ctx.register(ap) }),
    })
  }
  return save(doc)
}

/** pdf.js 的注释 id 就是 `ref.toString()`("12R" / "12R1")。 */
const refIdOf = (ref: PDFRef): string => `${ref.objectNumber}R${ref.generationNumber || ''}`

/** 允许 选中/删除/移动 的注释子类型(自家写的几类 + 通用手写)。链接等结构性注释永不碰。 */
export const EDITABLE_SUBTYPES: ReadonlySet<string> = new Set([
  'Ink', 'Square', 'Circle', 'Line', 'Underline', 'Squiggly', 'StrikeOut', 'Text', 'FreeText', 'Highlight',
])
/** 可拖拽移动的子类型:文本标记类(高亮/下划线族)钉在文字上,挪走没有意义,不给挪。 */
export const MOVABLE_SUBTYPES: ReadonlySet<string> = new Set(['Ink', 'Square', 'Circle', 'Line', 'Text', 'FreeText'])
/** 橡皮的白名单:几何命中之外的第二道防线,擦除通道永远只可能删手写。 */
export const INK_ONLY: ReadonlySet<string> = new Set(['Ink'])

/** 删除注释:按 id 从各页 /Annots 摘除,连同其孤儿 /Popup。only 限定子类型(缺省=全部可编辑类)。
 *  故意**不** context.delete:同一对象可能被别处引用(跨页 /Annots、Popup 的 /Parent),
 *  摘出 /Annots 即不可见,留个孤儿对象无害;删对象才会造出悬空引用。 */
export async function removeAnnots(bytes: Uint8Array, ids: string[], only: ReadonlySet<string> = EDITABLE_SUBTYPES): Promise<Uint8Array> {
  const doc = await load(bytes)
  const want = new Set(ids)
  const removed = new Set<string>()
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    if (!annots) continue
    for (let i = annots.size() - 1; i >= 0; i--) {
      const ref = annots.get(i)
      if (!(ref instanceof PDFRef) || !want.has(refIdOf(ref))) continue
      const dict = doc.context.lookupMaybe(ref, PDFDict)
      const sub = dict?.get(PDFName.of('Subtype'))?.toString()
      if (!sub || !only.has(sub.slice(1))) continue
      annots.remove(i)
      removed.add(refIdOf(ref))
    }
  }
  if (removed.size) {
    // 二遍:被删注释的 Popup 也从 /Annots 摘掉,免得留个点不开的孤儿图标。
    for (const page of doc.getPages()) {
      const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
      if (!annots) continue
      for (let i = annots.size() - 1; i >= 0; i--) {
        const ref = annots.get(i)
        if (!(ref instanceof PDFRef)) continue
        const dict = doc.context.lookupMaybe(ref, PDFDict)
        if (dict?.get(PDFName.of('Subtype'))?.toString() !== '/Popup') continue
        const parent = dict.get(PDFName.of('Parent'))
        if (parent instanceof PDFRef && removed.has(refIdOf(parent))) annots.remove(i)
      }
    }
  }
  return save(doc)
}

/** 平移注释(拖拽移动)。只改 /Rect 及各语义几何(/InkList /QuadPoints /L)——
 *  外观流不用动:PDF 渲染把 /AP 的 BBox 映射进 /Rect,Rect 挪到哪外观就画到哪(spec 12.5.5)。 */
export async function translateAnnots(bytes: Uint8Array, moves: { id: string; dx: number; dy: number }[]): Promise<Uint8Array> {
  const doc = await load(bytes)
  const ctx = doc.context
  const byId = new Map(moves.map((m) => [m.id, m]))
  const nums = (arr: PDFArray): number[] => {
    const out: number[] = []
    for (let i = 0; i < arr.size(); i++) out.push(arr.lookup(i, PDFNumber).asNumber())
    return out
  }
  const shiftFlat = (dict: PDFDict, key: string, dx: number, dy: number): void => {
    const arr = dict.lookupMaybe(PDFName.of(key), PDFArray)
    if (!arr) return
    dict.set(PDFName.of(key), ctx.obj(nums(arr).map((v, i) => v + (i % 2 === 0 ? dx : dy))))
  }
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    if (!annots) continue
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i)
      if (!(ref instanceof PDFRef)) continue
      const m = byId.get(refIdOf(ref))
      if (!m) continue
      const dict = doc.context.lookupMaybe(ref, PDFDict)
      const sub = dict?.get(PDFName.of('Subtype'))?.toString()
      if (!dict || !sub || !MOVABLE_SUBTYPES.has(sub.slice(1))) continue
      shiftFlat(dict, 'Rect', m.dx, m.dy)
      shiftFlat(dict, 'QuadPoints', m.dx, m.dy)
      shiftFlat(dict, 'L', m.dx, m.dy)
      const ink = dict.lookupMaybe(PDFName.of('InkList'), PDFArray)
      if (ink) {
        const lists: number[][] = []
        for (let k = 0; k < ink.size(); k++) lists.push(nums(ink.lookup(k, PDFArray)).map((v, j) => v + (j % 2 === 0 ? m.dx : m.dy)))
        dict.set(PDFName.of('InkList'), ctx.obj(lists))
      }
      dict.set(PDFName.of('M'), PDFString.of(pdfDate()))
    }
  }
  return save(doc)
}

/** 改注释正文(选中便签 → 编辑)。 */
export async function setAnnotContents(bytes: Uint8Array, id: string, text: string): Promise<Uint8Array> {
  const doc = await load(bytes)
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    if (!annots) continue
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i)
      if (!(ref instanceof PDFRef) || refIdOf(ref) !== id) continue
      const dict = doc.context.lookupMaybe(ref, PDFDict)
      if (!dict) continue
      dict.set(PDFName.of('Contents'), PDFHexString.fromText(text))
      dict.set(PDFName.of('M'), PDFString.of(pdfDate()))
    }
  }
  return save(doc)
}

/** 书签 = 追加 PDF Outline(大纲)顶层条目:任何阅读器的目录/书签栏可见、可跳页。 */
export async function addBookmark(bytes: Uint8Array, pageIndex: number, title: string): Promise<Uint8Array> {
  const doc = await load(bytes)
  const ctx = doc.context
  const page = doc.getPage(pageIndex)
  const cat = doc.catalog

  // Outline 根:缺→建;是直接字典→提升为间接对象(条目 Parent 需要 ref)。
  let rootRef = cat.get(PDFName.of('Outlines'))
  let root: PDFDict
  if (rootRef instanceof PDFRef) {
    root = ctx.lookup(rootRef, PDFDict)
  } else if (rootRef instanceof PDFDict) {
    root = rootRef
    rootRef = ctx.register(root)
    cat.set(PDFName.of('Outlines'), rootRef)
  } else {
    root = ctx.obj({ Type: 'Outlines' }) as PDFDict
    rootRef = ctx.register(root)
    cat.set(PDFName.of('Outlines'), rootRef)
  }

  const itemRef = ctx.nextRef()
  const item = ctx.obj({
    Title: PDFHexString.fromText(title),
    Parent: rootRef,
    Dest: [page.ref, 'XYZ', null, null, null],
  }) as PDFDict

  const lastRef = root.get(PDFName.of('Last'))
  if (lastRef instanceof PDFRef) {
    ctx.lookup(lastRef, PDFDict).set(PDFName.of('Next'), itemRef)
    item.set(PDFName.of('Prev'), lastRef)
  } else {
    root.set(PDFName.of('First'), itemRef)
  }
  root.set(PDFName.of('Last'), itemRef)
  // ponytail: Count 简单 +1(新顶层可见条目);不精确重算打开的子孙数,阅读器普遍宽容。
  const prev = root.lookupMaybe(PDFName.of('Count'), PDFNumber)?.asNumber() ?? 0
  root.set(PDFName.of('Count'), PDFNumber.of(Math.max(0, prev) + 1))
  ctx.assign(itemRef, item)
  return save(doc)
}
