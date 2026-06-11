/**
 * 聊天流:消息列表(markdown/思考块/工具卡片/审批卡片)+ 自动吸底滚动。
 */
import React, { useEffect, useRef } from 'react'
import type { UiMessage } from '../types'
import { Markdown } from './Markdown'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolCallCard } from './ToolCallCard'
import { ApprovalCard } from './ApprovalCard'
import { InquiryCard, PlanCard } from './InquiryCard'
import { BrandLogo } from './BrandLogo'

export const ChatArea: React.FC<{
  messages: UiMessage[]
  onApproval: (runOwnerMessageId: string, approvalId: string, action: 'approve' | 'approve_always' | 'reject', argsOverride?: Record<string, any>) => void
  onInquiry: (runOwnerMessageId: string, inquiryId: string, answer: string) => void
}> = ({ messages, onApproval, onInquiry }) => {
  const ref = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onScroll = () => {
      stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const el = ref.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [messages])

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
    <div className="chat-stream" ref={ref}>
      <div className="stream-inner">
        {messages.map((m) =>
          m.role === 'user' ? (
            <div className="msg-row user" key={m.id}>
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
            <div className="msg-row msg-assistant" key={m.id}>
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
                {m.inquiries?.map((q) => (
                  <InquiryCard key={q.inquiryId} req={q} onAnswer={(answer) => onInquiry(m.id, q.inquiryId, answer)} />
                ))}
                {m.content ? (
                  <div className={`msg-content${m.status === 'streaming' ? ' streaming-caret' : ''}`}>
                    <Markdown content={m.content} />
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
  )
}
