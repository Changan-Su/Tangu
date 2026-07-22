/** pdf-lib 写入层交叉验证:用 pdf-lib 写,用 pdf.js(另一套解析器)读回断言——
 *  证明写出的注释/大纲是合规 PDF 对象,而不只是 pdf-lib 自己认。 */
import { describe, expect, it } from 'vitest'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { addBookmark, addInk, addNote, addShape, addTextMarkup, INK_ONLY, removeAnnots, setAnnotContents, translateAnnots, type InkStroke, type ShapeStyle } from './pdfMarkup'
import { mergeLineRects } from './selectionQuads'
import { distToFlatSq, distToPointsSq } from './inkStroke'

pdfjs.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.mjs'

async function blankPdf(pages = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([600, 800])
  return doc.save({ useObjectStreams: false })
}
const readBack = (bytes: Uint8Array) => pdfjs.getDocument({ data: bytes.slice() }).promise

const QUAD = [50, 700, 200, 700, 50, 688, 200, 688] // 左上,右上,左下,右下

describe('addTextMarkup', () => {
  it('写出 pdf.js 能读回的 Underline 注释(色/QuadPoints/Rect)', async () => {
    const bytes = await addTextMarkup(await blankPdf(), 'underline', '#ff0000', [{ pageIndex: 0, quads: [QUAD] }])
    const doc = await readBack(bytes)
    const anns = await (await doc.getPage(1)).getAnnotations()
    expect(anns).toHaveLength(1)
    expect(anns[0].subtype).toBe('Underline')
    expect(Array.from(anns[0].color as Uint8ClampedArray)).toEqual([255, 0, 0])
    expect(anns[0].quadPoints).toBeTruthy()
    expect(anns[0].rect).toEqual([50, 688, 200, 700])
    await doc.destroy()
  })

  it('波浪线/删除线子类型正确;多页多次追加共存', async () => {
    let bytes = await blankPdf()
    bytes = await addTextMarkup(bytes, 'squiggly', '#00ff00', [{ pageIndex: 0, quads: [QUAD] }, { pageIndex: 1, quads: [QUAD] }])
    bytes = await addTextMarkup(bytes, 'strikeout', '#0000ff', [{ pageIndex: 0, quads: [QUAD] }])
    const doc = await readBack(bytes)
    const p1 = await (await doc.getPage(1)).getAnnotations()
    const p2 = await (await doc.getPage(2)).getAnnotations()
    expect(p1.map((a: any) => a.subtype).sort()).toEqual(['Squiggly', 'StrikeOut'])
    expect(p2.map((a: any) => a.subtype)).toEqual(['Squiggly'])
    await doc.destroy()
  })
})

describe('addNote', () => {
  it('写出 /Text 便签,中文 Contents 读回一致', async () => {
    const bytes = await addNote(await blankPdf(), 0, 100, 750, '你好,世界', '#ffe14d')
    const doc = await readBack(bytes)
    const anns = await (await doc.getPage(1)).getAnnotations()
    expect(anns).toHaveLength(1)
    expect(anns[0].subtype).toBe('Text')
    expect(anns[0].contentsObj?.str).toBe('你好,世界')
    await doc.destroy()
  })
})

describe('addBookmark', () => {
  it('无大纲时新建;再次追加保留前项;dest 指向正确页', async () => {
    let bytes = await blankPdf()
    bytes = await addBookmark(bytes, 0, '第一章')
    bytes = await addBookmark(bytes, 1, '重点:第 2 页')
    const doc = await readBack(bytes)
    const outline = await doc.getOutline()
    expect(outline?.map((o: any) => o.title)).toEqual(['第一章', '重点:第 2 页'])
    const pageIdx = await doc.getPageIndex(outline![1].dest![0])
    expect(pageIdx).toBe(1)
    await doc.destroy()
  })
})

