// Decorates [[Page Name]] text as a clickable link (no markdown change — the link stays
// literal text in the .md, so it round-trips and reads fine in Obsidian). Click opens it.

import { $prose } from '@milkdown/kit/utils'
import { Plugin, type EditorState } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { WIKILINK_RE, linkTarget } from '@amadeus-shared/links'

function wikiAt(state: EditorState, pos: number): string | null {
  const $pos = state.doc.resolve(pos)
  const parent = $pos.parent
  if (!parent.isTextblock) return null
  const text = parent.textContent
  const offset = pos - $pos.start()
  WIKILINK_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = WIKILINK_RE.exec(text))) {
    if (offset >= m.index && offset <= m.index + m[0].length) return linkTarget(m[1])
  }
  return null
}

export function wikilinkPlugin(onOpen: (name: string) => void) {
  return $prose(
    () =>
      new Plugin({
        props: {
          decorations(state) {
            const decos: Decoration[] = []
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return
              const text = node.text
              WIKILINK_RE.lastIndex = 0
              let m: RegExpExecArray | null
              while ((m = WIKILINK_RE.exec(text))) {
                const from = pos + m.index
                decos.push(
                  Decoration.inline(from, from + m[0].length, {
                    class: 'wikilink',
                    'data-wiki': linkTarget(m[1]),
                  }),
                )
              }
            })
            return decos.length ? DecorationSet.create(state.doc, decos) : null
          },
          handleClick(view: EditorView, pos: number) {
            const name = wikiAt(view.state, pos)
            if (name == null) return false
            onOpen(name)
            return true
          },
        },
      }),
  )
}
