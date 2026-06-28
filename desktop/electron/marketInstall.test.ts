/**
 * Market 安装解压单测:重点是**安全边界**(路径穿越拒绝)+ GitHub source zip 的剥顶层。
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { isSafeSlug, shouldStripTop, safeEntryPath, extractZipToDir } from './marketInstall'

describe('isSafeSlug', () => {
  it('接受 kebab', () => { expect(isSafeSlug('my-skill')).toBe(true); expect(isSafeSlug('a1')).toBe(true) })
  it('拒绝穿越/大写/空/斜杠', () => {
    for (const s of ['../x', 'A', '', 'a/b', '.', 'a..b/../c', '-x']) expect(isSafeSlug(s)).toBe(false)
  })
})

describe('shouldStripTop', () => {
  it('单层顶级目录(source zip)→ 剥', () => {
    expect(shouldStripTop(['repo-sha/SKILL.md', 'repo-sha/lib/x.js'])).toBe(true)
  })
  it('内容在根 / 多个顶级 → 不剥', () => {
    expect(shouldStripTop(['SKILL.md', 'lib/x.js'])).toBe(false)
    expect(shouldStripTop(['SKILL.md'])).toBe(false)
  })
})

describe('safeEntryPath', () => {
  it('剥顶层后取相对路径', () => { expect(safeEntryPath('repo/SKILL.md', true)).toBe('SKILL.md') })
  it('穿越路径 → null', () => {
    expect(safeEntryPath('../evil', false)).toBeNull()
    expect(safeEntryPath('repo/../../etc/passwd', true)).toBeNull()
    expect(safeEntryPath('/abs', false)).toBe('abs') // 前导斜杠被剥成相对,仍安全
  })
})

describe('extractZipToDir', () => {
  it('正常解压 + 剥 GitHub source zip 顶层', async () => {
    const zip = new JSZip()
    zip.file('owner-repo-abc123/SKILL.md', '# hi')
    zip.file('owner-repo-abc123/lib/util.js', 'export const x=1')
    const buf = await zip.generateAsync({ type: 'nodebuffer' })
    const dest = mkdtempSync(join(tmpdir(), 'mk-'))
    const n = await extractZipToDir(buf, dest)
    expect(n).toBe(2)
    expect(readFileSync(join(dest, 'SKILL.md'), 'utf8')).toBe('# hi')
    expect(existsSync(join(dest, 'lib/util.js'))).toBe(true)
    expect(existsSync(join(dest, 'owner-repo-abc123'))).toBe(false) // 顶层已剥
  })

  // jszip 自身在 generate 时会规整 '../' → 经它造的 zip 到不了 safeEntryPath 的拒绝分支(双重防线)。
  // 这里断言**端到端安全属性**:无论如何,绝不在 dest 之外落盘。safeEntryPath 的纯单测已覆盖拒绝逻辑。
  it('穿越条目不写出 dest 之外', async () => {
    const zip = new JSZip()
    zip.file('SKILL.md', 'ok')
    zip.file('../../evil.sh', 'rm -rf')
    const buf = await zip.generateAsync({ type: 'nodebuffer' })
    const dest = mkdtempSync(join(tmpdir(), 'mk-'))
    await extractZipToDir(buf, dest)
    expect(existsSync(join(dest, '..', 'evil.sh'))).toBe(false)
    expect(existsSync(join(dest, '..', '..', 'evil.sh'))).toBe(false)
  })
})