describe('addShape', () => {
  const style: ShapeStyle = { stroke: '#ff0000', fill: '#0000ff', width: 3, opacity: 0.5 }

  /** pdf.js 的 getAnnotations() **不解析 /IC**(bundle 里无此键),故内部色只能用 pdf-lib 读回原始对象验。 */
  const rawAnnot = async (bytes: Uint8Array, page = 0) => {
    const d = await PDFDocument.load(bytes)
    const annots = d.getPage(page).node.Annots()!
    return annots.lookup(annots.size() - 1, PDFDict)
  }

  it('矩形写成 /Square + 描边/内部色/线宽/透明度,且带 /AP 外观流', async () => {
    const bytes = await addShape(await blankPdf(), 0, 'rect', [100, 200], [300, 400], style)
    const doc = await readBack(bytes)
    const [a] = await (await doc.getPage(1)).getAnnotations()
    expect(a.subtype).toBe('Square')
    expect(Array.from(a.color as Uint8ClampedArray)).toEqual([255, 0, 0])
    expect(a.borderStyle.width).toBe(3)
    await doc.destroy()
    // /AP + /IC + /CA 走原始对象核对(pdf.js 不暴露 IC;/AP 是 PDFium 能否显示的关键)
    const raw = await rawAnnot(bytes)
    expect(raw.lookup(PDFName.of('AP'), PDFDict).has(PDFName.of('N'))).toBe(true)
    expect(raw.lookup(PDFName.of('IC'), PDFArray).toString()).toBe('[ 0 0 1 ]')
    expect(raw.lookup(PDFName.of('CA'), PDFNumber).asNumber()).toBe(0.5)
  })

  it('/AP 外观流内容真的画了形状(re + B),不是空壳', async () => {
    const bytes = await addShape(await blankPdf(), 0, 'rect', [100, 200], [300, 400], style)
    const d = await PDFDocument.load(bytes)
    const annots = d.getPage(0).node.Annots()!
    const ap = annots.lookup(0, PDFDict).lookup(PDFName.of('AP'), PDFDict)
    const stream = d.context.lookup(ap.get(PDFName.of('N'))) as any
    const src = new TextDecoder().decode(stream.getContents())
    expect(src).toContain(' re B')                            // 矩形路径 + 填充描边
    expect(src).toContain('1.000000 0.000000 0.000000 RG')    // 红色描边
    expect(src).toContain('0.000000 0.000000 1.000000 rg')    // 蓝色填充
    expect(src).toContain('3.000000 w')                       // 线宽
  })

  it('圆写成 /Circle;空心时不写内部色', async () => {
    const bytes = await addShape(await blankPdf(), 0, 'circle', [50, 50], [150, 120], { ...style, fill: null })
    const doc = await readBack(bytes)
    const [a] = await (await doc.getPage(1)).getAnnotations()
    expect(a.subtype).toBe('Circle')
    await doc.destroy()
    expect((await rawAnnot(bytes)).has(PDFName.of('IC'))).toBe(false)
  })

  it('直线/箭头写成 /Line,端点保序;箭头带 /LE 端点样式', async () => {
    let bytes = await addShape(await blankPdf(), 0, 'line', [10, 20], [200, 300], style)
    bytes = await addShape(bytes, 0, 'arrow', [10, 20], [200, 300], style)
    const doc = await readBack(bytes)
    const anns = await (await doc.getPage(1)).getAnnotations()
    expect(anns.map((a: any) => a.subtype)).toEqual(['Line', 'Line'])
    expect(anns[0].lineCoordinates).toEqual([10, 20, 200, 300])
    expect(anns[1].lineEndings).toEqual(['None', 'OpenArrow'])
    await doc.destroy()
  })

  it('Rect 含线宽外扩(否则描边被裁);箭头再扩箭头长度', async () => {
    const rect = await readBack(await addShape(await blankPdf(), 0, 'rect', [100, 100], [200, 200], style))
    const [ra] = await (await rect.getPage(1)).getAnnotations()
    expect(ra.rect[0]).toBeLessThan(100) // 左边界外扩了
    expect(ra.rect[2]).toBeGreaterThan(200)
    await rect.destroy()
  })
})

