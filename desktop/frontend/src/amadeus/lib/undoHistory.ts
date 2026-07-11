/** 文档级撤销的纯栈逻辑(与 zustand store 解耦 → 可在 node 环境单测)。
 *  数据安全核心 = 跨页守卫:撤销/重做前若栈顶快照属于别的笔记(用户切过页),作废整段历史并放弃本次 ——
 *  否则会把 A 笔记的内容 set 进当前 B 笔记、再随防抖保存写盘,造成 B 被 A 覆盖(数据损坏)。 */
export interface Snap<T> {
  page: string | null
  data: T
}

export interface UndoStack<T> {
  /** 变更前调用:快照当前状态入 past。kind 相同且距上次 push < coalesceMs → 合并成一步(打字不逐字建步)。 */
  push(snap: Snap<T>, kind: string, now: number): void
  /** 返回应恢复到的快照(并把 current 压入 future);无历史 → null;跨页 → 清空历史并返回 null。 */
  undo(current: Snap<T>): Snap<T> | null
  /** 与 undo 对称。 */
  redo(current: Snap<T>): Snap<T> | null
  reset(): void
}

export function makeUndoStack<T>(opts: { cap?: number; coalesceMs?: number } = {}): UndoStack<T> {
  const cap = opts.cap ?? 200 // ponytail: 历史上限,防长会话无限增长
  const coalesceMs = opts.coalesceMs ?? 500
  const past: Snap<T>[] = []
  const future: Snap<T>[] = []
  let lastAt = 0
  let lastKind: string | null = null
  const reset = (): void => {
    past.length = 0
    future.length = 0
    lastKind = null
  }
  const step = (from: Snap<T>[], to: Snap<T>[], current: Snap<T>): Snap<T> | null => {
    const top = from[from.length - 1]
    if (!top) return null
    if (top.page !== current.page) {
      reset() // 跨页 → 作废,绝不把别页的内容恢复到当前页
      return null
    }
    to.push(current)
    lastKind = null // 断开合并窗口:撤销/重做后下一次编辑另起一步
    return from.pop()!
  }
  return {
    push(snap, kind, now) {
      if (lastKind === kind && now - lastAt < coalesceMs) {
        lastAt = now
        return
      }
      past.push(snap)
      if (past.length > cap) past.shift()
      future.length = 0
      lastAt = now
      lastKind = kind
    },
    undo: (current) => step(past, future, current),
    redo: (current) => step(future, past, current),
    reset,
  }
}
