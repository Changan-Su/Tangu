// 正文首 / 末块定位(纯函数,便于单测)。
// 'last' 必须与 pageStore 的 appendToEnd(末行「末列」)落点一致 —— 点空白续写靠它判断「末块是否已空」,
// 判据一旦与落点错位就会叠出一摞空块。
import type { BlockId, StackNode } from '@amadeus-shared/compiler/types'

export function edgeBlock(root: StackNode, edge: 'first' | 'last'): BlockId | null {
  const first = edge === 'first'
  const row = first ? root.children[0] : root.children.at(-1)
  const col = first ? row?.columns[0] : row?.columns.at(-1)
  const ref = first ? col?.children[0] : col?.children.at(-1)
  return ref?.ref ?? null
}