describe('addInk', () => {
  const stroke = (pageIndex: number, pts: number[][], over: Partial<InkStroke> = {}): InkStroke =>
    ({ pageIndex, pts, simulate: true, color: '#1e1e1e', width: 2, opacity: 1, ...over })
  const PTS = [[100, 700, 0.5], [130, 690, 0.5], [170, 705, 0.5], [220, 680, 0.5]]

  it('写出 pdf.js 能读回的 /Ink(色/InkList),Rect 罩住整条笔迹', async () => {
    const bytes = await addInk(await blankPdf(), [stroke(0, PTS)])
    const doc = await readBack(bytes)
    const anns = await (await doc.getPage(1)).getAnnotations()
    expect(anns).toHaveLength(1)
    expect(anns[0].subtype).toBe('Ink')
    expect(Array.from(anns[0].color as Uint8ClampedArray)).toEqual([30, 30, 30])
    expect(anns[0].inkLists).toHaveLength(1)
    expect(anns[0].rect[0]).toBeLessThan(100)
    expect(anns[0].rect[2]).toBeGreaterThan(220)
    await doc.destroy()
  })

  it('/AP 真的画了 Excalidraw 式填充轮廓(三次曲线 + 填充),不透明度以 ExtGState 进流', async () => {
    const bytes = await addInk(await blankPdf(), [stroke(0, PTS, { color: '#ff0000', opacity: 0.5 })])
    const d = await PDFDocument.load(bytes)
    const annots = d.getPage(0).node.Annots()!
    const ap = annots.lookup(0, PDFDict).lookup(PDFName.of('AP'), PDFDict)
    const stream = d.context.lookup(ap.get(PDFName.of('N'))) as any
    const src = new TextDecoder().decode(stream.getContents())
    expect(src).toContain('/GS0 gs')                       // 半透明靠流内 ExtGState(/CA 对带 AP 的注释不保证被合成)
    expect(src).toContain('1.000000 0.000000 0.000000 rg') // 笔色作填充色
    expect(src).toContain(' c\n')                          // 轮廓样条(二次转三次)
    expect(src).toMatch(/h\nf\n/)                          // 闭合 + 非零填充
    const gs = stream.dict.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('ExtGState'), PDFDict)
    expect(gs.lookup(PDFName.of('GS0'), PDFDict).lookup(PDFName.of('ca'), PDFNumber).asNumber()).toBe(0.5)
  })

  it('外观流过得了 pdf.js 渲染求值器:operator list 里有本注释的曲线+填充(证明真的会被画出来)', async () => {
    const bytes = await addInk(await blankPdf(), [stroke(0, PTS)])
    const doc = await readBack(bytes)
    const ops = await (await doc.getPage(1)).getOperatorList()
    expect(ops.fnArray).toContain(pdfjs.OPS.beginAnnotation)     // 注释外观进了渲染流
    expect(ops.fnArray).toContain(pdfjs.OPS.setGState)           // 流内 ExtGState(不透明度)被求值
    expect(ops.fnArray).toContain(pdfjs.OPS.setFillRGBColor)     // 笔色生效
    const cp = ops.fnArray.indexOf(pdfjs.OPS.constructPath)      // 路径被编译成复合算子
    expect(cp).toBeGreaterThan(-1)
    const [paintOp, subPath] = ops.argsArray[cp] as [number, number[][]]
    expect(paintOp).toBe(pdfjs.OPS.fill)                         // 填充轮廓(Excalidraw 的样子靠它)
    expect(subPath[0].length).toBeGreaterThan(30)                // 样条点真在里面,不是空路径
    await doc.destroy()
  })

  it('一笔一条注释(橡皮才能按笔擦,不连坐);单点(点一下)也成墨点', async () => {
    let bytes = await addInk(await blankPdf(), [
      stroke(0, PTS),
      stroke(0, PTS.map(([x, y, p]) => [x, y - 50, p])),
      stroke(0, PTS, { color: '#ff0000' }),
    ])
    bytes = await addInk(bytes, [stroke(1, [[300, 400, 0.5]])])
    const doc = await readBack(bytes)
    const p1 = await (await doc.getPage(1)).getAnnotations()
    expect(p1).toHaveLength(3)
    expect(p1.every((a: any) => a.subtype === 'Ink' && a.inkLists.length === 1)).toBe(true)
    const p2 = await (await doc.getPage(2)).getAnnotations()
    expect(p2).toHaveLength(1) // 单点笔画退化成墨点而不是被吞掉
    await doc.destroy()
  })
})

