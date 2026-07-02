// fmExtra round-trip:外来 frontmatter(Obsidian properties 等)必须在 载入→编译 间逐字保留。
import { describe, expect, it } from 'vitest'
import { compile } from './compile'
import { parsePageSource } from './page'
import type { BlockId, LoadedPage } from './types'

const NOW = '2026-07-02T00:00:00.000Z'

function contentsOf(page: LoadedPage): Record<BlockId, string> {
  return Object.fromEntries(Object.entries(page.blocks).map(([id, b]) => [id, b.content]))
}

const FOREIGN = [
  '---',
  'tags:',
  '  - alpha',
  '  - beta',
  '# 用户注释也要保住',
  'status: draft',
  '---',
  '',
  '第一段。',
  '',
  '第二段(与上段同块,空行不拆块)。',
  '',
].join('\n')

describe('compiler fmExtra round-trip', () => {
  it('adopts foreign frontmatter into fmExtra and keeps the body one verbatim block', () => {
    const page = parsePageSource('note.md', FOREIGN, NOW)
    expect(page.manifest.fmExtra).toBe(['tags:', '  - alpha', '  - beta', '# 用户注释也要保住', 'status: draft'].join('\n'))
    const blocks = Object.values(page.blocks)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].content).toContain('第一段。\n\n第二段')
  })

  it('writes fmExtra back on compile and stays byte-stable across re-parses', () => {
    const p1 = parsePageSource('note.md', FOREIGN, NOW)
    const md1 = compile(p1.manifest, contentsOf(p1))
    expect(md1).toContain('  - beta')
    expect(md1).toContain('status: draft')
    expect(md1.indexOf('status: draft')).toBeLessThan(md1.indexOf('第一段'))

    const p2 = parsePageSource('note.md', md1, NOW) // 现在是 v3(带 amadeus_page)
    expect(p2.manifest.fmExtra).toBe(p1.manifest.fmExtra)
    const md2 = compile(p2.manifest, contentsOf(p2))
    expect(md2).toBe(md1)
  })

  it('sanitizes reserved keys and bare --- lines out of fmExtra at compile time', () => {
    const p = parsePageSource('note.md', FOREIGN, NOW)
    // 属性面板原文模式等写入方可能夹带保留键/裸 '---':落盘会劫持页 id / 提早闭合 frontmatter。
    p.manifest.fmExtra = ['amadeus_page: hijacked', 'status: draft', '---', 'evil: body'].join('\n')
    const md = compile(p.manifest, contentsOf(p))
    const fm = md.split('\n---\n')[0]
    expect(fm).toContain('status: draft')
    expect(fm).toContain('evil: body') // 键本身无害,保留
    expect(fm).not.toContain('amadeus_page: hijacked')
    const reparsed = parsePageSource('note.md', md, NOW)
    expect(reparsed.manifest.id).toBe(p.manifest.id) // 页 id 未被劫持
  })

  it('emits clean frontmatter when there is nothing foreign', () => {
    const p = parsePageSource('note.md', '只有正文,没有 frontmatter。\n', NOW)
    expect(p.manifest.fmExtra).toBeUndefined()
    const md = compile(p.manifest, contentsOf(p))
    const fm = md.split('---')[1]
    expect(fm.trim().split('\n')).toHaveLength(3) // 仅 amadeus_page/schema/layout
  })
})
