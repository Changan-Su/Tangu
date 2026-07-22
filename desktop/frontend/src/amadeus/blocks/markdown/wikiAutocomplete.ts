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

/** Same shape for an in-progress "/" slash command (Notion/AFFiNE 式):
 *  triggers when "/" sits at line start or after whitespace; aborts on ANY whitespace /
 *  newline / "]" in the query, or an over-long query. Crucially the query lives IN THE
 *  DOCUMENT (like [[ and @, unlike the old keystroke-sink menu) — so letters fall through
 *  to the editor and never get swallowed, and typing a space just leaves "/foo " as literal
 *  text (the menu vanishes). `from` = position just after "/"; the picker deletes the
 *  "/query" range via slashRange (blockTriggers) before applying the item. */
export function slashSuggestPlugin(report: (q: WikiQuery | null) => void) {
  return $prose(
    () =>
      new Plugin({
        view: () => ({
          update(view) {
            const { selection } = view.state
            if (!selection.empty) return report(null)
            const $head = selection.$head
            if (!$head.parent.isTextblock) return report(null)
            if ($head.parent.type.name === 'code_block') return report(null) // 代码块内 '/' 恒字面(路径/正则/注释)
            const before = $head.parent.textBetween(0, $head.parentOffset, undefined, '￼')
            const slash = before.lastIndexOf('/')
            if (slash < 0) return report(null)
            if (slash > 0 && !/\s/.test(before[slash - 1])) return report(null) // 词中的 '/'(TCP/IP、路径)不触发
            const q = before.slice(slash + 1)
            // 空格(含 nbsp)/换行/']' → 关菜单留字面;'￼' = 行内图片/公式 leaf 占位,命中即关
            // (否则 slashRange 从 '/' 删到光标会把图片/公式一起删掉,Codex)。
            if (q.length > 40 || /[\s\]\n￼]/.test(q)) return report(null)
            const from = $head.start() + slash + 1
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

/** Same shape for an in-progress "@" mention (Notion 式提及页面):
 *  triggers when "@" sits at line start or after whitespace; aborts on brackets/newline
 *  or an over-long query (an "@" far behind the caret is prose, not a mention).
 *  `from` = position just after "@" — the picker replaces [from-1, to) with "[[name]]". */
export function mentionSuggestPlugin(report: (q: WikiQuery | null) => void) {
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
            const at = before.lastIndexOf('@')
            if (at < 0) return report(null)
            if (at > 0 && !/\s/.test(before[at - 1])) return report(null) // 邮箱等:@ 前非空白不触发
            const q = before.slice(at + 1)
            if (q.length > 30 || /[[\]\n]/.test(q)) return report(null)
            const from = $head.start() + at + 1
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