describe('removeAnnots(橡皮/删除选中)', () => {
  const stroke = (pts: number[][], color = '#1e1e1e'): InkStroke =>
    ({ pageIndex: 0, pts, simulate: true, color, width: 2, opacity: 1 })
  const PTS = [[100, 700, 0.5], [130, 690, 0.5], [170, 705, 0.5]]

  it('按 pdf.js 注释 id 精确删除;橡皮通道(INK_ONLY)拿形状 id 也删不掉;未知 id 无害', async () => {
    let bytes = await addInk(await blankPdf(), [stroke(PTS), stroke(PTS.map(([x, y, p]) => [x, y - 100, p]), '#ff0000')])
    bytes = await addShape(bytes, 0, 'rect', [10, 10], [50, 50], { stroke: '#ff0000', fill: null, width: 2, opacity: 1 })
    let doc = await readBack(bytes)
    let anns = await (await doc.getPage(1)).getAnnotations()
    const inkIds = anns.filter((a: any) => a.subtype === 'Ink').map((a: any) => a.id)
    const rectId = anns.find((a: any) => a.subtype === 'Square')!.id
    expect(inkIds).toHaveLength(2)
    await doc.destroy()

    bytes = await removeAnnots(bytes, [inkIds[0], rectId, '99999R'], INK_ONLY)
    doc = await readBack(bytes)
    anns = await (await doc.getPage(1)).getAnnotations()
    expect(anns.map((a: any) => a.subtype).sort()).toEqual(['Ink', 'Square']) // 橡皮只删目标 Ink,形状安然
    expect(anns.find((a: any) => a.subtype === 'Ink')!.id).toBe(inkIds[1])
    await doc.destroy()

    bytes = await removeAnnots(bytes, [rectId]) // 通用通道(删除选中)则可以删形状
    doc = await readBack(bytes)
    anns = await (await doc.getPage(1)).getAnnotations()
    expect(anns.map((a: any) => a.subtype)).toEqual(['Ink'])
    await doc.destroy()
  })

  it('被删注释的孤儿 /Popup 一并摘除;文件仍可正常解析', async () => {
    let bytes = await addInk(await blankPdf(), [stroke(PTS)])
    {
      // 手工给这条 Ink 挂一个 /Popup(模拟外部编辑器写的样子)
      const d = await PDFDocument.load(bytes)
      const annots = d.getPage(0).node.Annots()!
      const popup = d.context.obj({ Type: 'Annot', Subtype: 'Popup', Rect: [0, 0, 10, 10], Parent: annots.get(0) })
      annots.push(d.context.register(popup))
      bytes = await d.save({ useObjectStreams: false })
    }
    let doc = await readBack(bytes)
    let anns = await (await doc.getPage(1)).getAnnotations()
    const inkId = anns.find((a: any) => a.subtype === 'Ink')!.id
    await doc.destroy()

    bytes = await removeAnnots(bytes, [inkId], INK_ONLY)
    doc = await readBack(bytes)
    anns = await (await doc.getPage(1)).getAnnotations()
    expect(anns.filter((a: any) => a.subtype === 'Ink' || a.subtype === 'Popup')).toHaveLength(0)
    await doc.destroy()
  })
})

