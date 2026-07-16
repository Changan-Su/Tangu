/**
 * pdf-lib 写入层:pdf.js 编辑器只会写 高亮/文字/画笔,下划线/波浪线/删除线/便签/书签(大纲)/形状
 * 这几类得自己往 PDF 里写原生对象。全部是 bytes→bytes 纯函数,由 PdfAnnotator 的串行写队列调用
 * (写完必须重载 viewer 文档,否则 pdf.js 下次 saveDocument 会基于旧字节丢掉这里写的内容)。
 *
 * 文本标记(下划线族)不写 /AP:pdf.js / PDFium / Acrobat / 预览 都会为其自动生成外观。
 * **形状必须写 /AP**:PDFium(Chrome 内置阅读器)只为 Square/Circle 生成外观,Line 不管 → 不写就看不见。
 * 加密 PDF:PDFDocument.load 直接抛错 → 上层提示不支持写入。
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString } from 'pdf-lib'

export type MarkupKind = 'underline' | 'squiggly' | 'strikeout'
export type ShapeKind = 'rect' | 'circle' | 'line' | 'arrow'
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
