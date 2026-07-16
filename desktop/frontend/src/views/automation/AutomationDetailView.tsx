/**
 * 自动化 Space 主区:构建器开 → AutomationBuilder;否则按左栏选中项——
 * 顶部自动化卡(触发/对象/执行者/上次运行/深度配置跳设置)+ 下方最近运行内容:
 *   Muse / agent 规则 → 该会话的只读消息列表(复用 appStore.loadSessionHistory 链,
 *     recordToUi 已归一 role='model' 坑;简版自渲染,不拖 ChatView 的交互耦合);
 *   Historian → special_agent_log 活动流;
 *   Muse 老路规则(无 agentSlug)→ 提示内容在「Muse 巡检」的会话里。
 */
import React, { useEffect } from 'react'
import { CalendarClock, History, Settings, Sparkles, Zap } from 'lucide-react'
import { useApp } from '../../stores/appStore'
import { useAutomation, sessionForTrigger } from '../../stores/automationStore'
import { getHistorianActivity } from '../../services/backendService'
import { useI18n } from '../../i18n'
import { Markdown } from '../../components/Markdown'
import { condText, fmtTime, runnerName } from './lib'
import { AutomationBuilder } from './AutomationBuilder'
import type { HistorianActivityItem } from '../../types'
import './automation.css'

