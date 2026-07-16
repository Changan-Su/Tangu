/** 仅 #preview：复用生产 SidebarPane / 消息 / Composer / TOC，无后端即可视觉回归。 */
import { useRef, useState } from 'react'
import type { SessionRecord, UiMessage, WorkspaceDescriptor } from '../../types'
import { EditorialMessage } from './EditorialMessage'
import { Composer2 } from './Composer2'
import { SidebarPane } from './SidebarPane'
import { EmptyState2 } from './EmptyState2'
import { RightPanel } from '../../components/RightPanel'
import { useI18n } from '../../i18n'
import './chat2.css'

const SAMPLE: UiMessage[] = [
  { id: 'u1', role: 'user', content: '帮我把 LCL 的 hash 路由分支理一下,再决定要不要抽成表。', attachments: [{ name: 'routes.md', mimeType: 'text/markdown', data: '', size: 128 }], status: 'done', timestamp: 1 },
  {
    id: 'a1', role: 'assistant', agentName: 'Tangu', status: 'done', timestamp: 2,
    systemPrompt: 'You are Tangu, a coding agent. Keep changes scoped and verify them.',
    reasoning: '先看 main.tsx 的 hash 分支顺序,确认 #/aion 与 #/tangu 不会被前面的 frame 分支吞掉,再决定是否抽一个 routes 表。整体规模还小,优先可读性。',
    toolEvents: [
      { id: 't1', name: 'read_file', arguments: 'src/main.tsx', done: true, elapsedMs: 400 },
      { id: 't2', name: 'run_shell', arguments: 'npx tsc --noEmit', done: true, isError: true, elapsedMs: 1200 },
    ],
    todos: [
      { status: 'completed', content: '读 main.tsx 路由分支' },
      { status: 'in_progress', content: '加 #/tangu 分支' },
      { status: 'pending', content: '补 Navigator 链接' },
      { status: 'pending', content: '跑 tsc / build' },
    ] as UiMessage['todos'],
    planProposal: '1. 检查 hash 分支顺序\n2. 补路由与导航\n3. 运行 typecheck / build',
    content: '看完了。当前是 5 条 `if (route.view === …)` 顺序分支,`frame` 在前、`aion/tangu` 在后,互不吞。\n\n```ts\nif (route.view === \'frame\') return <Frame/>\nif (route.view === \'tangu\') return <Tangu/>\n```\n\n规模还小,**暂不必抽表**——超过 ~8 条再说。',
  },
  {
    id: 'a2', role: 'assistant', agentName: 'Tangu', status: 'done', timestamp: 3,
    content: '我先跑一遍构建确认。',
    approvals: [{ approvalId: 'ap1', runId: 'r1', name: 'run_bash', arguments: JSON.stringify({ command: 'npm run build && npx tsc --noEmit' }), preview: 'npm run build && npx tsc --noEmit', status: 'pending' }],
  },
  {
    id: 'a3', role: 'assistant', agentName: 'Tangu', status: 'done', timestamp: 4, content: '',
    inquiries: [{ inquiryId: 'iq1', runId: 'r1', question: '路由是抽成表驱动,还是保持 if 分支?', options: ['抽成 routes 表', '保持 if 分支'], status: 'pending' }],
  },
]

const now = new Date().toISOString()
const SESSIONS: SessionRecord[] = ['重构 LCL 路由层', '周报整理', '爬虫脚本调试', '设计系统对照'].map((title, i) => ({
  id: `s${i + 1}`, title, model_id: null, archived: false, emoji: null, agent_config: null,
  project_path: '/tangu', project_name: 'Tangu 默认工作区', created_at: now, updated_at: now,
}))
const WORKSPACES: WorkspaceDescriptor[] = [
  { key: '__cloud__', name: 'Cloud 工作区', kind: 'cloud', path: null, system: true },
  { key: '/tangu', name: 'Tangu 默认工作区', kind: 'local', path: '/tangu', system: true },
]
const CFG = { backendUrl: 'http://localhost:8787', token: '', modelId: '' }

export function ChatPreview() {
  const { t } = useI18n()
  const [empty, setEmpty] = useState(false)
  const [action, setAction] = useState('')
  const streamRef = useRef<HTMLDivElement>(null)
  return (
    <div className="t2-preview-shell">
      <div className="t2-preview-side">
        <SidebarPane
          collapsed={false} sessions={SESSIONS} archivedSessions={[]} activeId="s1"
          runningIds={new Set(['s2'])} unreadIds={new Set(['s3'])} cfg={CFG} modelId="" activeSession={SESSIONS[0]}
          workspaces={WORKSPACES} onSelect={() => {}} onNewInWorkspace={() => {}} onAddWorkspace={() => {}}
          onRenameWorkspace={() => {}} onRemoveWorkspace={() => {}} onRename={() => {}} onArchive={() => {}} onDelete={() => {}}
          onOpenSettings={() => {}} showSpecial onNewChat={() => setEmpty(true)}
          onOpenWorkspace={() => {}}
        />
      </div>
      <div className="t2-preview-main t2-chat-view">
        <div className="t2-toolbar">
          <div className="t2-toolbar-title">{SESSIONS[0].title}</div>
          <span className="t2-toolbar-grow" />
          <button className="t2-pill" onClick={() => setEmpty(false)} style={{ fontWeight: empty ? 400 : 600 }}>{t('workbench.chat')}</button>
          <button className="t2-pill" onClick={() => setEmpty(true)} style={{ fontWeight: empty ? 600 : 400 }}>{t('chat.emptyHint')}</button>
          {action && <span className="t2-toolbar-pill" data-preview-action>{action}</span>}
        </div>
        {empty ? (
          <EmptyState2 />
        ) : (
          <div className="t2-stream" ref={streamRef}>
            <div className="t2-stream-inner">
              {SAMPLE.map((m) => (
                <EditorialMessage
                  key={m.id}
                  msg={m}
                  handlers={{
                    onApproval: (_id, decision, args) => setAction(`approval:${decision}:${String(args?.command || '')}`),
                    onInquiry: (_id, answer) => setAction(`inquiry:${answer}`),
                  }}
                />
              ))}
            </div>
          </div>
        )}
        <Composer2
          disabled={false}
          running={false}
          execConfig={{ execMode: 'host', approvalMode: 'auto-edit' }}
          models={null}
          modelId=""
          onModelChange={() => {}}
          planMode={false}
          onPlanModeChange={() => {}}
          onExecConfigChange={() => {}}
          onSend={async () => true}
          onStop={() => {}}
          contextWindow={200000}
          ctxTokens={84000}
          sessionTokens={12000}
          onCompact={() => {}}
        />
      </div>
      <div className="t2-preview-right">
        <div className="t2-preview-right-title">{t('panel.tab.toc')}</div>
        <RightPanel
          view="toc" cfg={CFG} sessionId="s1" sessionConfig={{}} running={false} messages={empty ? [] : SAMPLE}
          chatScrollRef={streamRef} onToast={() => {}} onOpenPreview={() => {}} subChats={[]}
        />
      </div>
    </div>
  )
}
