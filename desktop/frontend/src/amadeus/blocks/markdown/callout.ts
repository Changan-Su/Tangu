// Callout 渲染:blockquote 首行以 `[!type]`(可带 +/- 折叠符)开头 → Obsidian 式着色标注。
// 纯 ProseMirror 装饰(不改 schema、不动序列化)→ .md 落盘仍是原生 Obsidian callout 语法,零迁移。
// token 保持可编辑、只样式化成徽章(Obsidian 编辑态同款诚实);
// 折叠([!x]-)已实现:收起只留首行,chevron 切换 = 改写 token 里的 +/- 字符(状态即 md,跨端一致)。

import { $prose } from '@milkdown/kit/utils'
import { Plugin } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'

const CALLOUT_RE = /^\[!([a-zA-Z]+)([+-])?(?=\s|$)/

export function calloutPlugin() {
  return $prose(
    () =>
      new Plugin({
        props: {
          decorations(state) {
            const decos: Decoration[] = []
            state.doc.descendants((node, pos) => {
              if (node.type.name !== 'blockquote') return true
              const first = node.firstChild
              const m = first && first.isTextblock ? CALLOUT_RE.exec(first.textContent) : null
              if (m) {
                const type = m[1].toLowerCase()
                const marker = m[2] // '+' | '-' | undefined
                const collapsed = marker === '-'
                decos.push(
                  Decoration.node(pos, pos + node.nodeSize, {
                    class: `callout callout-${type}${collapsed ? ' callout-collapsed' : ''}`,
                    'data-callout': type,
                  }),
                )
                // [!type](+/-) 徽章(m[0] 已含折叠符):blockquote 开(+1)+ 首段开(+1)= 文本起点 pos+2。
                decos.push(Decoration.inline(pos + 2, pos + 2 + m[0].length, { class: 'callout-token' }))
                // 折叠 chevron:改写 token 的 +/- 字符 → 状态进 md(Obsidian 同语义)。
                // ']' 之后的位置 = pos+2 + '[!' + type + ']'。
                const markerPos = pos + 2 + m[1].length + 3
                decos.push(
                  Decoration.widget(
                    pos + 2 + m[0].length,
                    (view) => {
                      const b = document.createElement('button')
                      b.className = `callout-fold${collapsed ? ' collapsed' : ''}`
                      b.title = collapsed ? '展开' : '折叠'
                      b.textContent = '›'
                      b.contentEditable = 'false'
                      b.addEventListener('mousedown', (e) => {
                        e.preventDefault()
                        e.stopPropagation()
                      })
                      b.addEventListener('click', () => {
                        const tr = view.state.tr
                        if (marker) view.dispatch(tr.insertText(collapsed ? '+' : '-', markerPos, markerPos + 1))
                        else view.dispatch(tr.insertText('-', markerPos, markerPos))
                      })
                      return b
                    },
                    // key 带位置与折叠态:态翻转重建(箭头方向/标题刷新);位置漂移则整组装饰已重算
                    { side: 1, ignoreSelection: true, stopEvent: () => true, key: `cf${pos}:${collapsed ? 1 : 0}` },
                  ),
                )
              }
              return false // 不深入 blockquote 内部(嵌套引用不重复标)
            })
            return decos.length ? DecorationSet.create(state.doc, decos) : null
          },
        },
      }),
  )
}
