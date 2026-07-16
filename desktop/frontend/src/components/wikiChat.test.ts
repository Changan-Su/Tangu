import { describe, expect, it } from 'vitest'
import { noteRefInsert, remarkWiki, splitWiki, wikiLabel } from './wikiChat'

describe('noteRefInsert ↔ splitWiki 往返契约(Composer 插入 → 气泡渲染)', () => {
  it('插入 [[绝对路径|名字]],切分后 label=名字、target=绝对路径', () => {
    const ins = noteRefInsert('/Users/x/vault', 'dir/我的 笔记.md')
    expect(ins).toBe('[[/Users/x/vault/dir/我的 笔记.md|我的 笔记]] ')
    const [p] = splitWiki(ins.trim())
    expect(p.wiki?.label).toBe('我的 笔记')
    expect(p.wiki?.target).toBe('/Users/x/vault/dir/我的 笔记.md')
  })
})

describe('splitWiki', () => {
  it('无双链 → 单段原文', () => {
    expect(splitWiki('plain text')).toEqual([{ text: 'plain text' }])
  })
  it('切出双链并保留前后文', () => {
    const p = splitWiki('见 [[Note]] 和 [[b/Two|二]]。')
    expect(p.map((x) => x.text)).toEqual(['见 ', '[[Note]]', ' 和 ', '[[b/Two|二]]', '。'])
    expect(p[1].wiki).toEqual({ inner: 'Note', label: 'Note', target: 'Note' })
    expect(p[3].wiki).toEqual({ inner: 'b/Two|二', label: '二', target: 'b/Two' })
  })
  it('⚠️Composer 契约:[[绝对路径|名字]] → 显示名字、target=路径(agent 读路径,气泡只见名字)', () => {
    const [p] = splitWiki('[[/Users/x/vault/dir/Note.md|Note]]')
    expect(p.wiki).toEqual({ inner: '/Users/x/vault/dir/Note.md|Note', label: 'Note', target: '/Users/x/vault/dir/Note.md' })
  })
  it('label 回退:空 alias 用整段内文;#heading 不进 target', () => {
    expect(wikiLabel('Name|')).toBe('Name|')
    const [p] = splitWiki('[[Name#h2]]')
    expect(p.wiki?.target).toBe('Name')
  })
})

describe('remarkWiki', () => {
  const run = (tree: any) => {
    remarkWiki()(tree)
    return tree
  }
  it('text 节点里的 [[x]] → link(#wiki=inner)', () => {
    const tree = { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', value: '看 [[A|甲]] 吧' }] }] }
    const kids = run(tree).children[0].children
    expect(kids.map((k: any) => k.type)).toEqual(['text', 'link', 'text'])
    expect(kids[1].url).toBe('#wiki=' + encodeURIComponent('A|甲'))
    expect(kids[1].children[0].value).toBe('甲')
  })
  it('⚠️code/inlineCode 一字不动(代码里的 [[ ]] 是字面量,变链接=毁示例)', () => {
    const tree = {
      type: 'root',
      children: [
        { type: 'code', value: 'x = [[1]]' },
        { type: 'paragraph', children: [{ type: 'inlineCode', value: '[[y]]' }] },
      ],
    }
    const out = run(tree)
    expect(out.children[0].value).toBe('x = [[1]]')
    expect(out.children[1].children[0]).toEqual({ type: 'inlineCode', value: '[[y]]' })
  })
})
