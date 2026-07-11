/** 代码块增强(AFFiNE 对标):lowlight(highlight.js common,37 语言)语法高亮装饰
 *  + 悬停工具条 widget(语言选择 / 复制 / 折行)。配色复用 base.css 既有 .hljs-* 主题 token。
 *  语言即 fence info(```py)= code_block 节点 attrs.language,改语言 = setNodeMarkup(落盘 md 原生);
 *  折行是会话视图态(不进 md),位置经事务映射保持贴同一块。
 *  块编辑器一块一 doc,doc 极小 → 每次变更全量重高亮,无需缓存。 */
import { $prose } from '@milkdown/kit/utils'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { common, createLowlight } from 'lowlight'

const lowlight = createLowlight(common)

/** 语言菜单:常用置顶,其余字典序;'' = 纯文本。 */
const TOP = ['javascript', 'typescript', 'python', 'bash', 'json', 'html', 'css', 'sql', 'java', 'go', 'rust', 'c', 'cpp', 'yaml', 'markdown', 'diff']
const LANGS: string[] = [...TOP, ...lowlight.listLanguages().filter((l) => !TOP.includes(l)).sort()]

interface TokenRange {
  from: number
  to: number
  cls: string
}

interface HastText { type: 'text'; value: string }
interface HastElement { type: 'element'; children?: HastAny[]; properties?: { className?: string[] } }
type HastAny = HastText | HastElement

/** hast 树 → 按文本偏移的 class 区间(不认识的语言/解析失败 = 无高亮,绝不炸)。 */
function tokenRanges(code: string, lang: string): TokenRange[] {
  if (!code || !lang) return []
  let children: HastAny[]
  try {
    if (!lowlight.registered(lang)) return []
    children = lowlight.highlight(lang, code).children as HastAny[]
  } catch {
    return []
  }
  const out: TokenRange[] = []
  let off = 0
  const walk = (nodes: HastAny[], classes: string[]): void => {
    for (const n of nodes) {
      if (n.type === 'text') {
        if (classes.length) out.push({ from: off, to: off + n.value.length, cls: classes.join(' ') })
        off += n.value.length
      } else if (n.type === 'element') {
        walk(n.children ?? [], [...classes, ...(n.properties?.className ?? [])])
      }
    }
  }
  walk(children, [])
  return out
}

const codeKey = new PluginKey<{ wrapped: Set<number> }>('amx-code-block')

export function codeBlockPlugin() {
  return $prose(
    () =>
      new Plugin({
        key: codeKey,
        state: {
          init: () => ({ wrapped: new Set<number>() }),
          apply(tr, v) {
            const meta = tr.getMeta(codeKey) as { toggle?: number } | undefined
            if (!tr.docChanged && !meta) return v
            const wrapped = new Set([...v.wrapped].map((p) => tr.mapping.map(p)))
            if (meta?.toggle !== undefined) {
              if (wrapped.has(meta.toggle)) wrapped.delete(meta.toggle)
              else wrapped.add(meta.toggle)
            }
            return { wrapped }
          },
        },
        props: {
          decorations(state) {
            const decos: Decoration[] = []
            const wrapped = codeKey.getState(state)?.wrapped ?? new Set<number>()
            state.doc.descendants((node, pos) => {
              if (node.type.name !== 'code_block') return true
              const lang = String((node.attrs as { language?: string }).language ?? '').trim()
              const isWrap = wrapped.has(pos)
              decos.push(Decoration.node(pos, pos + node.nodeSize, { class: `amx-code${isWrap ? ' amx-code-wrap' : ''}` }))
              for (const t of tokenRanges(node.textContent, lang)) {
                decos.push(Decoration.inline(pos + 1 + t.from, pos + 1 + t.to, { class: t.cls }))
              }
              decos.push(
                Decoration.widget(
                  pos + 1,
                  (view, getPos) => {
                    /** widget 当前位置 = 节点位置 + 1(getPos 随事务映射,比 posAtDOM 猜测可靠)。 */
                    const nodeAt = (): number | null => {
                      const p = getPos()
                      return p === undefined ? null : p - 1
                    }
                    const bar = document.createElement('div')
                    bar.className = 'amx-code-tools'
                    bar.contentEditable = 'false'
                    // 语言选择
                    const sel = document.createElement('select')
                    sel.className = 'amx-code-lang'
                    sel.title = '语言'
                    const opt0 = document.createElement('option')
                    opt0.value = ''
                    opt0.textContent = '纯文本'
                    sel.appendChild(opt0)
                    const known = LANGS.includes(lang) || !lang
                    for (const l of known ? LANGS : [lang, ...LANGS]) {
                      const o = document.createElement('option')
                      o.value = l
                      o.textContent = l
                      sel.appendChild(o)
                    }
                    sel.value = lang
                    sel.addEventListener('change', () => {
                      const at = nodeAt()
                      if (at === null) return
                      const n = view.state.doc.nodeAt(at)
                      if (n?.type.name === 'code_block') {
                        view.dispatch(view.state.tr.setNodeMarkup(at, undefined, { ...n.attrs, language: sel.value }))
                      }
                    })
                    // 复制
                    const copy = document.createElement('button')
                    copy.className = 'amx-code-btn'
                    copy.textContent = '复制'
                    copy.title = '复制代码'
                    copy.addEventListener('click', () => {
                      const at = nodeAt()
                      const n = at === null ? null : view.state.doc.nodeAt(at)
                      if (!n) return
                      void navigator.clipboard.writeText(n.textContent).then(() => {
                        copy.textContent = '已复制'
                        setTimeout(() => { copy.textContent = '复制' }, 1200)
                      })
                    })
                    // 折行
                    const wrap = document.createElement('button')
                    wrap.className = `amx-code-btn${isWrap ? ' on' : ''}`
                    wrap.textContent = '折行'
                    wrap.title = '切换自动折行(视图态,不改内容)'
                    wrap.addEventListener('click', () => {
                      const at = nodeAt()
                      if (at !== null) view.dispatch(view.state.tr.setMeta(codeKey, { toggle: at }))
                    })
                    bar.append(sel, copy, wrap)
                    return bar
                  },
                  // key 带语言与折行态:变更即重建(select 值/按钮态才会刷新)
                  { side: -1, ignoreSelection: true, stopEvent: () => true, key: `ct${pos}:${lang}:${isWrap ? 1 : 0}` },
                ),
              )
              return false
            })
            return decos.length ? DecorationSet.create(state.doc, decos) : DecorationSet.empty
          },
        },
      }),
  )
}
