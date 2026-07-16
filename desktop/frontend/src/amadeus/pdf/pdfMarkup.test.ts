/** pdf-lib 写入层交叉验证:用 pdf-lib 写,用 pdf.js(另一套解析器)读回断言——
 *  证明写出的注释/大纲是合规 PDF 对象,而不只是 pdf-lib 自己认。 */
import { describe, expect, it } from 'vitest'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { addBookmark, addNote, addShape, addTextMarkup, type ShapeStyle } from './pdfMarkup'
import { mergeLineRects } from './selectionQuads'

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
