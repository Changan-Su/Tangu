/**
 * host-exec 审批卡片(approval_request 事件 → 内嵌聊天流;run_bash 命令可编辑后批准)。
 * 已兑现(approval_result/410)置灰。
 */
import React, { useState } from 'react'
import { ShieldQuestion, Check, CheckCheck, X } from 'lucide-react'
import type { ApprovalRequest } from '../types'

export const ApprovalCard: React.FC<{
  req: ApprovalRequest
  onDecide: (action: 'approve' | 'approve_always' | 'reject', argsOverride?: Record<string, any>) => void
}> = ({ req, onDecide }) => {
  const isBash = req.name === 'run_bash'
  const initialCmd = (() => {
    if (!isBash || !req.arguments) return ''
    try { return String(JSON.parse(req.arguments).command ?? '') } catch { return '' }
  })()
  const [cmd, setCmd] = useState(initialCmd)
  const resolved = req.status !== 'pending'

  const decide = (action: 'approve' | 'approve_always' | 'reject') => {
    if (resolved) return
    const argsOverride = isBash && cmd.trim() && cmd !== initialCmd ? { command: cmd } : undefined
    onDecide(action, action === 'reject' ? undefined : argsOverride)
  }

  return (
    <div className={`approval-card${resolved ? ' resolved' : ''}`}>
      <div className="approval-title">
        <ShieldQuestion size={15} style={{ color: 'var(--accent)' }} />
        {req.name} 请求执行
        {resolved && (
          <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-faint)' }}>
            {req.status === 'approved' ? '· 已批准' : req.status === 'rejected' ? '· 已拒绝' : '· 已失效'}
          </span>
        )}
      </div>
      {isBash && !resolved ? (
        <textarea
          className="approval-edit"
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          rows={Math.min(6, Math.max(1, cmd.split('\n').length))}
          spellCheck={false}
        />
      ) : (
        <div className="approval-preview">{req.preview}</div>
      )}
      {!resolved && (
        <div className="approval-actions">
          <button className="btn primary sm" onClick={() => decide('approve')}>
            <Check size={13} /> 批准
          </button>
          <button className="btn ghost sm" onClick={() => decide('approve_always')}>
            <CheckCheck size={13} /> 本会话总是允许
          </button>
          <button className="btn danger sm" onClick={() => decide('reject')}>
            <X size={13} /> 拒绝
          </button>
        </div>
      )}
    </div>
  )
}
