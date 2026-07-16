/**
 * 自动化 Space 右栏:选中项的触发记录。
 *   Muse / agent 规则 → 该常驻会话的历次 run(GET /agent/special/automation/runs,muse 会话通用);
 *   Historian → special_agent_log 活动流;
 *   Muse 老路规则 → 记录并在「Muse 巡检」的会话里(提示)。
 * v1 行只带元信息(时间/状态/tokens/error),不按 run 切片消息——主区恒显完整会话尾部。
 */
import React, { useEffect, useState } from 'react'
import { useApp } from '../../stores/appStore'
import { useAutomation, sessionForTrigger } from '../../stores/automationStore'
import { getAutomationRuns, getHistorianActivity } from '../../services/backendService'
import { useI18n } from '../../i18n'
import { fmtTime } from './lib'
import type { AutomationRunInfo, HistorianActivityItem } from '../../types'
import './automation.css'

const dotClass = (status: string): string =>
  status === 'running' || status === 'queued' ? 'running' : status === 'completed' || status === 'done' ? 'on' : 'off'

const RunsList: React.FC<{ sessionId: string }> = ({ sessionId }) => {
  const { t } = useI18n()
  const cfg = useApp((s) => s.cfg)
  const nonce = useAutomation((s) => s.refreshNonce)
  const [runs, setRuns] = useState<AutomationRunInfo[]>([])
  useEffect(() => {
    let alive = true
    const pull = (): void => void getAutomationRuns(cfg, sessionId).then((r) => alive && setRuns(r)).catch(() => {})
    pull()
    const timer = setInterval(pull, 8000)
    return () => { alive = false; clearInterval(timer) }
  }, [cfg, sessionId, nonce])
  if (!runs.length) return <div className="auto-runs-empty">{t('automation.runs.empty')}</div>
  return (
    <>
      {runs.map((r) => (
        <div key={r.id} className="auto-run-row" title={r.error || r.status}>
          <span className={`auto-dot ${dotClass(r.status)}`} />
          <span className="auto-run-time">{fmtTime(r.created_at)}</span>
          <span className="auto-run-meta">
            {r.error ? r.error.slice(0, 40) : r.tokens_total ? `${(r.tokens_total / 1000).toFixed(1)}k tok` : r.status}
          </span>
        </div>
      ))}
    </>
  )
}

const HistorianList: React.FC = () => {
  const { t } = useI18n()
  const cfg = useApp((s) => s.cfg)
  const [items, setItems] = useState<HistorianActivityItem[]>([])
  useEffect(() => {
    let alive = true
    const pull = (): void => void getHistorianActivity(cfg, 50).then((a) => alive && setItems(a)).catch(() => {})
    pull()
    const timer = setInterval(pull, 8000)
    return () => { alive = false; clearInterval(timer) }
  }, [cfg])
  if (!items.length) return <div className="auto-runs-empty">{t('automation.runs.empty')}</div>
  return (
    <>
      {items.map((it) => (
        <div key={it.id} className="auto-run-row" title={it.detail}>
          <span className="auto-dot on" />
          <span className="auto-run-time">{fmtTime(it.created_at)}</span>
          <span className="auto-run-meta">{it.action}</span>
        </div>
      ))}
    </>
  )
}

export const AutomationRunsView: React.FC = () => {
  const { t } = useI18n()
  const st = useAutomation()
  const sel = st.sel

  let body: React.ReactNode = <div className="auto-runs-empty">{t('automation.runs.pick')}</div>
  if (sel?.kind === 'muse') {
    body = st.museStatus?.sessionId ? <RunsList sessionId={st.museStatus.sessionId} /> : <div className="auto-runs-empty">{t('automation.runs.empty')}</div>
  } else if (sel?.kind === 'historian') {
    body = <HistorianList />
  } else if (sel?.kind === 'trigger') {
    const tr = st.triggers.find((x) => x.id === sel.triggerId)
    if (tr?.agentSlug) {
      const sid = sessionForTrigger(st.autoSessions, tr.id)
      body = sid ? <RunsList sessionId={sid} /> : <div className="auto-runs-empty">{t('automation.trigger.neverFired')}</div>
    } else {
      body = <div className="auto-runs-empty">{t('automation.trigger.museNote')}</div>
    }
  } else if (sel?.kind === 'schedule') {
    const sid = sessionForTrigger(st.autoSessions, `sched:${sel.slug}:${sel.rowId}`)
    body = sid ? <RunsList sessionId={sid} /> : <div className="auto-runs-empty">{t('automation.trigger.neverFired')}</div>
  }

  return <div className="auto-runs">{body}</div>
}
