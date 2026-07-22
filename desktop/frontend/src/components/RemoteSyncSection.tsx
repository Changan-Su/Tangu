/**
 * 设置 → 笔记:「本地库远程同步」节(remotely-save 式,S3/WebDAV/文件夹)。
 * 自包含(自取 useI18n + window.remoteSync),SettingsModal 仅挂一行,web/mobile 下 API 缺位自动隐藏。
 */
import React, { useEffect, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { useI18n } from '../i18n'
import type { RemoteSyncConfig, RemoteSyncReport, RemoteSyncState } from '../types'

export function RemoteSyncSection(): React.ReactElement | null {
  const { t } = useI18n()
  const api = window.remoteSync
  const [cfg, setCfg] = useState<RemoteSyncConfig | null>(null)
  const [rootError, setRootError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [report, setReport] = useState<RemoteSyncReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    if (!api) return
    void api.get().then((s: RemoteSyncState) => {
      setCfg(s.config)
      setRootError(s.rootError)
      setRunning(s.running)
      setReport(s.lastReport)
    })
    return api.onStatus((s) => {
      setRunning(s.running)
      if (s.lastReport) setReport(s.lastReport)
    })
  }, [api])

  if (!api || !cfg) return null
  const patch = (p: Partial<RemoteSyncConfig>): void => {
    setCfg({ ...cfg, ...p })
    setNote(null)
  }
  const save = (): void => {
    setBusy(true)
    void api
      .set(cfg)
      .then((c) => {
        setCfg(c)
        setNote(t('settings.remotesync.saved'))
      })
      .finally(() => setBusy(false))
  }
  const runSync = (allowMassDelete?: boolean): void => {
    setBusy(true)
    setNote(null)
    void api
      .run(allowMassDelete ? { allowMassDelete: true } : undefined)
      .then(setReport)
      .finally(() => setBusy(false))
  }
  const testConn = (): void => {
    setBusy(true)
    void api
      .check()
      .then((r) => setNote(r.ok ? t('settings.remotesync.testOk') : r.error || 'error'))
      .finally(() => setBusy(false))
  }

  const on = cfg.backend !== 'off'
  return (
    <div className="field">
      <label>{t('settings.remotesync.label')}</label>
      <div className="hint">{t('settings.remotesync.hint')}</div>
      <div className="settings-inline-row" style={{ marginTop: 6 }}>
        <select value={cfg.backend} onChange={(e) => patch({ backend: e.target.value as RemoteSyncConfig['backend'] })}>
          <option value="off">{t('settings.remotesync.backendOff')}</option>
          <option value="penzor">{t('settings.remotesync.backendPenzor')}</option>
          <option value="folder">{t('settings.remotesync.backendFolder')}</option>
          <option value="s3">{t('settings.remotesync.backendS3')}</option>
          <option value="webdav">{t('settings.remotesync.backendWebdav')}</option>
        </select>
        {on && (
          <select value={String(cfg.intervalMin ?? 0)} onChange={(e) => patch({ intervalMin: Number(e.target.value) })}>
            <option value="0">{t('settings.remotesync.manualOnly')}</option>
            <option value="10">{t('settings.remotesync.everyMin', { n: '10' })}</option>
            <option value="30">{t('settings.remotesync.everyMin', { n: '30' })}</option>
            <option value="60">{t('settings.remotesync.everyMin', { n: '60' })}</option>
          </select>
        )}
      </div>

      {cfg.backend === 'penzor' && (
        <div style={{ marginTop: 6 }}>
          <input
            type="text"
            value={cfg.penzor?.vault ?? ''}
            placeholder={t('settings.remotesync.penzorVault')}
            onChange={(e) => patch({ penzor: { vault: e.target.value } })}
          />
          <div className="hint">{t('settings.remotesync.penzorHint')}</div>
        </div>
      )}

      {cfg.backend === 'folder' && (
        <div className="settings-inline-row" style={{ marginTop: 6 }}>
          <input
            type="text"
            value={cfg.folder?.path ?? ''}
            placeholder={t('settings.remotesync.folderPath')}
            onChange={(e) => patch({ folder: { path: e.target.value } })}
          />
          {window.tangu?.pickDirectory && (
            <button
              className="btn ghost sm"
              onClick={() => {
                const pick = window.tangu?.pickDirectory
                if (!pick) return
                void pick().then((p: string | null) => {
                  if (p) patch({ folder: { path: p } })
                })
              }}
            >
              {t('settings.remotesync.pick')}
            </button>
          )}
        </div>
      )}

      {cfg.backend === 's3' && (
        <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
          <input type="text" value={cfg.s3?.endpoint ?? ''} placeholder="Endpoint (oss-cn-hangzhou.aliyuncs.com)" onChange={(e) => patch({ s3: { ...(cfg.s3 ?? { region: '', accessKeyID: '', secretAccessKey: '', bucket: '', endpoint: '' }), endpoint: e.target.value } })} />
          <div className="settings-inline-row">
            <input type="text" value={cfg.s3?.region ?? ''} placeholder="Region" onChange={(e) => patch({ s3: { ...(cfg.s3 ?? { region: '', accessKeyID: '', secretAccessKey: '', bucket: '', endpoint: '' }), region: e.target.value } })} />
            <input type="text" value={cfg.s3?.bucket ?? ''} placeholder="Bucket" onChange={(e) => patch({ s3: { ...(cfg.s3 ?? { region: '', accessKeyID: '', secretAccessKey: '', bucket: '', endpoint: '' }), bucket: e.target.value } })} />
          </div>
          <input type="text" value={cfg.s3?.accessKeyID ?? ''} placeholder="AccessKey ID" onChange={(e) => patch({ s3: { ...(cfg.s3 ?? { region: '', accessKeyID: '', secretAccessKey: '', bucket: '', endpoint: '' }), accessKeyID: e.target.value } })} />
          <input type="password" value={cfg.s3?.secretAccessKey ?? ''} placeholder="Secret AccessKey" onChange={(e) => patch({ s3: { ...(cfg.s3 ?? { region: '', accessKeyID: '', secretAccessKey: '', bucket: '', endpoint: '' }), secretAccessKey: e.target.value } })} />
          <input type="text" value={cfg.s3?.prefix ?? ''} placeholder={t('settings.remotesync.s3Prefix')} onChange={(e) => patch({ s3: { ...(cfg.s3 ?? { region: '', accessKeyID: '', secretAccessKey: '', bucket: '', endpoint: '' }), prefix: e.target.value } })} />
        </div>
      )}

      {cfg.backend === 'webdav' && (
        <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
          <input type="text" value={cfg.webdav?.address ?? ''} placeholder="https://dav.jianguoyun.com/dav/" onChange={(e) => patch({ webdav: { ...(cfg.webdav ?? { address: '', username: '', password: '' }), address: e.target.value } })} />
          <div className="settings-inline-row">
            <input type="text" value={cfg.webdav?.username ?? ''} placeholder={t('settings.remotesync.wdUser')} onChange={(e) => patch({ webdav: { ...(cfg.webdav ?? { address: '', username: '', password: '' }), username: e.target.value } })} />
            <input type="password" value={cfg.webdav?.password ?? ''} placeholder={t('settings.remotesync.wdPassword')} onChange={(e) => patch({ webdav: { ...(cfg.webdav ?? { address: '', username: '', password: '' }), password: e.target.value } })} />
          </div>
          <input type="text" value={cfg.webdav?.baseDir ?? ''} placeholder={t('settings.remotesync.wdBaseDir')} onChange={(e) => patch({ webdav: { ...(cfg.webdav ?? { address: '', username: '', password: '' }), baseDir: e.target.value } })} />
        </div>
      )}

      {on && (
        <div style={{ marginTop: 6 }}>
          <textarea
            rows={2}
            value={(cfg.ignore ?? []).join('\n')}
            placeholder={t('settings.remotesync.ignoreHint')}
            onChange={(e) => patch({ ignore: e.target.value.split('\n').filter((l) => l.trim() !== '') })}
          />
        </div>
      )}

      <div className="settings-inline-row" style={{ marginTop: 6 }}>
        <button className="btn ghost sm" disabled={busy} onClick={save}>
          {t('settings.btn.save')}
        </button>
        {on && (
          <>
            <button className="btn ghost sm" disabled={busy} onClick={testConn}>
              {t('settings.remotesync.test')}
            </button>
            <button className="btn sm" disabled={busy || running} onClick={() => runSync()}>
              {running ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}{' '}
              {running ? t('settings.remotesync.syncing') : t('settings.remotesync.syncNow')}
            </button>
          </>
        )}
        {note && <span className="hint">{note}</span>}
      </div>

      {rootError && <div className="hint" style={{ color: 'var(--danger, #c00)' }}>{t(`settings.remotesync.rootErr.${rootError}`)}</div>}
      {report && (
        <div className="hint">
          {t('settings.remotesync.lastResult', {
            time: new Date(report.finishedAt).toLocaleString(),
            push: String(report.pushed),
            pull: String(report.pulled),
            del: String(report.deletedLocal + report.deletedRemote),
            conf: String(report.conflicts),
          })}
        </div>
      )}
      {report && report.pendingDeletions > 0 && (
        <div className="hint" style={{ color: 'var(--danger, #c00)' }}>
          {t('settings.remotesync.pendingDel', { n: String(report.pendingDeletions) })}{' '}
          <button className="btn sm" disabled={busy || running} onClick={() => runSync(true)}>
            {t('settings.remotesync.confirmDel')}
          </button>
        </div>
      )}
      {report && report.errors.length > 0 && (
        <div className="hint" style={{ color: 'var(--danger, #c00)' }}>
          {t('settings.remotesync.errors')}: {report.errors.slice(0, 3).join('; ')}
          {report.errors.length > 3 ? '…' : ''}
        </div>
      )}
    </div>
  )
}
