/** PDF 链接子路径编解码往返 + PDF 目标识别。 */
import { describe, it, expect } from 'vitest'
import {
  isPdfLinkInner, encodePdfSubpath, parsePdfSubpath, parsePdfLinkInner, buildPdfLink,
} from './pdfLink'

describe('pdfLink codec', () => {
  it('encode/parse 往返:page + color + annot', () => {
    const loc = { page: 3, color: 'yellow', annot: 'a1' }
    expect(parsePdfSubpath(encodePdfSubpath(loc))).toEqual(loc)
    expect(encodePdfSubpath(loc)).toBe('page=3&color=yellow&annot=a1')
  })

  it('encode 只有 page', () => {
    expect(encodePdfSubpath({ page: 5 })).toBe('page=5')
    expect(parsePdfSubpath('page=5')).toEqual({ page: 5 })
  })

  it('parse 容忍前导 # 与顺序', () => {
    expect(parsePdfSubpath('#annot=x&page=2')).toEqual({ page: 2, annot: 'x' })
  })

  it('page 非法/缺失 → null(不能定位)', () => {
    expect(parsePdfSubpath('color=red')).toBeNull()
    expect(parsePdfSubpath('page=0')).toBeNull()
    expect(parsePdfSubpath('')).toBeNull()
  })

  it('page 落地钳到 >=1', () => {
    expect(encodePdfSubpath({ page: 0 })).toBe('page=1')
    expect(encodePdfSubpath({ page: -3 })).toBe('page=1')
  })

  it('color 含特殊字符走 encode/decode', () => {
    const s = encodePdfSubpath({ page: 1, color: '#ff0 亮' })
    expect(parsePdfSubpath(s)).toEqual({ page: 1, color: '#ff0 亮' })
  })

  it('isPdfLinkInner 识别 .pdf(含子路径/别名/路径)', () => {
    expect(isPdfLinkInner('report.pdf')).toBe(true)
    expect(isPdfLinkInner('report.pdf#page=2')).toBe(true)
    expect(isPdfLinkInner('a/b.pdf|封面')).toBe(true)
    expect(isPdfLinkInner('note#heading')).toBe(false)
    expect(isPdfLinkInner('pic.png')).toBe(false)
  })

  it('parsePdfLinkInner 拆 target + loc;非 pdf → null', () => {
    expect(parsePdfLinkInner('report.pdf#page=3&annot=a1')).toEqual({
      target: 'report.pdf', loc: { page: 3, annot: 'a1' },
    })
    expect(parsePdfLinkInner('report.pdf')).toEqual({ target: 'report.pdf', loc: null })
    expect(parsePdfLinkInner('report.pdf#page=2|别名')?.loc).toEqual({ page: 2 }) // 规范序:target#sub|alias
    expect(parsePdfLinkInner('note#page=2')).toBeNull()
  })

  it('buildPdfLink 生成可粘贴 wikilink', () => {
    expect(buildPdfLink('report.pdf', { page: 3, annot: 'a1' })).toBe('[[report.pdf#page=3&annot=a1]]')
  })
})
