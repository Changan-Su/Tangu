/**
 * 询问卡(ask_user / exit_plan_mode):问题 + 选项按钮 + 自由输入;answered/expired 显示灰态。
 * 视觉对齐 ApprovalCard(边框卡片,token CSS)。
 */
import React, { useState } from 'react'
import { CircleHelp, Send, CheckSquare, Square, Loader2 } from 'lucide-react'
import type { InquiryRequest, TodoItem } from '../types'
import { useI18n } from '../i18n'

export const InquiryCard: React.FC<{
  req: InquiryRequest
  onAnswer: (answer: string) => void
}> = ({ req, onAnswer }) => {
  const { t } = useI18n()
  const [draft, setDraft] = useState('')
  const pending = req.status === 'pending'

  return (
    <div className={`inquiry-card${pending ? '' : ' resolved'}`}>
      <div className="inquiry-q">
        <CircleHelp size={14} />
        {req.question}
      </div>
      {pending ? (
        <>
          {req.options.length > 0 && (
            <div className="inquiry-opts">
              {req.options.map((opt, i) => (
                <button key={i} className="btn ghost sm" style={{ justifyContent: 'flex-start' }} onClick={() => onAnswer(opt)}>
                  {i + 1}. {opt}
                </button>
              ))}
            </div>
          )}
          <div className="inquiry-input">
            <input
              type="text"
              className="inline-input"
              value={draft}
              placeholder={req.options.length ? t('inquiry.placeholderOrFree') : t('inquiry.placeholderAnswer')}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && draft.trim() && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  onAnswer(draft.trim())
                }
              }}
            />
            <button className="btn primary sm" disabled={!draft.trim()} onClick={() => draft.trim() && onAnswer(draft.trim())}>
              <Send size={12} /> {t('inquiry.answer')}
            </button>
          </div>
        </>
      ) : (
        <div className="inquiry-resolved">
          {req.status === 'answered' ? t('inquiry.answered', { answer: req.answer ?? '' }) : t('inquiry.expired')}
        </div>
      )}
    </div>
  )
}

/** 计划卡:计划模式下 agent 提交的实施计划(plan 事件)。 */
export const PlanCard: React.FC<{ plan: string }> = ({ plan }) => {
  const { t } = useI18n()
  return (
    <div className="plan-card">
      <div className="tg-card-title">📋 {t('inquiry.planProposal')}</div>
      <pre className="plan-pre">{plan}</pre>
    </div>
  )
}

/** 任务清单(todo 事件;对齐 Claude TodoWrite 的实时显示)。 */
export const TodoList: React.FC<{ todos: TodoItem[] }> = ({ todos }) => {
  const { t: tr } = useI18n()
  const done = todos.filter((t) => t.status === 'completed').length
  return (
    <div className="todo-card">
      <div className="tg-card-title">
        ✓ {tr('inquiry.todoList')} <span className="tg-count">({done}/{todos.length})</span>
      </div>
      <div className="todo-rows">
        {todos.map((t, i) => (
          <div key={i} className={`todo-row ${t.status}`}>
            <span className={`todo-mark ${t.status}`}>
              {t.status === 'completed' ? (
                <CheckSquare size={14} />
              ) : t.status === 'in_progress' ? (
                <Loader2 size={14} className="spin" />
              ) : (
                <Square size={14} />
              )}
            </span>
            <span className="todo-text">{t.content}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
