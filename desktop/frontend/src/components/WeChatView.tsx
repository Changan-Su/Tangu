/**
 * WeChatView 主界面工作区：微信远程的「连接状态 + 扫码 + 已绑定账号」集中在主界面呈现
 * (从侧栏卡片上移)。点击侧栏「微信远程」卡片进入此视图。
 *
 * 扫码二维码用 QrImage(qrcode 库)把 iLink 返回的可扫描 URL 编码成图,修复「二维码加载不出来」。
 */
import React, { useEffect, useState } from 'react'
import { Smartphone, QrCode, RefreshCw, LogOut, Loader2, Settings, ExternalLink, Plus, Check } from 'lucide-react'
import {
  getWechatStatus,
  startWechatLogin,
  pollWechatLogin,
  disconnectWechat as disconnectWechatAccount,
  listMessages,
  listWechatSessions,
  setWechatConnectedSession,
  createWechatSession,
  listAgents,
  setWechatSessionAgent,
  type WechatStatusResponse,
  type WechatProjectSession,
} from '../services/backendService'
import type { MessageRecord, NormalAgentDef, SessionRecord, TanguDesktopConfig } from '../types'
import { useI18n } from '../i18n'
import { QrImage } from './QrImage'

type Login = { loginId: string; qrValue: string; expiresAt: number; status?: string }

