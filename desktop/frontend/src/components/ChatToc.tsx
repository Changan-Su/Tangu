/**
 * 会话目录(右侧面板 tab):把聊天流扫成一份可点击跳转的大纲。
 *
 * 策略(对齐 AI Studio 的 ChatTOC,但落在右栏而非浮层):
 *   - 锚点由 ChatArea 渲染:用户消息行带 data-toc-msg-role="user"(标题=data-toc-title),
 *     assistant 正文标题由 Markdown 渲染成 [data-toc-level] + 稳定 id。
 *   - 用一次 querySelectorAll 同时取两类节点 → 天然按文档(=视觉)顺序排好,无需手工排序。
 *   - MutationObserver 在流式输出时增量重扫(rAF 合并),不靠父组件每 token 传版本号。
 *   - IntersectionObserver 高亮当前可视小节;点击用 getBoundingClientRect 精确滚到目标。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { MessageSquare, Hash } from 'lucide-react'

interface TocItem {
  id: string
  level: number // 0 = 用户提问(turn);1/2/3 = assistant 标题层级
  kind: 'user' | 'heading'
  text: string
}

export const ChatToc: React.FC<{
  containerRef: React.RefObject<HTMLDivElement | null>
  scanTrigger?: number // 变化即强制重扫(传 messages.length 兜底,防 MutationObserver 漏批)
}> = ({ containerRef, scanTrigger }) => {
  const [items, setItems] = useState<TocItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  const scan = useCallback(() => {
    const root = containerRef.current
    if (!root) {
      setItems((prev) => (prev.length ? [] : prev))
      return
    }
    const nodes = root.querySelectorAll<HTMLElement>('[data-toc-msg-role="user"], [data-toc-level]')
    const list: TocItem[] = []
    nodes.forEach((n) => {
      if (!n.id) return
      if (n.dataset.tocMsgRole === 'user') {
        const text = (n.dataset.tocTitle || n.textContent || '').trim()
        if (text) list.push({ id: n.id, level: 0, kind: 'user', text })
      } else if (n.dataset.tocLevel) {
        const text = (n.textContent || '').trim()
        if (text) list.push({ id: n.id, level: Number(n.dataset.tocLevel) || 1, kind: 'heading', text })
      }
    })
    setItems((prev) =>
      prev.length === list.length && prev.every((p, i) => p.id === list[i].id && p.text === list[i].text)
        ? prev
        : list,
    )
  }, [containerRef])

  // 初次扫 + 流式增量重扫(MutationObserver,rAF 合并),scanTrigger 兜底。
  useEffect(() => {
    scan()
    const root = containerRef.current
    if (!root) return
    let raf = 0
    const obs = new MutationObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(scan)
    })
    obs.observe(root, { childList: true, subtree: true, characterData: true })
    return () => {
      cancelAnimationFrame(raf)
      obs.disconnect()
    }
  }, [scan, containerRef, scanTrigger])

  // 当前可视小节高亮(rootMargin 偏向视口顶部,符合"正在看哪段"的直觉)。
  useEffect(() => {
    const root = containerRef.current
    if (!root || items.length === 0) return
    const visible = new Set<string>()
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id)
          else visible.delete(e.target.id)
        }
        const next = items.find((i) => visible.has(i.id))
        if (next) setActiveId(next.id)
      },
      { root, rootMargin: '0px 0px -65% 0px', threshold: 0 },
    )
    for (const i of items) {
      try {
        const el = root.querySelector(`#${CSS.escape(i.id)}`)
        if (el) obs.observe(el)
      } catch {
        /* CSS.escape 不可用 → 跳过 */
      }
    }
    return () => obs.disconnect()
  }, [items, containerRef])

  const jumpTo = useCallback(
    (id: string) => {
      const root = containerRef.current
      if (!root) return
      let el: HTMLElement | null = null
      try {
        el = root.querySelector<HTMLElement>(`#${CSS.escape(id)}`)
      } catch {
        return
      }
      if (!el) return
      // getBoundingClientRect 差值 + 当前 scrollTop:不受 offsetParent 定位影响,稳。
      const top = el.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop
      root.scrollTo({ top: Math.max(0, top - 16), behavior: 'smooth' })
      setActiveId(id)
    },
    [containerRef],
  )

  if (items.length === 0) {
    return <div className="panel-note">暂无可跳转的内容。对话开始后,这里会列出每轮提问与回复中的小节标题。</div>
  }

  return (
    <div className="toc-list">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          className={`toc-item${it.kind === 'user' ? ' user' : ''}${activeId === it.id ? ' active' : ''}`}
          style={{ paddingLeft: 6 + it.level * 14 }}
          title={it.text}
          onClick={() => jumpTo(it.id)}
        >
          {it.kind === 'user' ? (
            <MessageSquare size={12} className="toc-ico" />
          ) : (
            <Hash size={11} className="toc-ico" />
          )}
          <span className="toc-text">{it.text}</span>
        </button>
      ))}
    </div>
  )
}
