/** unescapeWikiOutsideFences:还原 remark 对 [[ 的转义,但代码围栏内逐字保留。 */
import { describe, it, expect } from 'vitest'
import { resolvePageName, unescapeWikiOutsideFences } from './links'

describe('unescapeWikiOutsideFences', () => {
  it('围栏外的 \\[\\[ 还原为 [[(含 !\\[\\[ 嵌入)', () => {
    expect(unescapeWikiOutsideFences('去 \\[\\[目标页]] 看')).toBe('去 [[目标页]] 看')
    expect(unescapeWikiOutsideFences('!\\[\\[图.png]]')).toBe('![[图.png]]')
  })
  it('``` 围栏内逐字保留(用户真写的 \\[\\[)', () => {
    const md = '前 \\[\\[a]]\n```\n正则 \\[\\[b]] 示例\n```\n后 \\[\\[c]]'
    expect(unescapeWikiOutsideFences(md)).toBe('前 [[a]]\n```\n正则 \\[\\[b]] 示例\n```\n后 [[c]]')
  })
  it('~~~ 围栏同样跳过,且 ``` 与 ~~~ 不互相闭合', () => {
    const md = '~~~\n\\[\\[x]]\n```\n\\[\\[y]]\n~~~\n\\[\\[z]]'
    expect(unescapeWikiOutsideFences(md)).toBe('~~~\n\\[\\[x]]\n```\n\\[\\[y]]\n~~~\n[[z]]')
  })
  it('无 \\[\\[ 时原样快速返回', () => {
    const md = '普通 [[已成链]] 文本\n```\ncode\n```'
    expect(unescapeWikiOutsideFences(md)).toBe(md)
  })
})

describe('resolvePageName(name, pages, sourcePath?)', () => {
  // 调用方约定传排序后的清单(全库并列时字典序首个 = 历史行为)。
  const pages = ['Foo.md', 'Solo.md', 'a/Foo.md', 'b/Foo.md', 'dir/Foo.md', 'dir/Src.fd/Child.md', 'dir/Src.md']

  it('裸名、无上下文:全库字典序首个(= 历史行为)', () => {
    expect(resolvePageName('Foo', pages)).toBe('Foo.md')
    expect(resolvePageName('foo', pages)).toBe('Foo.md') // 大小写不敏感
    expect(resolvePageName('Child', pages)).toBe('dir/Src.fd/Child.md') // 唯一名到处可达
    expect(resolvePageName('Nowhere', pages)).toBeNull()
    expect(resolvePageName('  ', pages)).toBeNull()
  })

  it('裸名、有上下文:源同目录优先', () => {
    expect(resolvePageName('Foo', pages, 'dir/Src.md')).toBe('dir/Foo.md')
    expect(resolvePageName('Foo', pages, 'a/Whatever.md')).toBe('a/Foo.md')
    expect(resolvePageName('Foo', pages, 'elsewhere/X.md')).toBe('Foo.md') // 附近无 → 回全库首个
  })

  it('裸名、有上下文:源自己的 .fd 子笔记优先于全库', () => {
    const p = ['b/Foo.md', 'x/Owner.fd/Foo.md']
    expect(resolvePageName('Foo', p, 'x/Owner.md')).toBe('x/Owner.fd/Foo.md')
    expect(resolvePageName('Foo', p, 'x/Other.md')).toBe('b/Foo.md') // 别人的 .fd 不沾光
  })

  it('路径限定:精确匹配或 null,绝不回落 basename', () => {
    expect(resolvePageName('a/Foo', pages)).toBe('a/Foo.md')
    expect(resolvePageName('a/Foo.md', pages)).toBe('a/Foo.md')
    expect(resolvePageName('A/FOO', pages)).toBe('a/Foo.md') // 路径也大小写不敏感
    expect(resolvePageName('x/Foo', pages)).toBeNull() // 不绑到 a/Foo
    expect(resolvePageName('dir/Src.fd/Child', pages)).toBe('dir/Src.fd/Child.md')
  })

  it('Windows 反斜杠两侧归一', () => {
    expect(resolvePageName('a\\Foo', pages)).toBe('a/Foo.md')
    expect(resolvePageName('Foo', ['a\\Foo.md'], 'a\\Src.md')).toBe('a\\Foo.md') // 同目录判定穿透 \
  })
})