export const WeChatView: React.FC<{
  cfg: TanguDesktopConfig
  activeSession: SessionRecord | null
  modelId: string
  onOpenSettings: () => void
  /** 在主界面打开微信绑定的会话(切到普通聊天视图)。 */
  onOpenSession?: (sessionId: string) => void
  /** 微信会话列表变化(扫码/新建/切换/轮询)→ 通知上层刷新侧栏会话列表。 */
  onSessionsChanged?: () => void
}> = (p) => {
  const { t } = useI18n()
  const [status, setStatus] = useState<WechatStatusResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [login, setLogin] = useState<Login | null>(null)
  const [convo, setConvo] = useState<MessageRecord[]>([])
  const [sessions, setSessions] = useState<WechatProjectSession[]>([])
  const [agentDefs, setAgentDefs] = useState<NormalAgentDef[]>([])

  // 正在连接的会话:优先用 Project 会话列表的 connected 标记,回退活跃绑定。
  const boundSessionId = sessions.find((s) => s.connected)?.id || status?.bindings.find((b) => b.is_active)?.session_id || null

  const refresh = (): void => {
    if (!p.cfg.token) return
    void getWechatStatus(p.cfg)
      .then((r) => { setStatus(r); if (!login) setMsg('') })
      .catch((e) => setMsg(t('settings.wechat.statusUnavailable', { e: e?.message || e })))
    void listWechatSessions(p.cfg).then(setSessions).catch(() => {})
    // 微信会话(含 bot /new 建的)同步到桌面侧栏会话列表。
    p.onSessionsChanged?.()
  }

  useEffect(() => {
    refresh()
    void listAgents(p.cfg).then(setAgentDefs).catch(() => {})
    const timer = window.setInterval(refresh, 5000) // 微信 /new 等后端动作靠轮询同步,缩短到 5s 更即时
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.cfg.backendUrl, p.cfg.token])

  const onPickAgent = async (slug: string): Promise<void> => {
    if (!boundSessionId || !slug) return
    try { await setWechatSessionAgent(p.cfg, boundSessionId, slug); refresh() } catch { /* ignore */ }
  }

  // 扫码状态轮询(每 2s):confirmed → 刷新绑定;expired/failed → 收起二维码并提示。
  useEffect(() => {
    if (!login) return
    let canceled = false
    let timer = 0
    const tick = async (): Promise<void> => {
      try {
        const r = await pollWechatLogin(p.cfg, login.loginId)
        if (canceled) return
        setLogin((cur) => (cur && cur.loginId === login.loginId ? { ...cur, status: r.status } : cur))
        if (r.status === 'confirmed') {
          setLogin(null)
          setMsg(t('settings.wechat.connectedMsg'))
          refresh()
          window.clearInterval(timer)
        } else if (r.status === 'expired' || r.status === 'failed') {
          setLogin(null)
          setMsg(r.detail || t('settings.wechat.loginStatus', { status: r.status }))
          window.clearInterval(timer)
        }
      } catch (e: any) {
        if (canceled) return
        setMsg(t('sidebar.wechat.pollFailed', { e: e?.message || e }))
        window.clearInterval(timer)
      }
    }
    timer = window.setInterval(() => void tick(), 2000)
    void tick()
    return () => { canceled = true; window.clearInterval(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [login?.loginId])

  // 绑定会话的对话内容(在本界面查看微信往来;每 4s 刷新)。
  useEffect(() => {
    if (!boundSessionId) { setConvo([]); return }
    let alive = true
    const load = (): void => { void listMessages(p.cfg, boundSessionId, 40).then((m) => { if (alive) setConvo(m) }).catch(() => {}) }
    load()
    const timer = window.setInterval(load, 4000)
    return () => { alive = false; window.clearInterval(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundSessionId, p.cfg.backendUrl, p.cfg.token])

  // 绑定在 OR iLink runtime 在线都算已连接(避免「能用却显示掉线」)。
  const connected = (status?.bindings.filter((b) => b.is_active).length || 0) || (((status as any)?.runtime?.length || 0) > 0 ? 1 : 0)

  const start = async (): Promise<void> => {
    setBusy(true)
    setMsg('')
    try {
      const r = await startWechatLogin(p.cfg, {
        // 不传 session_id:用后端的微信「专属独立会话」(不绑当前活跃会话、不跟随新建会话)。
        model_id: p.modelId || p.activeSession?.model_id || undefined,
        approval_mode: 'readonly',
      })
      setLogin({ loginId: r.loginId, qrValue: r.qrcodeImg || r.qrcode, expiresAt: r.expiresAt, status: 'pending' })
    } catch (e: any) {
      setMsg(t('settings.wechat.startFailed', { e: e?.message || e }))
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async (accountId: string): Promise<void> => {
    setBusy(true)
    setMsg('')
    try {
      await disconnectWechatAccount(p.cfg, accountId)
      setMsg(t('settings.wechat.disconnected'))
      refresh()
    } catch (e: any) {
      setMsg(t('settings.wechat.disconnectFailed', { e: e?.message || e }))
    } finally {
      setBusy(false)
    }
  }

  // 切换「正在连接的 session」。
  const connectTo = async (sessionId: string): Promise<void> => {
    setBusy(true); setMsg('')
    try { await setWechatConnectedSession(p.cfg, sessionId); refresh() }
    catch (e: any) { setMsg(t('special.wechat.switchFail', { e: e?.message || e })) }
    finally { setBusy(false) }
  }
  // 在微信 Project 下新建会话(并切为正在连接)。
  const newSession = async (): Promise<void> => {
    setBusy(true); setMsg('')
    try { await createWechatSession(p.cfg); refresh(); setMsg(t('special.wechat.created')) }
    catch (e: any) { setMsg(t('special.wechat.createFail', { e: e?.message || e })) }
    finally { setBusy(false) }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, padding: '16px 20px', overflowY: 'auto' }}>
      <div style={{ width: '100%', maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
          <Smartphone size={16} /> {t('sidebar.wechat.title')}
          <span style={{ flex: 1 }} />
          <span className={`conn-pill ${status?.enabled ? 'ok' : ''}`} style={{ fontSize: 12 }}>
            <span className="dot" />
            {status?.enabled ? t('settings.wechat.runtimeOn') : t('settings.wechat.runtimeOff')}
          </span>
          <button className="icon-btn" title={t('sidebar.settings')} onClick={p.onOpenSettings}><Settings size={14} /></button>
          <button className="icon-btn" title={t('common.refresh')} onClick={refresh}><RefreshCw size={13} /></button>
        </div>

        <div className="hint" style={{ margin: 0 }}>{t('special.wechat.intro')}</div>

        {/* 连接状态 + 扫码区 */}
        <div className="special-panel-card">
          <div className="sidebar-wechat-status" style={{ marginBottom: login ? 12 : 0, fontSize: 12.5 }}>
            <span className={`mini-dot ${connected ? 'ok' : ''}`} />
            {connected ? t('sidebar.wechat.connectedCount', { count: connected }) : t('sidebar.wechat.notConnected')}
          </div>
          {login ? (
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <QrImage value={login.qrValue} size={160} className="wechat-qr" />
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('settings.wechat.scanTitle')}</div>
                <div className="hint" style={{ margin: '0 0 6px' }}>{t('sidebar.wechat.scanHint')}</div>
                <div className="hint" style={{ margin: 0 }}>
                  {t('settings.wechat.statusLine', { status: login.status || 'pending', time: new Date(login.expiresAt).toLocaleTimeString() })}
                </div>
              </div>
            </div>
          ) : (
            <button className="btn primary sm" disabled={busy || !p.cfg.token || status?.enabled === false} onClick={() => void start()}>
              {busy ? <Loader2 size={12} className="spin" /> : <QrCode size={12} />}
              {t('sidebar.wechat.connect')}
            </button>
          )}
        </div>

        {/* 当前会话使用的 Agent(微信主界面也能切) */}
        {boundSessionId && agentDefs.length > 0 && (
          <div className="field" style={{ margin: 0 }}>
            <label>{t('settings.wechat.currentAgent')}</label>
            <select value={sessions.find((s) => s.id === boundSessionId)?.agentSlug || ''} onChange={(e) => void onPickAgent(e.target.value)}>
              {agentDefs.map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}
            </select>
          </div>
        )}

        {/* 已绑定账号 */}
        <div className="field" style={{ margin: 0 }}>
          <label>{t('special.wechat.bindings')}</label>
          {status?.bindings.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {status.bindings.map((b) => (
                <div key={b.id} className="file-row" style={{ cursor: 'default' }}>
                  <span className="file-name">
                    <b>{b.wx_user_id || b.account_id}</b>
                    <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: 12 }}>
                      {b.peer_id ? t('settings.wechat.peer', { peer: b.peer_id }) : t('settings.wechat.waitingPeer')}
                    </span>
                  </span>
                  <span className="file-size">{b.session_title || b.session_id} · {b.remote_approval_mode}</span>
                  <button className="icon-btn" disabled={busy} title={t('settings.wechat.disconnect')} onClick={() => void disconnect(b.account_id)}>
                    <LogOut size={13} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="hint">{t('settings.wechat.noBinding')}</div>
          )}
        </div>

        {/* 微信 Project 会话:列出 + 切换正在连接 + 新建 */}
        <div className="field" style={{ margin: 0 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {t('special.wechat.sessions')}
            <span style={{ flex: 1 }} />
            <button className="btn ghost sm" disabled={busy || !p.cfg.token} onClick={() => void newSession()}>
              <Plus size={12} /> {t('special.wechat.newSession')}
            </button>
          </label>
          {sessions.length === 0 ? (
            <div className="hint">{t('special.wechat.sessionsEmpty')}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {sessions.map((s) => (
                <div key={s.id} className={`file-row${s.connected ? ' active' : ''}`} style={{ cursor: 'default' }}>
                  <span className={`mini-dot ${s.connected ? 'ok' : ''}`} />
                  <span className="file-name" style={{ flex: 1 }}>{s.title || 'WeChat Remote'}</span>
                  {s.connected ? (
                    <span className="file-size" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--green)' }}>
                      <Check size={12} /> {t('special.wechat.connectedTag')}
                    </span>
                  ) : (
                    <button className="btn ghost sm" disabled={busy} onClick={() => void connectTo(s.id)}>{t('special.wechat.setConnected')}</button>
                  )}
                  {p.onOpenSession && (
                    <button className="icon-btn" title={t('special.wechat.openInMain')} onClick={() => p.onOpenSession!(s.id)}><ExternalLink size={13} /></button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 会话内容:微信往来直接在本界面查看 */}
        {boundSessionId && (
          <div className="field" style={{ margin: 0 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {t('special.wechat.conversation')}
              <span style={{ flex: 1 }} />
              {p.onOpenSession && (
                <button className="btn ghost sm" onClick={() => p.onOpenSession!(boundSessionId)}>
                  <ExternalLink size={12} /> {t('special.wechat.openInMain')}
                </button>
              )}
            </label>
            {convo.length === 0 ? (
              <div className="hint">{t('special.wechat.noMessages')}</div>
            ) : (
              <div className="special-panel-card" style={{ maxHeight: 340, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 11 }}>
                {convo.map((m) => (
                  <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: m.role === 'user' ? 'var(--accent)' : 'var(--text-muted)' }}>
                      {m.role === 'user' ? t('special.wechat.roleUser') : 'Tangu'}
                    </span>
                    <span style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap', color: m.is_error ? 'var(--danger)' : 'var(--text)' }}>
                      {(m.content || '').slice(0, 2000) || (m.is_error ? '⚠' : '…')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {msg && <div className="hint" style={{ margin: 0 }}>{msg}</div>}
      </div>
    </div>
  )
}
