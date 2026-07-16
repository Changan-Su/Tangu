// 聊天消息里的 [[双链]]:纯文本切分 + remark 插件(assistant 的 Markdown 与 user 纯文本气泡共用)。
// 消息契约(Composer [[ 选笔记时插入):`[[<vault 绝对路径>|<笔记名>]]` —— 气泡显示笔记名,agent 读到路径。
// 本模块保持纯净(只依赖 links.ts),解析/打开等副作用在 ChatWikiLink.tsx。
import { WIKILINK_RE, linkTarget } from '@amadeus-shared/links'

export interface WikiPiece {
  /** 原文片段(双链片段 = 含 [[ ]] 的原文)。 */
  text: string
  wiki?: { inner: string; label: string; target: string }
}

/** [[Name|alias]] → alias;[[Name#h]] / [[Name]] → 原样内文(与编辑器 wikilink.ts 同规则)。 */
export function wikiLabel(inner: string): string {
  const bar = inner.indexOf('|')
  const l = (bar === -1 ? inner : inner.slice(bar + 1)).trim()
  return l || inner.trim()
}

/** 把一段纯文本按 [[..]] 切开;无双链 → 单段原文。 */
export function splitWiki(text: string): WikiPiece[] {
  if (text.indexOf('[[') === -1) return [{ text }]
  const re = new RegExp(WIKILINK_RE.source, WIKILINK_RE.flags) // 全局正则防共享 lastIndex(与 parseWikiLinks 同款防御)
  const out: WikiPiece[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) })
    const inner = m[1]
    out.push({ text: m[0], wiki: { inner, label: wikiLabel(inner), target: linkTarget(inner) } })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

/** Composer [[ 选中笔记时插入的文本:`[[<vault 绝对路径>|<名字>]] ` —— splitWiki 的逆向契约。 */
export function noteRefInsert(vaultRoot: string, pagePath: string): string {
  const base = pagePath.split('/').pop()!.replace(/\.md$/i, '')
  return `[[${vaultRoot}/${pagePath}|${base}]] `
}

interface MdNode {
  type: string
  value?: string
  url?: string
  children?: MdNode[]
}

/** remark 插件:text 节点里的 [[x]] → link(url=`#wiki=<inner>`),由 Markdown.tsx 的 a 组件拦截渲染。
 *  code/inlineCode/math 是独立节点类型天然不碰;link 内部不递归(双链不嵌进已有链接)。 */
export function remarkWiki() {
  const SKIP = new Set(['code', 'inlineCode', 'link', 'linkReference', 'math', 'inlineMath'])
  const walk = (node: MdNode): void => {
    const kids = node.children
    if (!kids) return
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i]
      if (SKIP.has(k.type)) continue
      if (k.type !== 'text' || !k.value || k.value.indexOf('[[') === -1) {
        walk(k)
        continue
      }
      const pieces = splitWiki(k.value)
      if (pieces.length === 1 && !pieces[0].wiki) continue
      const repl: MdNode[] = pieces.map((p) =>
        p.wiki
          ? { type: 'link', url: '#wiki=' + encodeURIComponent(p.wiki.inner), children: [{ type: 'text', value: p.wiki.label }] }
          : { type: 'text', value: p.text },
      )
      kids.splice(i, 1, ...repl)
      i += repl.length - 1
    }
  }
  return (tree: MdNode) => walk(tree)
}
