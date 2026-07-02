// Callout 渲染:blockquote 首行以 `[!type]`(可带 +/- 折叠符)开头 → Obsidian 式着色标注。
// 纯 ProseMirror 装饰(不改 schema、不动序列化)→ .md 落盘仍是原生 Obsidian callout 语法,零迁移。
// token 保持可编辑、只样式化成徽章(Obsidian 编辑态同款诚实);折叠渲染([!x]- )暂不做。

import { $prose } from '@milkdown/kit/utils'
import { Plugin } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'

const CALLOUT_RE = /^\[!([a-zA-Z]+)\][+-]?(?=\s|$)/

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
                decos.push(
                  Decoration.node(pos, pos + node.nodeSize, {
                    class: `callout callout-${type}`,
                    'data-callout': type,
                  }),
                )
                // [!type](+/-) 徽章(m[0] 已含折叠符):blockquote 开(+1)+ 首段开(+1)= 文本起点 pos+2。
                decos.push(Decoration.inline(pos + 2, pos + 2 + m[0].length, { class: 'callout-token' }))
              }
              return false // 不深入 blockquote 内部(嵌套引用不重复标)
            })
            return decos.length ? DecorationSet.create(state.doc, decos) : null
          },
        },
      }),
  )
}
