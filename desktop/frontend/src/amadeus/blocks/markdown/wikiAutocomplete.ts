// A ProseMirror plugin that watches for an in-progress [[ … and reports the query,
// its document range, and caret screen coords so a React popup can suggest pages.
// The query lives in the document (unlike the slash menu), so the popup lets letters
// pass through and only intercepts navigation keys.

import { $prose } from '@milkdown/kit/utils'
import { Plugin } from '@milkdown/kit/prose/state'

export interface WikiQuery {
  /** Text typed after the opening "[[". */
  query: string
  /** Document position just after "[[". */
  from: number
  /** Document position of the caret. */
  to: number
  left: number
  top: number
}

export function wikiSuggestPlugin(report: (q: WikiQuery | null) => void) {
  return $prose(
    () =>
      new Plugin({
        view: () => ({
          update(view) {
            const { selection } = view.state
            if (!selection.empty) return report(null)
            const $head = selection.$head
            if (!$head.parent.isTextblock) return report(null)
            const before = $head.parent.textBetween(0, $head.parentOffset, undefined, '￼')
            const open = before.lastIndexOf('[[')
            if (open < 0) return report(null)
            const q = before.slice(open + 2)
            if (/[\]\n]/.test(q)) return report(null) // the [[ was closed or aborted
            const from = $head.start() + open + 2
            const to = selection.head
            let coords: { left: number; bottom: number }
            try {
              coords = view.coordsAtPos(to)
            } catch {
              return report(null)
            }
            report({ query: q, from, to, left: coords.left, top: coords.bottom })
          },
        }),
      }),
  )
}