/** 某会话的只读消息列表(倒序会话尾部=最近一次运行;流式中的消息会随轮询/事件更新)。 */
const SessionTranscript: React.FC<{ sessionId: string }> = ({ sessionId }) => {
  const { t } = useI18n()
  const messages = useApp((s) => s.messagesBySession[sessionId])
  useEffect(() => {
    void useApp.getState().loadSessionHistory(sessionId)
  }, [sessionId])
  if (!messages?.length) return <div className="auto-runs-empty">{t('automation.transcript.empty')}</div>
  // 只展示尾部 30 条(常驻会话随命中累积,详情页看最近即可)
  const tail = messages.slice(-30)
  return (
    <div>
      {tail.map((m) => (
        <div key={m.id} className="auto-msg">
          <div className="auto-msg-role">{m.role === 'user' ? t('automation.transcript.trigger') : t('automation.transcript.agent')}</div>
          <div className={`auto-msg-body ${m.role === 'user' ? 'user' : ''}`}>
            {m.role === 'user' ? <span style={{ whiteSpace: 'pre-wrap' }}>{m.content}</span> : <Markdown content={m.content || ''} />}
          </div>
          {!!m.toolEvents?.length && (
            <div className="auto-msg-tools">
              {t('automation.transcript.tools', { n: String(m.toolEvents.length) })}: {m.toolEvents.slice(0, 8).map((e) => e.name).join(', ')}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

const HistorianFeed: React.FC = () => {
  const { t } = useI18n()
  const cfg = useApp((s) => s.cfg)
  const [items, setItems] = React.useState<HistorianActivityItem[]>([])
  useEffect(() => {
    let alive = true
    const pull = (): void => void getHistorianActivity(cfg, 50).then((a) => alive && setItems(a)).catch(() => {})
    pull()
    const timer = setInterval(pull, 8000)
    return () => { alive = false; clearInterval(timer) }
  }, [cfg])
  if (!items.length) return <div className="auto-runs-empty">{t('automation.transcript.empty')}</div>
  return (
    <div>
      {items.map((it) => (
        <div key={it.id} className="auto-msg">
          <div className="auto-msg-role">{fmtTime(it.created_at)} · {it.action}</div>
          <div className="auto-msg-body">{it.detail}</div>
        </div>
      ))}
    </div>
  )
}

export const AutomationDetailView: React.FC = () => {
  const { t } = useI18n()
  const agentDefs = useApp((s) => s.agentDefs)
  const st = useAutomation()

  if (st.builder) {
    const editing = st.builder.editingId ? st.triggers.find((x) => x.id === st.builder!.editingId) : undefined
    return (
      <div className="auto-detail">
        <AutomationBuilder key={st.builder.editingId || 'new'} editing={editing} />
      </div>
    )
  }

  const sel = st.sel
  if (!sel) return <div className="auto-detail-empty">{t('automation.detail.empty')}</div>

  if (sel.kind === 'muse') {
    const muse = st.specialCfg?.muse
    return (
      <div className="auto-detail">
        <div className="auto-card">
          <div className="auto-card-head">
            <Sparkles size={17} />
            <div className="auto-card-title">{t('automation.muse.title')}</div>
            <button className="btn ghost sm" onClick={() => useApp.getState().openSettings('agents')}>
              <Settings size={12} /> {t('automation.deepConfig')}
            </button>
          </div>
          <div className="auto-facts">
            <span className="auto-fact"><b>{t('automation.fact.trigger')}</b>{muse ? t('automation.muse.trigger', { min: String(muse.supervisorPollMinutes) }) : '—'}</span>
            <span className="auto-fact"><b>{t('automation.fact.action')}</b>{t('automation.muse.action')}</span>
            <span className="auto-fact"><b>{t('automation.fact.lastRun')}</b>{fmtTime(st.museStatus?.lastCycleAt)}</span>
          </div>
        </div>
        <div className="auto-transcript-head">{t('automation.detail.latest')}</div>
        {st.museStatus?.sessionId
          ? <SessionTranscript sessionId={st.museStatus.sessionId} />
          : <div className="auto-runs-empty">{t('automation.transcript.empty')}</div>}
      </div>
    )
  }

  if (sel.kind === 'historian') {
    const h = st.specialCfg?.historian
    return (
      <div className="auto-detail">
        <div className="auto-card">
          <div className="auto-card-head">
            <History size={17} />
            <div className="auto-card-title">{t('automation.historian.title')}</div>
            <button className="btn ghost sm" onClick={() => useApp.getState().openSettings('agents')}>
              <Settings size={12} /> {t('automation.deepConfig')}
            </button>
          </div>
          <div className="auto-facts">
            <span className="auto-fact"><b>{t('automation.fact.trigger')}</b>{h ? t('automation.historian.trigger', { n: String(h.everyRounds) }) : '—'}</span>
            <span className="auto-fact"><b>{t('automation.fact.action')}</b>{t('automation.historian.action')}</span>
          </div>
        </div>
        <div className="auto-transcript-head">{t('automation.detail.recent')}</div>
        <HistorianFeed />
      </div>
    )
  }

  if (sel.kind === 'schedule') {
    const sched = st.schedules.find((s) => s.slug === sel.slug)
    const en = sched?.entries.find((e) => e.id === sel.rowId)
    if (!sched || !en) return <div className="auto-detail-empty">{t('automation.detail.empty')}</div>
    const sessionId = sessionForTrigger(st.autoSessions, `sched:${sel.slug}:${sel.rowId}`)
    return (
      <div className="auto-detail">
        <div className="auto-card">
          <div className="auto-card-head">
            <CalendarClock size={17} />
            <div className="auto-card-title">{en.name}</div>
          </div>
          <div className="auto-facts">
            <span className="auto-fact"><b>{t('automation.fact.trigger')}</b>{en.date.replace('/', ' → ').replace(/T/g, ' ')}{en.repeat ? ` · ${t('automation.schedule.every', { ivl: en.repeat })}` : ` · ${t('automation.schedule.once')}`}</span>
            <span className="auto-fact"><b>{t('automation.fact.runner')}</b>{sched.name}</span>
            {en.prompt && <span className="auto-fact"><b>{t('automation.fact.prompt')}</b>{en.prompt.slice(0, 80)}</span>}
            {en.description && <span className="auto-fact"><b>{t('automation.fact.desc')}</b>{en.description.slice(0, 80)}</span>}
            <span className="auto-fact"><b>{t('automation.fact.lastRun')}</b>{fmtTime(en.lastRun || null)}</span>
          </div>
        </div>
        <div className="auto-transcript-head">{t('automation.detail.latest')}</div>
        {sessionId
          ? <SessionTranscript sessionId={sessionId} />
          : <div className="auto-runs-empty">{t('automation.trigger.neverFired')}</div>}
      </div>
    )
  }

  const tr = st.triggers.find((x) => x.id === sel.triggerId)
  if (!tr) return <div className="auto-detail-empty">{t('automation.detail.empty')}</div>
  const sessionId = sessionForTrigger(st.autoSessions, tr.id)
  return (
    <div className="auto-detail">
      <div className="auto-card">
        <div className="auto-card-head">
          <Zap size={17} />
          <div className="auto-card-title">{tr.desc}</div>
          <button className="btn ghost sm" onClick={() => st.openBuilder(tr.id)}>{t('common.edit')}</button>
        </div>
        <div className="auto-facts">
          <span className="auto-fact"><b>{t('automation.fact.trigger')}</b>{condText(t, tr.cond)}</span>
          <span className="auto-fact"><b>{t('automation.fact.runner')}</b>{runnerName(agentDefs, tr.agentSlug)}</span>
          {tr.prompt && <span className="auto-fact"><b>{t('automation.fact.prompt')}</b>{tr.prompt.slice(0, 80)}</span>}
          <span className="auto-fact"><b>{t('automation.fact.cooldown')}</b>{tr.cooldownHours}h</span>
          <span className="auto-fact"><b>{t('automation.fact.lastRun')}</b>{fmtTime(tr.lastFiredAt)}</span>
        </div>
      </div>
      <div className="auto-transcript-head">{t('automation.detail.latest')}</div>
      {tr.agentSlug
        ? sessionId
          ? <SessionTranscript sessionId={sessionId} />
          : <div className="auto-runs-empty">{t('automation.trigger.neverFired')}</div>
        : (
          <div className="auto-runs-empty">
            {t('automation.trigger.museNote')}{' '}
            <a style={{ cursor: 'pointer', color: 'var(--accent-ink, var(--accent))' }} onClick={() => st.setSel({ kind: 'muse' })}>
              {t('automation.muse.title')}
            </a>
          </div>
        )}
    </div>
  )
}
