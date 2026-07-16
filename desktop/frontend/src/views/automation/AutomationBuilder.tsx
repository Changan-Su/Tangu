/**
 * 可视化新建/编辑自动化(Dify 简约版):触发 → 对象 → 动作 三张卡竖排 + CSS 连接线,
 * 与 MuseTrigger schema 一一对应(线性链,刻意不做自由画布——等多步/分支编排再升级)。
 * 保存 = POST /agent/special/muse/triggers upsert(校验在引擎端与 muse_watch 工具同源)。
 */
import React, { useMemo, useState } from 'react'
import { Bot, Crosshair, Workflow, Zap } from 'lucide-react'
import { useApp } from '../../stores/appStore'
import { useAutomation } from '../../stores/automationStore'
import { saveMuseTrigger } from '../../services/backendService'
import { useI18n } from '../../i18n'
import type { MuseTriggerInfo } from '../../types'

type CondType = 'daily_at' | 'event_seen' | 'file_chars_gte'

export const AutomationBuilder: React.FC<{ editing?: MuseTriggerInfo }> = ({ editing }) => {
  const { t } = useI18n()
  const cfg = useApp((s) => s.cfg)
  const agentDefs = useApp((s) => s.agentDefs)
  const st = useAutomation()

  const [desc, setDesc] = useState(editing?.desc || '')
  const [condType, setCondType] = useState<CondType>(editing?.cond.type || 'daily_at')
  const [time, setTime] = useState(editing?.cond.type === 'daily_at' ? editing.cond.time : '09:00')
  const [match, setMatch] = useState(editing?.cond.type === 'event_seen' ? editing.cond.match : '')
  const [path, setPath] = useState(editing?.cond.type === 'file_chars_gte' ? editing.cond.path : '')
  const [n, setN] = useState(editing?.cond.type === 'file_chars_gte' ? String(editing.cond.n) : '100')
  const [agentSlug, setAgentSlug] = useState(editing?.agentSlug || '')
  const [prompt, setPrompt] = useState(editing?.prompt || '')
  const [cooldown, setCooldown] = useState(String(editing?.cooldownHours ?? 24))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const canSave = useMemo(() => {
    if (!desc.trim()) return false
    if (condType === 'daily_at') return /^\d{1,2}:\d{2}$/.test(time)
    if (condType === 'event_seen') return !!match.trim()
    return !!path.trim() && Number(n) > 0
  }, [desc, condType, time, match, path, n])

  const save = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await saveMuseTrigger(cfg, {
        id: editing?.id,
        desc: desc.trim(),
        cond_type: condType,
        time: condType === 'daily_at' ? time : undefined,
        match: condType === 'event_seen' ? match.trim() : undefined,
        path: condType === 'file_chars_gte' ? path.trim() : undefined,
        n: condType === 'file_chars_gte' ? Number(n) : undefined,
        prompt: prompt.trim() || undefined,
        cooldown_hours: Number(cooldown) > 0 ? Number(cooldown) : undefined,
        agent_slug: agentSlug || undefined,
        enabled: editing?.enabled ?? true,
      })
      st.bump()
      st.closeBuilder()
      if (editing) st.setSel({ kind: 'trigger', triggerId: editing.id })
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auto-builder">
      <div className="auto-builder-title">
        <Workflow size={17} /> {editing ? t('automation.builder.editTitle') : t('automation.builder.title')}
      </div>

      <div className="auto-node">
        <div className="auto-node-head"><span className="auto-ic"><Zap size={14} /></span>{t('automation.builder.trigger')}</div>
        <div className="field">
          <label>{t('automation.builder.desc')}</label>
          <input type="text" value={desc} maxLength={200} placeholder={t('automation.builder.descPh')} onChange={(e) => setDesc(e.target.value)} />
        </div>
        <div className="field">
          <label>{t('automation.builder.condType')}</label>
          <div className="auto-seg">
            <button className={condType === 'daily_at' ? 'active' : ''} onClick={() => setCondType('daily_at')}>{t('automation.builder.condDaily')}</button>
            <button className={condType === 'event_seen' ? 'active' : ''} onClick={() => setCondType('event_seen')}>{t('automation.builder.condEvent')}</button>
            <button className={condType === 'file_chars_gte' ? 'active' : ''} onClick={() => setCondType('file_chars_gte')}>{t('automation.builder.condFile')}</button>
          </div>
        </div>
      </div>

      <div className="auto-node">
        <div className="auto-node-head"><span className="auto-ic"><Crosshair size={14} /></span>{t('automation.builder.target')}</div>
        {condType === 'daily_at' && (
          <div className="field">
            <label>{t('automation.builder.time')}</label>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        )}
        {condType === 'event_seen' && (
          <div className="field">
            <label>{t('automation.builder.match')}</label>
            <input type="text" value={match} maxLength={120} placeholder={t('automation.builder.matchPh')} onChange={(e) => setMatch(e.target.value)} />
          </div>
        )}
        {condType === 'file_chars_gte' && (
          <>
            <div className="field">
              <label>{t('automation.builder.path')}</label>
              <input type="text" value={path} placeholder="~/Forsion/Notes/xxx.md" onChange={(e) => setPath(e.target.value)} />
            </div>
            <div className="field">
              <label>{t('automation.builder.chars')}</label>
              <input type="number" value={n} min={1} onChange={(e) => setN(e.target.value)} />
            </div>
          </>
        )}
      </div>

      <div className="auto-node">
        <div className="auto-node-head"><span className="auto-ic"><Bot size={14} /></span>{t('automation.builder.action')}</div>
        <div className="field">
          <label>{t('automation.builder.runner')}</label>
          <select value={agentSlug} onChange={(e) => setAgentSlug(e.target.value)}>
            <option value="">{t('automation.builder.runnerMuse')}</option>
            {agentDefs.filter((d) => d.slug !== 'muse').map((d) => (
              <option key={d.slug} value={d.slug}>{d.name}</option>
            ))}
          </select>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>
            {agentSlug ? t('automation.builder.runnerAgentHint') : t('automation.builder.runnerMuseHint')}
          </div>
        </div>
        <div className="field">
          <label>{t('automation.builder.prompt')}</label>
          <textarea value={prompt} maxLength={500} placeholder={t('automation.builder.promptPh')} onChange={(e) => setPrompt(e.target.value)} />
        </div>
        <div className="field">
          <label>{t('automation.builder.cooldown')}</label>
          <input type="number" value={cooldown} min={agentSlug ? 1 : 0.1} step="1" onChange={(e) => setCooldown(e.target.value)} />
        </div>
      </div>

      {error && <div style={{ color: 'var(--warn, #b8860b)', fontSize: 12, marginTop: 12 }}>{error}</div>}
      <div className="auto-builder-actions">
        <button className="btn ghost" onClick={() => st.closeBuilder()}>{t('common.cancel')}</button>
        <button className="btn" disabled={!canSave || busy} onClick={() => void save()}>
          {busy ? '…' : t('common.save')}
        </button>
      </div>
    </div>
  )
}
