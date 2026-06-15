/**
 * 聊天流:消息列表(markdown/思考块/工具卡片/审批卡片/计划卡/todolist)+ 智能吸底滚动。
 * 吸底语义对齐 AI Studio:用户上滑即释放自动吸底(流式照样可往上看历史),回到底部自动恢复;
 * 释放期间右下角浮出「跳到底部」按钮,点一下平滑回底并重新吸附。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown } from 'lucide-react'
import type { UiMessage } from '../types'
import { Markdown } from './Markdown'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolCallCard } from './ToolCallCard'
import { ApprovalCard } from './ApprovalCard'
import { InquiryCard, PlanCard, TodoList } from './InquiryCard'
import { BrandLogo } from './BrandLogo'

export const ChatArea: React.FC<{
  messages: UiMessage[]
  containerRef?: React.RefObject<HTMLDivElement | null> // 由 App 提供以与右侧「目录」共享滚动容器
  onApproval: (runOwnerMessageId: string, approvalId: string, action: 'approve' | 'approve_always' | 'reject', argsOverride?: Record<string, any>) => void
  onInquiry: (runOwnerMessageId: string, inquiryId: string, answer: string) => void
}> = ({ messages, containerRef, onApproval, onInquiry }) => {
  const internalRef = useRef<HTMLDivElement>(null)
  const ref = containerRef ?? internalRef
  const followBottom = useRef(true) // 是否自动吸底(用户上滑释放,回底恢复)
  const lastTop = useRef(0)
  // 程序化滚动后短暂(100ms)忽略「上滑」判定:scrollTo()/scrollTop= 自身会触发 scroll 事件,
  // 否则会被误读成用户上滑而错误释放跟随——这正是旧版「上滑仍被强拽回底」的根因。
  const programmaticScrollAt = useRef(0)
  const streamingNodeRef = useRef<HTMLDivElement | null>(null)
  const [showJump, setShowJump] = useState(false)

  // 正在流式输出的消息 id(吸底锚点;无则非流式,走一次性 snap)。
  const streamingId = useMemo(() => messages.find((m) => m.status === 'streaming')?.id ?? null, [messages])

  const scrollToBottom = useCallback((smooth = false) => {
    const el = ref.current
    if (!el) return
    programmaticScrollAt.current = performance.now()
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    lastTop.current = el.scrollHeight
    followBottom.current = true
    setShowJump(false)
  }, [ref])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onScroll = () => {
      const top = el.scrollTop
      const scrolledUp = top < lastTop.current - 2
      lastTop.current = top
      const dist = el.scrollHeight - top - el.clientHeight
      const atBottom = dist < 80
      const sinceProgrammatic = performance.now() - programmaticScrollAt.current
      // 仅当「用户上滑且未到底,且不是刚刚的程序化滚动余波」才释放跟随。
      if (scrolledUp && !atBottom && sinceProgrammatic > 100) {
        followBottom.current = false
      } else if (atBottom) {
        followBottom.current = true
      }
      setShowJump(!atBottom)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [ref])

  // 流式中:用 ResizeObserver 盯住「流式消息节点」的实际布局增长来吸底(而非靠 messages 引用
  // 每 token 变化触发的 effect——那会在布局未稳时滚动,产生上下抖动)。instant 滚动避免平滑动画
  // 互相追逐。仅在仍吸底时跟随,绝不抢用户已上滑的视图。
  useEffect(() => {
    if (!streamingId) return
    const node = streamingNodeRef.current
    const el = ref.current
    if (!node || !el) return
    const follow = () => {
      if (!followBottom.current) return
      programmaticScrollAt.current = performance.now()
      el.scrollTop = el.scrollHeight
      lastTop.current = el.scrollTop
    }
    follow() // 流式气泡首次挂载时先吸一次
    const ro = new ResizeObserver(() => requestAnimationFrame(follow))
    ro.observe(node)
    return () => ro.disconnect()
  }, [streamingId, ref])

  // 非流式的一次性吸底(新用户消息 / 工具结果插入)。流式期间交给上面的 ResizeObserver。
  useEffect(() => {
    if (streamingId) return
    if (!followBottom.current) return
    const el = ref.current
    if (!el) return
    programmaticScrollAt.current = performance.now()
    el.scrollTop = el.scrollHeight
    lastTop.current = el.scrollTop
  }, [messages, streamingId, ref])

  if (!messages.length) {
    return (
      <div className="empty-state">
        <BrandLogo size={56} />
        <div className="empty-title">纸上得来终觉浅,绝知此事要躬行。</div>
        <div style={{ fontSize: 12.5 }}>输入一句话,让 Tangu 开始干活。</div>
      </div>
    )
  }

  return (
    <div className="chat-area">
      <div className="chat-stream" ref={ref}>
        <div className="stream-inner">
        {messages.map((m) =>
          m.role === 'user' ? (
            <div
              className="msg-row user"
              key={m.id}
              id={`tocmsg-${m.id}`}
              data-toc-msg-role="user"
              data-toc-title={m.content}
            >
              <div className="msg-user-bubble">
                {m.attachments?.length ? (
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 4 }}>
                    📎 {m.attachments.map((a) => a.name).join(', ')}
                  </div>
                ) : null}
                {m.content}
              </div>
            </div>
          ) : (
            <div
              className="msg-row msg-assistant"
              key={m.id}
              id={`tocmsg-${m.id}`}
              data-toc-msg-role="assistant"
              ref={m.id === streamingId ? streamingNodeRef : undefined}
            >
              <div className="msg-role">TANGU</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {m.reasoning ? <ThinkingBlock reasoning={m.reasoning} streaming={m.status === 'streaming' && !m.content} /> : null}
                {m.toolEvents?.map((t) => <ToolCallCard key={t.id} ev={t} />)}
                {m.approvals?.map((a) => (
                  <ApprovalCard
                    key={a.approvalId}
                    req={a}
                    onDecide={(action, argsOverride) => onApproval(m.id, a.approvalId, action, argsOverride)}
                  />
                ))}
                {m.planProposal ? <PlanCard plan={m.planProposal} /> : null}
                {m.todos?.length ? <TodoList todos={m.todos} /> : null}
                {m.inquiries?.map((q) => (
                  <InquiryCard key={q.inquiryId} req={q} onAnswer={(answer) => onInquiry(m.id, q.inquiryId, answer)} />
                ))}
                {m.content ? (
                  <div className={`msg-content${m.status === 'streaming' ? ' streaming-caret' : ''}`}>
                    <Markdown content={m.content} anchorPrefix={`toc-${m.id}`} />
                  </div>
                ) : m.status === 'streaming' && !m.toolEvents?.length && !m.reasoning ? (
                  <div style={{ color: 'var(--text-faint)', fontSize: 13 }} className="streaming-caret">
                    思考中
                  </div>
                ) : null}
                {m.error ? <div className="msg-error">{m.error === 'aborted' ? '已停止。' : m.error}</div> : null}
              </div>
            </div>
          ),
        )}
        </div>
      </div>
      {showJump && (
        <button className="jump-bottom" title="跳到底部" onClick={() => scrollToBottom(true)}>
          <ArrowDown size={16} />
        </button>
      )}
    </div>
  )
}
