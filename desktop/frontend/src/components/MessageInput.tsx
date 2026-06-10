/**
 * 输入区:auto-grow textarea + 附件(base64) + 发送/停止 + 执行模式/审批档选择器(host 能力)。
 * auto-grow 模式对齐 AI Studio MessageInput(scrollHeight 撑高,max-height 截断)。
 */
import React, { useRef, useState } from 'react'
import { Send, Square, Paperclip, X, Monitor, Cloud } from 'lucide-react'
import type { AgentConfig, Attachment } from '../types'

const MAX_ATTACH_BYTES = 5 * 1024 * 1024

export const MessageInput: React.FC<{
  disabled: boolean
  running: boolean
  execConfig: Pick<AgentConfig, 'execMode' | 'approvalMode'>
  onExecConfigChange: (patch: Pick<AgentConfig, 'execMode' | 'approvalMode'>) => void
  /** 返回是否已受理:失败(连接/参数错)返回 false,草稿保留不清空。 */
  onSend: (text: string, attachments: Attachment[]) => Promise<boolean>
  onStop: () => void
}> = ({ disabled, running, execConfig, onExecConfigChange, onSend, onStop }) => {
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const autoGrow = () => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`
  }

  const send = () => {
    const text = draft.trim()
    if (!text || disabled || running) return
    void onSend(text, attachments).then((accepted) => {
      if (!accepted) return // 失败保留草稿
      setDraft('')
      setAttachments([])
      requestAnimationFrame(autoGrow)
    })
  }

  const pickFiles = async (files: FileList | null) => {
    if (!files) return
    const next: Attachment[] = []
    for (const f of Array.from(files)) {
      if (f.size > MAX_ATTACH_BYTES) continue
      const buf = await f.arrayBuffer()
      let bin = ''
      const bytes = new Uint8Array(buf)
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      }
      next.push({ name: f.name, mimeType: f.type || 'application/octet-stream', data: btoa(bin), size: f.size })
    }
    setAttachments((prev) => [...prev, ...next])
  }

  const isHost = execConfig.execMode === 'host'
  const approvalLabel = { readonly: '只读·全审批', 'auto-edit': '自动编辑', 'full-auto': '全自动' } as const

  return (
    <div className="composer">
      <div className="composer-inner">
        <div className="composer-box">
          {attachments.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
              {attachments.map((a, i) => (
                <span className="attach-chip" key={`${a.name}-${i}`}>
                  <span>{a.name}</span>
                  <button onClick={() => setAttachments(attachments.filter((_, j) => j !== i))}>
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <textarea
            ref={taRef}
            rows={1}
            value={draft}
            placeholder={disabled ? '先在设置里连接后端…' : '给 Tangu 派个活(Enter 发送,Shift+Enter 换行)'}
            disabled={disabled}
            onChange={(e) => {
              setDraft(e.target.value)
              autoGrow()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                send()
              }
            }}
          />
          <div className="composer-bar">
            <button className="icon-btn" title="添加附件" onClick={() => fileRef.current?.click()}>
              <Paperclip size={15} />
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                void pickFiles(e.target.files)
                e.target.value = ''
              }}
            />
            <button
              className="mode-select"
              title="执行环境:云沙箱(隔离)/ 本机(真实文件系统,需审批)"
              onClick={() =>
                onExecConfigChange(
                  isHost
                    ? { execMode: 'sandbox', approvalMode: execConfig.approvalMode }
                    : { execMode: 'host', approvalMode: execConfig.approvalMode || 'auto-edit' },
                )
              }
            >
              {isHost ? <Monitor size={13} /> : <Cloud size={13} />}
              {isHost ? '本机' : '云沙箱'}
            </button>
            {isHost && (
              <button
                className="mode-select"
                title="审批档:只读(写文件/跑命令都审)/ 自动编辑(只审命令)/ 全自动"
                onClick={() => {
                  const order: AgentConfig['approvalMode'][] = ['readonly', 'auto-edit', 'full-auto']
                  const cur = order.indexOf(execConfig.approvalMode || 'auto-edit')
                  onExecConfigChange({ execMode: 'host', approvalMode: order[(cur + 1) % 3] })
                }}
              >
                {approvalLabel[execConfig.approvalMode || 'auto-edit']}
              </button>
            )}
            <span className="grow" />
            {running ? (
              <button className="btn danger sm" onClick={onStop}>
                <Square size={12} /> 停止
              </button>
            ) : (
              <button className="btn primary sm" onClick={send} disabled={disabled || !draft.trim()}>
                <Send size={13} /> 发送
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
