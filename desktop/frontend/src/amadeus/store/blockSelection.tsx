/** 块选中(Notion 式,非编辑态):点拖拽手柄 / 拖拽 / 空白处框选进入,选中块高亮描边;
 *  键盘:Backspace/Delete 删(可多块)、Cmd+C 复制 md 源文、Cmd+X 剪切、Cmd+V 粘为新块、
 *  Cmd+D 复制块、Enter 回编辑、↑↓ 移动选中(单块)、Esc/点旁处/进入编辑 清除。
 *  多选仅由框选/拖拽产生;跨页残留由 loadPage 清。 */
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { usePageStore } from './pageStore'
import { useUiStore } from './uiStore'
import { marqueeHits } from '../lib/marquee'

export const useBlockSelection = create<{
  ids: Set<string>
  select(id: string | null): void // 单选(替换)
  setMany(ids: string[]): void // 框选/拖拽多选
  clear(): void
}>((set) => ({
  ids: new Set(),
  select: (id) => set({ ids: id ? new Set([id]) : new Set() }),
  setMany: (ids) => set({ ids: new Set(ids) }),
  clear: () => set({ ids: new Set() }),
}))

// 换页清选中(残留 id 可能撞上新页顺序号块)。
usePageStore.subscribe((s, prev) => {
  if (s.activePage !== prev.activePage && useBlockSelection.getState().ids.size) useBlockSelection.getState().clear()
})

const isTypingTarget = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null
  if (!el) return false
  return !!el.closest?.('input, textarea, select, [contenteditable="true"], .ProseMirror')
}

// 空白处才起框选:排除块内容/手柄/菜单/交互控件(含列宽拖杆),且须在编辑器内。
const isBlankTarget = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null
  if (!el || !el.closest?.('.page-view')) return false
  return !el.closest?.(
    '.block-body, .block-gutter, .drag-handle, .block-add, .col-resizer, .ctx-menu, input, textarea, [contenteditable="true"], .ProseMirror, a, button',
  )
}

// deleteBlock 是 async(内部 await backlinks 检查):多块必须串行,否则并发调用各自快照同一
// manifest、后 commit 覆盖前 commit → 只删掉一个 / 留下悬空引用(codex P1)。
async function deleteSerial(ids: string[]): Promise<void> {
  for (const b of ids) await usePageStore.getState().deleteBlock(b)
}

/** 挂在 PageView:选中态键盘处理 + 点旁处清除 + 空白框选(渲染框选矩形)。 */
export function BlockSelectionKeys() {
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

  // 键盘 + 点旁处清除
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const ids = [...useBlockSelection.getState().ids]
      if (!ids.length) return
      if (isTypingTarget(e.target)) return // 焦点在输入处:不抢键
      const ps = usePageStore.getState()
      const id = ids[0] // 单块操作的锚点
      if (!ps.blocks[id]) {
        useBlockSelection.getState().clear()
        return
      }
      const mod = e.metaKey || e.ctrlKey
      const stop = (): void => {
        e.preventDefault()
        e.stopPropagation()
      }
      const joined = (): string => ids.map((b) => ps.blocks[b]?.content ?? '').filter(Boolean).join('\n\n')
      if (e.key === 'Escape') {
        stop()
        useBlockSelection.getState().clear()
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        stop()
        useBlockSelection.getState().clear()
        void deleteSerial(ids)
      } else if (e.key === 'Enter' && ids.length === 1) {
        stop()
        useBlockSelection.getState().clear()
        ps.requestFocus(id, 'end')
      } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && ids.length === 1) {
        stop()
        const order = ps.flatOrder()
        const i = order.indexOf(id)
        const next = order[e.key === 'ArrowUp' ? i - 1 : i + 1]
        if (next) useBlockSelection.getState().select(next)
      } else if (mod && (e.key === 'c' || e.key === 'C')) {
        stop()
        void navigator.clipboard.writeText(joined())
        useUiStore.getState().notify(ids.length > 1 ? `已复制 ${ids.length} 块` : '已复制块内容')
      } else if (mod && (e.key === 'x' || e.key === 'X')) {
        stop()
        void navigator.clipboard.writeText(joined()).then(() => {
          useBlockSelection.getState().clear()
          void deleteSerial(ids)
        })
        useUiStore.getState().notify(ids.length > 1 ? `已剪切 ${ids.length} 块` : '已剪切块')
      } else if (mod && (e.key === 'v' || e.key === 'V') && ids.length === 1) {
        stop()
        void navigator.clipboard.readText().then((t) => {
          const text = t.trim()
          if (!text) return
          const nid = usePageStore.getState().insertBlockAfter(id, undefined, text)
          if (nid) useBlockSelection.getState().select(nid)
        })
      } else if (mod && (e.key === 'd' || e.key === 'D')) {
        stop()
        ids.forEach((b) => ps.duplicateBlock(b))
      }
    }
    const onPointerDown = (e: PointerEvent): void => {
      const ids = useBlockSelection.getState().ids
      if (!ids.size) return
      const el = e.target as HTMLElement | null
      if (el?.closest?.('.ctx-menu')) return
      const host = el?.closest?.('[data-block-id]') as HTMLElement | null
      if (host && host.dataset.blockId && ids.has(host.dataset.blockId)) return // 点选中块自身:保留
      useBlockSelection.getState().clear() // 框选会在移动时重新选中,纯点击则保持清除
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [])

  // 空白处框选:pointerdown 记起点,移动超阈值起框,实时相交测试选中块。
  useEffect(() => {
    let start: { x: number; y: number } | null = null
    let active = false
    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0 || !isBlankTarget(e.target)) return
      start = { x: e.clientX, y: e.clientY }
      active = false
    }
    const onMove = (e: PointerEvent): void => {
      if (!start) return
      const dx = e.clientX - start.x
      const dy = e.clientY - start.y
      if (!active && Math.hypot(dx, dy) < 4) return // 阈值:区分点击与框选
      if (!active) document.body.classList.add('amx-marquee-active') // 框选期禁文本选中
      active = true
      const x = Math.min(start.x, e.clientX)
      const y = Math.min(start.y, e.clientY)
      const box = { x, y, w: Math.abs(dx), h: Math.abs(dy) }
      setRect(box)
      const hits: string[] = []
      document.querySelectorAll<HTMLElement>('.page-view [data-block-id]').forEach((el) => {
        if (el.dataset.blockId && marqueeHits(box, el.getBoundingClientRect())) hits.push(el.dataset.blockId)
      })
      useBlockSelection.getState().setMany(hits)
    }
    const onUp = (): void => {
      const wasActive = active
      start = null
      active = false
      document.body.classList.remove('amx-marquee-active')
      setRect(null)
      if (wasActive) {
        // 吞掉框选尾随的 click:否则 .page-tail 的 onClick 会误插块、别处误清选(codex P3)。
        const swallow = (ev: Event): void => {
          ev.stopPropagation()
          ev.preventDefault()
          window.removeEventListener('click', swallow, true)
        }
        window.addEventListener('click', swallow, true)
        setTimeout(() => window.removeEventListener('click', swallow, true), 0)
      }
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true) // pointercancel/系统手势也要清理,别漏 body 类(codex P2)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
      document.body.classList.remove('amx-marquee-active')
    }
  }, [])

  return rect ? (
    <div className="amx-marquee" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />
  ) : null
}
