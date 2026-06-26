/** 反馈弹窗:写问题/建议 → 自动附带本次会话日志(设置·高级那份)→ 提交 Forsion 反馈中心。 */
import React, { useState } from 'react'
import { X, MessageSquare, Loader2 } from 'lucide-react'
import { useI18n } from '../i18n'
import { buildSessionLogPayload, sessionLogFilename } from '../services/sessionLog'
import type { SessionRecord, TanguDesktopConfig } from '../types'

export const FeedbackModal: React.FC<{
  cfg: TanguDesktopConfig
  activeSession: SessionRecord | null
  onClose: () => void
}> = ({ cfg, activeSession, onClose }) => {
  const { t } = useI18n()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [msg, setMsg] = useState('')

  const submit = async (): Promise<void> => {
    const description = text.trim()
    if (!description) { setMsg(t('feedback.errEmpty')); return }
    if (!window.tangu?.submitFeedback) { setMsg(t('feedback.errUnavailable')); return }
    setBusy(true); setMsg('')
    try {
      let sessionLogJson: string | undefined
      let sessionLogName: string | undefined
      if (activeSession) {
        try {
          sessionLogJson = JSON.stringify(await buildSessionLogPayload(cfg, activeSession), null, 2)
          sessionLogName = sessionLogFilename(activeSession)
        } catch { /* 日志取不到也不挡提交 */ }
      }
      const r = await window.tangu.submitFeedback({ description, sessionLogJson, sessionLogName })
      if (!r.ok) {
        const err = r.error === 'not-logged-in' ? t('feedback.errNotLoggedIn') : (r.error || '')
        setMsg(t('feedback.errFail', { err }))
      } else {
        setDone(true)
        setMsg(r.attachmentSkipped ? t('feedback.okNoLog') : t('feedback.ok'))
        setTimeout(onClose, 1400)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="memv-modal" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <MessageSquare size={15} style={{ marginRight: 6 }} />
          {t('feedback.title')}
          <span className="grow" />
          <button className="icon-btn" onClick={onClose} title={t('settings.btn.cancel')}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>{t('feedback.label')}</label>
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('feedback.placeholder')}
              disabled={busy || done}
              style={{ width: '100%', resize: 'vertical', minHeight: 150 }}
            />
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
            {activeSession ? t('feedback.logAttached', { name: sessionLogFilename(activeSession) }) : t('feedback.noSession')}
          </div>
          {msg ? (
            <div style={{ fontSize: 12, marginTop: 8, color: done ? 'var(--accent)' : 'var(--danger)' }}>{msg}</div>
          ) : null}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <button className="btn" onClick={onClose} disabled={busy}>{t('settings.btn.cancel')}</button>
            <button className="btn primary" onClick={() => void submit()} disabled={busy || done || !text.trim()}>
              {busy ? <Loader2 size={14} className="spin" style={{ marginRight: 6 }} /> : null}
              {t('feedback.submit')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
