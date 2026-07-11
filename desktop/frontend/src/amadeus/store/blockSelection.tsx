/** 块选中(Notion 式,非编辑态):Esc / 点拖拽手柄进入,块高亮描边;
 *  键盘:Backspace/Delete 删、Cmd+C 复制 md 源文、Cmd+X 剪切、Cmd+V 粘为新块、
 *  Cmd+D 复制块、Enter 回编辑、↑↓ 移动选中、Esc/点旁处/进入编辑 清除。
 *  单选一块(多选不做);跨页残留由 loadPage 清。 */
import { useEffect } from 'react'
import { create } from 'zustand'
import { usePageStore } from './pageStore'
import { useUiStore } from './uiStore'

export const useBlockSelection = create<{ id: string | null; select(id: string | null): void }>((set) => ({
  id: null,
  select: (id) => set({ id }),
}))

// 换页清选中(残留 id 可能撞上新页顺序号块)。
usePageStore.subscribe((s, prev) => {
  if (s.activePage !== prev.activePage && useBlockSelection.getState().id) useBlockSelection.getState().select(null)
})

const isTypingTarget = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null
  if (!el) return false
  return !!el.closest?.('input, textarea, select, [contenteditable="true"], .ProseMirror')
}

/** 挂在 PageView:选中态的全局键盘处理 + 点旁处清除。 */
export function BlockSelectionKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const id = useBlockSelection.getState().id
      if (!id) return
      if (isTypingTarget(e.target)) return // 焦点在输入处(理应已清选中):不抢键
      const ps = usePageStore.getState()
      const block = ps.blocks[id]
      if (!block) {
        useBlockSelection.getState().select(null)
        return
      }
      const mod = e.metaKey || e.ctrlKey
      const stop = (): void => {
        e.preventDefault()
        e.stopPropagation()
      }
      if (e.key === 'Escape') {
        stop()
        useBlockSelection.getState().select(null)
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        stop()
        useBlockSelection.getState().select(null)
        ps.deleteBlock(id)
      } else if (e.key === 'Enter') {
        stop()
        useBlockSelection.getState().select(null)
        ps.requestFocus(id, 'end')
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        stop()
        const order = ps.flatOrder()
        const i = order.indexOf(id)
        const next = order[e.key === 'ArrowUp' ? i - 1 : i + 1]
        if (next) useBlockSelection.getState().select(next)
      } else if (mod && (e.key === 'c' || e.key === 'C')) {
        stop()
        void navigator.clipboard.writeText(block.content)
        useUiStore.getState().notify('已复制块内容')
      } else if (mod && (e.key === 'x' || e.key === 'X')) {
        stop()
        void navigator.clipboard.writeText(block.content).then(() => {
          useBlockSelection.getState().select(null)
          ps.deleteBlock(id)
        })
        useUiStore.getState().notify('已剪切块')
      } else if (mod && (e.key === 'v' || e.key === 'V')) {
        stop()
        void navigator.clipboard.readText().then((t) => {
          const text = t.trim()
          if (!text) return
          const nid = usePageStore.getState().insertBlockAfter(id, undefined, text)
          if (nid) useBlockSelection.getState().select(nid)
        })
      } else if (mod && (e.key === 'd' || e.key === 'D')) {
        stop()
        ps.duplicateBlock(id)
      }
    }
    const onPointerDown = (e: PointerEvent): void => {
      const id = useBlockSelection.getState().id
      if (!id) return
      const el = e.target as HTMLElement | null
      // 点在选中块自身(含其手柄/菜单)不清;点别处清(点其他块手柄会随其 click 重新选中)
      if (el?.closest?.(`[data-block-id="${CSS.escape(id)}"]`) || el?.closest?.('.ctx-menu')) return
      useBlockSelection.getState().select(null)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [])
  return null
}
