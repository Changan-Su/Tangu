/**
 * 设置模态:连接 / 模型 / 主题(ThemeCard 网格 + 明暗 + 毛玻璃) / 高级。
 * tabs 形态对齐 AI Studio SettingsModal;连接页的 managed/external 切换在 M6 接 backendManager。
 */
import React, { useEffect, useState } from 'react'
import { X, Loader2, RefreshCw, Sun, Moon, RotateCcw, LogIn, LogOut, ExternalLink, KeyRound } from 'lucide-react'
import { AnimatedModalBackdrop, AnimatedModalContent, AnimatePresence } from './AnimatedUI'
import { ThemeCard } from './ThemeCard'
import { listThemes } from '../theme/registry'
import { applyTheme } from '../theme/loader'
import { testConnection } from '../services/agentRunService'
import { listModels } from '../services/backendService'
import type { AuthStatusInfo, BackendStatusInfo, ModelsResponse, StoredDesktopConfig, TanguDesktopConfig } from '../types'

type Tab = 'connection' | 'model' | 'theme' | 'advanced'

const BACKEND_STATE_LABEL: Record<string, string> = {
  stopped: '已停止',
  starting: '启动中…',
  ready: '运行中',
  crashed: '已崩溃',
}

export const SettingsModal: React.FC<{
  open: boolean
  cfg: TanguDesktopConfig
  themePreset: string
  themeMode: 'light' | 'dark'
  glassOn: boolean
  onClose: () => void
  onConfigChange: (patch: Partial<TanguDesktopConfig>) => void
  onThemeChange: (preset: string, mode: 'light' | 'dark') => void
  onGlassChange: (on: boolean) => void
  /** patch 随调用传入:避免「setState 未刷新就重连」的旧值竞态。 */
  onReconnect: (patch?: Partial<TanguDesktopConfig>) => void
}> = (p) => {
  const [tab, setTab] = useState<Tab>('connection')
  const [draft, setDraft] = useState(p.cfg)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState('')
  const [models, setModels] = useState<ModelsResponse | null>(null)
  const [modelsLoading, setModelsLoading] = useState(false)
  // Electron 托管后端(window.tangu 缺省=浏览器调试,隐藏 managed UI)
  const isDesktop = !!window.tangu?.backendStatus
  const [stored, setStored] = useState<StoredDesktopConfig | null>(null)
  const [backendSt, setBackendSt] = useState<BackendStatusInfo | null>(null)
  const [logs, setLogs] = useState<string[] | null>(null)
  // Forsion 账号 / provider OAuth 登录态
  const [authSt, setAuthSt] = useState<AuthStatusInfo | null>(null)
  const [loggingIn, setLoggingIn] = useState(false)
  const [device, setDevice] = useState<{ url: string; userCode: string } | null>(null)
  const [providers, setProviders] = useState<Array<{ id: string; loggedIn: boolean }> | null>(null)
  const [providerBusy, setProviderBusy] = useState<string | null>(null)

  const refreshAuth = (): void => {
    if (!window.tangu?.authStatus) return
    void window.tangu.authStatus().then(setAuthSt).catch(() => setAuthSt(null))
    void window.tangu.authProviders?.().then(setProviders).catch(() => setProviders([]))
  }

  useEffect(() => {
    if (p.open) {
      setDraft(p.cfg)
      setTestResult('')
      setLogs(null)
      setDevice(null)
      if (isDesktop) {
        void window.tangu!.getConfig().then(setStored)
        void window.tangu!.backendStatus!().then(setBackendSt)
        refreshAuth()
      }
    }
  }, [p.open, p.cfg, isDesktop])

  useEffect(() => {
    if (!p.open || !isDesktop) return
    const off1 = window.tangu!.onBackendStatus?.((st) => setBackendSt(st))
    const off2 = window.tangu!.onAuthDevice?.((info) => setDevice(info))
    return () => {
      off1?.()
      off2?.()
    }
  }, [p.open, isDesktop])

  const doForsionLogin = async (): Promise<void> => {
    if (!window.tangu?.forsionLogin) return
    setLoggingIn(true)
    setDevice(null)
    try {
      const r = await window.tangu.forsionLogin(stored?.cloudUrl || undefined)
      setStored((s) => (s ? { ...s, cloudUrl: r.cloudUrl } : s))
      refreshAuth()
      p.onReconnect()
    } catch (e: any) {
      setTestResult(String(e?.message || e).replace(/^Error invoking remote method '[^']+': Error: /, ''))
    } finally {
      setLoggingIn(false)
      setDevice(null)
    }
  }

  const doProviderLogin = async (id: string): Promise<void> => {
    if (!window.tangu?.providerLogin) return
    setProviderBusy(id)
    try {
      await window.tangu.providerLogin(id)
      refreshAuth()
    } catch (e: any) {
      setTestResult(String(e?.message || e).replace(/^Error invoking remote method '[^']+': Error: /, ''))
    } finally {
      setProviderBusy(null)
    }
  }

  const mode = stored?.mode || 'external'
  const setMode = (m: 'managed' | 'external') => {
    void window.tangu!.setConfig({ mode: m }).then(setStored)
  }
  const saveManaged = () => {
    if (!stored) return
    void window.tangu!.setConfig({
      mode: 'managed',
      cloudUrl: stored.cloudUrl,
      cloudToken: stored.cloudToken,
      sandbox: stored.sandbox,
    }).then(setStored)
  }

  const loadModels = async () => {
    setModelsLoading(true)
    try {
      setModels(await listModels(draft))
    } catch (e: any) {
      setModels(null)
      setTestResult(e?.message || '模型列表加载失败')
    } finally {
      setModelsLoading(false)
    }
  }

  useEffect(() => {
    if (p.open && tab === 'model' && !models && !modelsLoading) void loadModels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.open, tab])

  const test = async () => {
    setTesting(true)
    const r = await testConnection(draft)
    setTestResult(r.message)
    setTesting(false)
  }

  const saveConnection = () => {
    const patch = { backendUrl: draft.backendUrl.replace(/\/+$/, ''), token: draft.token }
    p.onConfigChange(patch)
    p.onReconnect(patch)
  }

  return (
    <AnimatePresence>
      {p.open && (
        <AnimatedModalBackdrop onClose={p.onClose}>
          <AnimatedModalContent>
            <div className="modal">
              <div className="modal-head">
                设置
                <span className="grow" />
                <button className="icon-btn" onClick={p.onClose}>
                  <X size={16} />
                </button>
              </div>
              <div className="modal-tabs">
                {(
                  [
                    ['connection', '连接'],
                    ['model', '模型'],
                    ['theme', '主题'],
                    ['advanced', '高级'],
                  ] as Array<[Tab, string]>
                ).map(([id, label]) => (
                  <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="modal-body">
                {tab === 'connection' && (
                  <>
                    {isDesktop && (
                      <div className="field">
                        <label>后端模式</label>
                        <div className="seg">
                          <button className={mode === 'managed' ? 'active' : ''} onClick={() => setMode('managed')}>
                            自动托管(内置)
                          </button>
                          <button className={mode === 'external' ? 'active' : ''} onClick={() => setMode('external')}>
                            外部连接
                          </button>
                        </div>
                      </div>
                    )}

                    {isDesktop && mode === 'managed' && stored && (
                      <>
                        <div className="field">
                          <label>Forsion 云端地址(大脑:记忆/技能/托管模型)</label>
                          <input
                            type="text"
                            value={stored.cloudUrl}
                            onChange={(e) => setStored({ ...stored, cloudUrl: e.target.value })}
                            placeholder="https://api.forsion.app"
                          />
                          <div className="hint">可用环境变量 TANGU_CLOUD_URL 预设;登录成功后自动记住。</div>
                        </div>

                        <div className="field">
                          <label>Forsion 账号</label>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            {authSt?.loggedIn ? (
                              <>
                                <span className="conn-pill ok">
                                  <span className="dot" />
                                  已登录{authSt.username ? ` · ${authSt.username}` : ''}
                                  {authSt.tokenSource === 'config' ? '(手动 token)' : ''}
                                </span>
                                <button className="btn ghost sm" onClick={() => {
                                  void window.tangu!.forsionLogout?.().then(() => refreshAuth())
                                }}>
                                  <LogOut size={12} /> 登出
                                </button>
                              </>
                            ) : (
                              <span className="conn-pill"><span className="dot" />未登录</span>
                            )}
                            <button className="btn primary sm" onClick={() => void doForsionLogin()} disabled={loggingIn || !stored.cloudUrl}>
                              {loggingIn ? <Loader2 size={12} className="spin" /> : <LogIn size={12} />}
                              通过浏览器登录
                            </button>
                          </div>
                          {device && (
                            <div className="hint" style={{ marginTop: 6 }}>
                              浏览器没弹出来?手动打开:
                              <a href={device.url} target="_blank" rel="noreferrer" style={{ wordBreak: 'break-all' }}>
                                {device.url} <ExternalLink size={10} style={{ verticalAlign: -1 }} />
                              </a>
                              {device.userCode ? <> · 验证码 <b>{device.userCode}</b></> : null}
                            </div>
                          )}
                          {!authSt?.loggedIn && (
                            <div className="hint">与 `tangu login` 同一份凭证(~/.tangu/auth.json),CLI/TUI/桌面通用。</div>
                          )}
                        </div>

                        <div className="field-row">
                          <div className="field">
                            <label><KeyRound size={11} style={{ verticalAlign: -1 }} /> 手动 token(高级,可选;覆盖登录凭证)</label>
                            <input
                              type="password"
                              value={stored.cloudToken}
                              onChange={(e) => setStored({ ...stored, cloudToken: e.target.value })}
                              placeholder="一般不需要,浏览器登录即可"
                            />
                          </div>
                          <div className="field" style={{ maxWidth: 160 }}>
                            <label>代码沙箱</label>
                            <select
                              value={stored.sandbox}
                              onChange={(e) => setStored({ ...stored, sandbox: e.target.value as any })}
                            >
                              <option value="auto">自动检测</option>
                              <option value="docker">Docker</option>
                              <option value="none">禁用</option>
                            </select>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                          <button className="btn primary sm" onClick={saveManaged}>保存并重启后端</button>
                          <button
                            className="btn ghost sm"
                            onClick={() => void window.tangu!.backendRestart!().then(setBackendSt)}
                          >
                            <RotateCcw size={12} /> 重启
                          </button>
                          <span className={`conn-pill ${backendSt?.state === 'ready' ? 'ok' : backendSt?.state === 'crashed' ? 'err' : ''}`}>
                            <span className="dot" />
                            {BACKEND_STATE_LABEL[backendSt?.state || 'stopped']}
                            {backendSt?.url ? ` · ${backendSt.url}` : ''}
                          </span>
                        </div>
                        {backendSt?.lastError && (
                          <div className="hint" style={{ color: 'var(--danger)' }}>{backendSt.lastError}</div>
                        )}
                        <div className="field">
                          <button
                            className="btn ghost sm"
                            onClick={() => void window.tangu!.backendLogs!().then(setLogs)}
                          >
                            查看后端日志
                          </button>
                          {logs && (
                            <pre style={{
                              marginTop: 8, fontSize: 11, fontFamily: 'var(--font-mono)', maxHeight: 220,
                              overflowY: 'auto', background: 'var(--bg-card)', padding: 8,
                              border: 'var(--border-width) solid var(--border)', borderRadius: 'var(--radius-sm)',
                              whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                            }}>
                              {logs.length ? logs.join('\n') : '(暂无日志)'}
                            </pre>
                          )}
                        </div>
                      </>
                    )}

                    {(!isDesktop || mode === 'external') && (
                      <>
                        <div className="field">
                          <label>后端地址</label>
                          <input
                            type="text"
                            value={draft.backendUrl}
                            onChange={(e) => setDraft({ ...draft, backendUrl: e.target.value })}
                            placeholder="http://localhost:8787"
                          />
                          <div className="hint">tangu-server 的 HTTP 地址(本机或远程);可用环境变量 TANGU_BACKEND_URL 预设。</div>
                        </div>
                        <div className="field">
                          <label>访问令牌</label>
                          <input
                            type="password"
                            value={draft.token}
                            onChange={(e) => setDraft({ ...draft, token: e.target.value })}
                            placeholder="tangu-server --token 配置的值"
                          />
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <button className="btn ghost sm" onClick={test} disabled={testing}>
                            {testing ? <Loader2 size={13} className="spin" /> : null} 测试连接
                          </button>
                          <button className="btn primary sm" onClick={saveConnection}>
                            保存并连接
                          </button>
                          <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{testResult}</span>
                        </div>
                      </>
                    )}
                  </>
                )}

                {tab === 'model' && (
                  <>
                    <div className="field">
                      <label>默认模型</label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input
                          type="text"
                          value={draft.modelId}
                          onChange={(e) => setDraft({ ...draft, modelId: e.target.value })}
                          placeholder="如 forsion 模型 id 或 ollama/llama3"
                        />
                        <button className="btn ghost sm" onClick={() => p.onConfigChange({ modelId: draft.modelId })}>
                          保存
                        </button>
                      </div>
                      <div className="hint">
                        直连 provider 支持 <code>&lt;providerId&gt;/&lt;model&gt;</code> 自由填写;其余走 Forsion 托管面。
                      </div>
                    </div>
                    <div className="field">
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        可用模型
                        <button className="icon-btn" style={{ width: 22, height: 22 }} onClick={loadModels}>
                          <RefreshCw size={12} className={modelsLoading ? 'spin' : ''} />
                        </button>
                      </label>
                      {models?.models.length ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 280, overflowY: 'auto' }}>
                          {models.models.map((m) => (
                            <button
                              key={`${m.source}-${m.id}`}
                              className="file-row"
                              onClick={() => {
                                setDraft({ ...draft, modelId: m.id })
                                p.onConfigChange({ modelId: m.id })
                              }}
                            >
                              <span className="file-name" style={{ color: m.id === draft.modelId ? 'var(--accent)' : undefined }}>
                                {m.name}
                              </span>
                              <span className="file-size">{m.source === 'direct' ? `直连·${m.provider}` : m.provider}</span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="hint">{modelsLoading ? '加载中…' : '暂无(检查连接,或云端未配置模型)'}</div>
                      )}
                      {models?.directProviders.length ? (
                        <div className="hint">
                          直连 provider:{models.directProviders.map((d) => d.providerId).join('、')}
                        </div>
                      ) : null}
                    </div>

                    {isDesktop && providers && providers.length > 0 && (
                      <div className="field">
                        <label>Provider 账号登录(用订阅账号当 LLM,直连不计 Forsion 额度)</label>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {providers.map((pr) => (
                            <button
                              key={pr.id}
                              className="btn ghost sm"
                              disabled={providerBusy === pr.id}
                              onClick={() => void doProviderLogin(pr.id)}
                            >
                              {providerBusy === pr.id ? <Loader2 size={12} className="spin" /> : <LogIn size={12} />}
                              {pr.id}
                              {pr.loggedIn ? ' · 已登录(重新登录)' : ''}
                            </button>
                          ))}
                        </div>
                        <div className="hint">
                          OAuth 浏览器登录,凭证存 ~/.tangu/provider-auth.json(与 `tangu login {'<provider>'}` 通用);
                          托管后端会自动重启加载,之后用 <code>provider/模型名</code>(如 xai/grok-3)即可。
                        </div>
                      </div>
                    )}
                  </>
                )}

                {tab === 'theme' && (
                  <>
                    <div className="field">
                      <label>主题</label>
                      <div className="theme-grid">
                        {listThemes().map((t) => (
                          <ThemeCard
                            key={t.manifest.id}
                            entry={t}
                            mode={p.themeMode}
                            active={t.manifest.id === p.themePreset}
                            onSelect={() => {
                              applyTheme(t.manifest.id, p.themeMode)
                              p.onThemeChange(t.manifest.id, p.themeMode)
                            }}
                          />
                        ))}
                      </div>
                    </div>
                    <div className="field">
                      <label>明暗</label>
                      <div className="seg">
                        <button
                          className={p.themeMode === 'light' ? 'active' : ''}
                          onClick={() => {
                            applyTheme(p.themePreset, 'light')
                            p.onThemeChange(p.themePreset, 'light')
                          }}
                        >
                          <Sun size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
                          亮色
                        </button>
                        <button
                          className={p.themeMode === 'dark' ? 'active' : ''}
                          onClick={() => {
                            applyTheme(p.themePreset, 'dark')
                            p.onThemeChange(p.themePreset, 'dark')
                          }}
                        >
                          <Moon size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
                          暗色{p.themePreset === 'sozhi' ? '(夜读)' : ''}
                        </button>
                      </div>
                    </div>
                    <div className="field">
                      <label>毛玻璃质感</label>
                      <div className="seg">
                        <button className={p.glassOn ? 'active' : ''} onClick={() => p.onGlassChange(true)}>开</button>
                        <button className={!p.glassOn ? 'active' : ''} onClick={() => p.onGlassChange(false)}>关(低配模式)</button>
                      </div>
                    </div>
                  </>
                )}

                {tab === 'advanced' && (
                  <div className="panel-note">
                    会话级配置(技能/工具启用、执行环境、审批档)在右侧面板与输入栏调整。
                    快捷键:Ctrl/Cmd+N 新建会话,Ctrl/Cmd+, 打开设置。
                  </div>
                )}
              </div>
            </div>
          </AnimatedModalContent>
        </AnimatedModalBackdrop>
      )}
    </AnimatePresence>
  )
}