describe('translateAnnots / setAnnotContents(选中后移动/编辑)', () => {
  it('平移:Rect/InkList/L 一起挪;文本标记(钉在字上)不挪;pdf.js 读回位置正确', async () => {
    let bytes = await addInk(await blankPdf(), [{ pageIndex: 0, pts: [[100, 700, 0.5], [150, 690, 0.5], [200, 705, 0.5]], simulate: true, color: '#1e1e1e', width: 2, opacity: 1 }])
    bytes = await addShape(bytes, 0, 'line', [10, 20], [200, 300], { stroke: '#ff0000', fill: null, width: 2, opacity: 1 })
    bytes = await addTextMarkup(bytes, 'underline', '#ff0000', [{ pageIndex: 0, quads: [QUAD] }])
    let doc = await readBack(bytes)
    let anns = await (await doc.getPage(1)).getAnnotations()
    const ink = anns.find((a: any) => a.subtype === 'Ink')!
    const line = anns.find((a: any) => a.subtype === 'Line')!
    const ul = anns.find((a: any) => a.subtype === 'Underline')!
    const inkRect0 = [...ink.rect]
    const ulRect0 = [...ul.rect]
    await doc.destroy()

    bytes = await translateAnnots(bytes, [
      { id: ink.id, dx: 30, dy: -40 },
      { id: line.id, dx: 5, dy: 5 },
      { id: ul.id, dx: 100, dy: 100 }, // 下划线是文本标记 → 应被拒绝
    ])
    doc = await readBack(bytes)
    anns = await (await doc.getPage(1)).getAnnotations()
    const ink2 = anns.find((a: any) => a.subtype === 'Ink')!
    expect(ink2.rect[0]).toBeCloseTo(inkRect0[0] + 30, 4)
    expect(ink2.rect[1]).toBeCloseTo(inkRect0[1] - 40, 4)
    const lc = anns.find((a: any) => a.id === line.id)!.lineCoordinates
    expect(lc).toEqual([15, 25, 205, 305])
    expect(anns.find((a: any) => a.id === ul.id)!.rect).toEqual(ulRect0)
    await doc.destroy()
  })

  it('改便签正文:Contents 更新,中文读回一致', async () => {
    let bytes = await addNote(await blankPdf(), 0, 100, 750, '旧内容', '#ffe14d')
    let doc = await readBack(bytes)
    const [note] = await (await doc.getPage(1)).getAnnotations()
    await doc.destroy()
    bytes = await setAnnotContents(bytes, note.id, '新内容:你好')
    doc = await readBack(bytes)
    const [note2] = await (await doc.getPage(1)).getAnnotations()
    expect(note2.contentsObj?.str).toBe('新内容:你好')
    await doc.destroy()
  })
})

describe('橡皮命中几何', () => {
  it('distToPointsSq/distToFlatSq:线上為 0,旁边按垂距,端点外按端点距', () => {
    const pts = [[0, 0, 0.5], [10, 0, 0.5]]
    expect(distToPointsSq([5, 0], pts)).toBe(0)
    expect(distToPointsSq([5, 3], pts)).toBe(9)
    expect(distToPointsSq([-4, 0], pts)).toBe(16)
    expect(distToFlatSq([5, 3], [0, 0, 10, 0])).toBe(9)
    expect(distToFlatSq([2, 2], [7, 7])).toBe(50) // 单点 InkList(墨点)
    expect(distToPointsSq([0, 0], [])).toBe(Infinity)
  })
})

describe('mergeLineRects', () => {
  const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom })
  it('同行词间碎块并成整段,多栏大间距不并,不同行不并', () => {
    const merged = mergeLineRects([
      box(10, 100, 40, 112), box(44, 100, 90, 112), // 同行小间隙 → 并
      box(300, 100, 340, 112), // 同行但栏间距(>行高) → 不并
      box(10, 130, 90, 142), // 下一行 → 不并
    ])
    expect(merged).toHaveLength(3)
    const first = merged.find((r) => r.left === 10 && r.top === 100)
    expect(first?.right).toBe(90)
  })
})
