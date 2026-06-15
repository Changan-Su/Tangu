/**
 * 右侧面板:工作区文件 / 目录(会话大纲) / 记忆·日志 三个 tab(对标 openhanako Desk 的右栏形态)。
 */
import React, { useCallback, useEffect, useState } from 'react'
import {
  FolderOpen, Folder, List, BookOpen, Download, Trash2, Upload, RefreshCw, FileText, Image as ImageIcon, Loader2, ChevronLeft, CornerLeftUp,
  FolderPlus, Pencil, ExternalLink, Check, X,
} from 'lucide-react'
import type { AgentConfig, TanguDesktopConfig, UiMessage, WorkspaceFileMeta } from '../types'
import * as api from '../services/backendService'
import { Markdown } from './Markdown'
import { ChatToc } from './ChatToc'
import { useI18n } from '../i18n'

type Tab = 'workspace' | 'toc' | 'memory'

export const RightPanel: React.FC<{
  cfg: TanguDesktopConfig
  sessionId: string
  sessionConfig: AgentConfig
  running: boolean
  messages: UiMessage[]
  chatScrollRef: React.RefObject<HTMLDivElement | null>
  onToast: (text: string, error?: boolean) => void
}> = (p) => {
  const { t } = useI18n()
  const [tab, setTab] = useState<Tab>('workspace')
  return (
    <aside className="right-panel">
      <div className="right-panel-tabs">
        <button className={tab === 'workspace' ? 'active' : ''} onClick={() => setTab('workspace')}>
          <FolderOpen size={13} /> {t('panel.tab.workspace')}
        </button>
        <button className={tab === 'toc' ? 'active' : ''} onClick={() => setTab('toc')}>
          <List size={13} /> {t('panel.tab.toc')}
        </button>
        <button className={tab === 'memory' ? 'active' : ''} onClick={() => setTab('memory')}>
          <BookOpen size={13} /> {t('panel.tab.memory')}
        </button>
      </div>
      <div className="right-panel-body">
        {tab === 'workspace' && <WorkspaceTab {...p} />}
        {tab === 'toc' && <ChatToc containerRef={p.chatScrollRef} scanTrigger={p.messages.length} />}
        {tab === 'memory' && <MemoryTab {...p} />}
      </div>
    </aside>
  )
}

// ── 工作区 ──────────────────────────────────────────────────────────────────

/** 工作区分发:本机会话浏览 cwd 真实目录(Electron fs);云沙箱走后端工作区。 */
const WorkspaceTab: React.FC<{
  cfg: TanguDesktopConfig
  sessionId: string
  sessionConfig?: AgentConfig
  running: boolean
  onToast: (t: string, e?: boolean) => void
}> = (p) => {
  if (p.sessionConfig?.execMode === 'host' && p.sessionConfig.cwd && window.tangu?.listDir) {
    return <HostFilesTab cwd={p.sessionConfig.cwd} running={p.running} onToast={p.onToast} />
  }
  return <SandboxFilesTab {...p} />
}

/** 本机工作区文件浏览(根=会话 cwd;可进子目录、预览文件;不越过 cwd 根)。 */
const HostFilesTab: React.FC<{
  cwd: string
  running: boolean
  onToast: (t: string, e?: boolean) => void
}> = ({ cwd, running, onToast }) => {
  const { t } = useI18n()
  const [curDir, setCurDir] = useState(cwd)
  const [entries, setEntries] = useState<Array<{ name: string; isDir: boolean; size: number; path: string }>>([])
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<{ name: string; mimeType: string; content: string; size: number; tooLarge?: boolean } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null) // 正在重命名的条目 path
  const [renameVal, setRenameVal] = useState('')
  const [newFolder, setNewFolder] = useState(false) // 是否显示「新建文件夹」输入
  const [newFolderVal, setNewFolderVal] = useState('')

  useEffect(() => { setCurDir(cwd); setPreview(null); setRenaming(null); setNewFolder(false) }, [cwd]) // 切会话/工作区复位到根

  const refresh = useCallback(async () => {
    if (!window.tangu?.listDir) return
    setLoading(true)
    try {
      setEntries((await window.tangu.listDir(curDir)) as any)
    } catch (e: any) {
      onToast(t('panel.toast.listDirFail', { err: e?.message || e }), true)
    } finally {
      setLoading(false)
    }
  }, [curDir, onToast])

  useEffect(() => { void refresh() }, [refresh, running])

  const parentOf = (d: string): string => {
    const i = Math.max(d.lastIndexOf('/'), d.lastIndexOf('\\'))
    return i > 0 ? d.slice(0, i) : d
  }
  const atRoot = curDir === cwd
  const rel = curDir.startsWith(cwd) ? curDir.slice(cwd.length).replace(/^[/\\]+/, '') : curDir
  const isText = (m: string) => m.startsWith('text/') || /json|xml|javascript|typescript|yaml|csv/.test(m)
  const isImage = (m: string) => m.startsWith('image/')

  const open = async (en: { name: string; isDir: boolean; path: string }) => {
    if (en.isDir) { setCurDir(en.path); return }
    if (!window.tangu?.readHostFile) return
    try {
      const r = await window.tangu.readHostFile(en.path)
      setPreview({ name: en.name, ...r })
    } catch (e: any) {
      onToast(t('panel.toast.readFail', { err: e?.message || e }), true)
    }
  }

  // ── 文件操作 ──
  const beginRename = (en: { name: string; path: string }) => { setRenaming(en.path); setRenameVal(en.name) }
  const commitRename = async (en: { name: string; path: string }) => {
    const name = renameVal.trim()
    setRenaming(null)
    if (!name || name === en.name || !window.tangu?.renameHostPath) return
    try {
      await window.tangu.renameHostPath(en.path, name)
      void refresh()
    } catch (e: any) {
      onToast(t('panel.toast.renameFail', { err: e?.message || e }), true)
    }
  }
  const commitNewFolder = async () => {
    const name = newFolderVal.trim()
    setNewFolder(false)
    setNewFolderVal('')
    if (!name || !window.tangu?.mkdirHost) return
    try {
      await window.tangu.mkdirHost(curDir, name)
      void refresh()
    } catch (e: any) {
      onToast(t('panel.toast.mkdirFail', { err: e?.message || e }), true)
    }
  }
  const reveal = (en: { path: string }) => { void window.tangu?.revealHostPath?.(en.path) }
  const trash = async (en: { name: string; path: string }) => {
    if (!window.tangu?.trashHostPath) return
    if (!window.confirm(t('panel.confirm.trash', { name: en.name }))) return
    try {
      await window.tangu.trashHostPath(en.path)
      void refresh()
    } catch (e: any) {
      onToast(t('panel.toast.deleteFail', { err: e?.message || e }), true)
    }
  }
  // 原生拖出:阻止 HTML5 默认拖拽,改由主进程 startDrag 投递真实文件给 OS / 其它应用。
  const onDragStart = (e: React.DragEvent, en: { path: string }) => {
    if (!window.tangu?.startHostDrag) return
    e.preventDefault()
    window.tangu.startHostDrag(en.path)
  }

  if (preview) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <button className="btn ghost sm" onClick={() => setPreview(null)}><ChevronLeft size={13} /> {t('panel.back')}</button>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {preview.name}
          </span>
        </div>
        {preview.tooLarge ? (
          <div className="panel-note">{t('panel.preview.tooLarge', { size: fmtSize(preview.size) })}</div>
        ) : isImage(preview.mimeType) ? (
          <img src={`data:${preview.mimeType};base64,${preview.content}`} style={{ maxWidth: '100%', borderRadius: 'var(--radius-md)' }} />
        ) : isText(preview.mimeType) || preview.mimeType === 'application/octet-stream' ? (
          <pre style={{
            fontSize: 11.5, fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            background: 'var(--bg-card)', border: 'var(--border-width) solid var(--border)',
            borderRadius: 'var(--radius-md)', padding: 10, maxHeight: '70vh', overflowY: 'auto',
          }}>
            {safeAtobUtf8(preview.content, t('panel.preview.decodeFailed'))}
          </pre>
        ) : (
          <div className="panel-note">{t('panel.preview.binaryNoPreview')}</div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
        <span className="panel-section-title" style={{ flex: 1, padding: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={curDir}>
          {rel ? `…/${rel}` : (cwd.split(/[/\\]/).filter(Boolean).pop() || cwd)}
        </span>
        <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => { setNewFolder(true); setNewFolderVal('') }} title={t('panel.action.newFolder')}>
          <FolderPlus size={13} />
        </button>
        <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => window.tangu?.revealHostPath?.(curDir)} title={t('panel.action.openCurDirInFileManager')}>
          <ExternalLink size={13} />
        </button>
        <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => void refresh()} title={t('panel.action.refresh')}>
          {loading ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
        </button>
      </div>
      {newFolder && (
        <div className="file-row" style={{ cursor: 'default' }}>
          <Folder size={13} style={{ color: 'var(--accent)' }} />
          <input
            autoFocus
            className="file-rename-input"
            value={newFolderVal}
            placeholder={t('panel.placeholder.newFolderName')}
            onChange={(e) => setNewFolderVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void commitNewFolder(); else if (e.key === 'Escape') { setNewFolder(false); setNewFolderVal('') } }}
            onBlur={() => { setNewFolder(false); setNewFolderVal('') }}
          />
          <span className="file-act" style={{ opacity: 1 }}>
            <button className="icon-btn" style={{ width: 22, height: 22 }} title={t('panel.action.create')} onMouseDown={(e) => { e.preventDefault(); void commitNewFolder() }}><Check size={12} /></button>
            <button className="icon-btn" style={{ width: 22, height: 22 }} title={t('panel.action.cancel')} onMouseDown={(e) => { e.preventDefault(); setNewFolder(false); setNewFolderVal('') }}><X size={12} /></button>
          </span>
        </div>
      )}
      {!atRoot && (
        <button className="file-row" onClick={() => setCurDir(parentOf(curDir))}>
          <CornerLeftUp size={13} />
          <span className="file-name">{t('panel.parentDir')}</span>
        </button>
      )}
      {entries.length === 0 && !loading && !newFolder && <div className="panel-note">{t('panel.emptyDir')}</div>}
      {entries.map((en) => (
        <div
          className="file-row"
          key={en.path}
          role="button"
          tabIndex={0}
          draggable={renaming !== en.path}
          onDragStart={(e) => onDragStart(e, en)}
          onClick={() => { if (renaming !== en.path) void open(en) }}
          onKeyDown={(e) => { if (renaming !== en.path && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); void open(en) } }}
        >
          {en.isDir ? <Folder size={13} style={{ color: 'var(--accent)' }} /> : en.size && /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(en.name) ? <ImageIcon size={13} /> : <FileText size={13} />}
          {renaming === en.path ? (
            <input
              autoFocus
              className="file-rename-input"
              value={renameVal}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setRenameVal(e.target.value)}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') void commitRename(en); else if (e.key === 'Escape') setRenaming(null) }}
              onBlur={() => setRenaming(null)}
            />
          ) : (
            <span className="file-name">{en.name}</span>
          )}
          {renaming === en.path ? (
            <span className="file-act" style={{ opacity: 1 }}>
              <button className="icon-btn" style={{ width: 22, height: 22 }} title={t('panel.action.confirm')} onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); void commitRename(en) }}><Check size={12} /></button>
              <button className="icon-btn" style={{ width: 22, height: 22 }} title={t('panel.action.cancel')} onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setRenaming(null) }}><X size={12} /></button>
            </span>
          ) : (
            <>
              {!en.isDir && <span className="file-size">{fmtSize(en.size)}</span>}
              <span className="file-act">
                <button className="icon-btn" style={{ width: 22, height: 22 }} title={t('panel.action.rename')} onClick={(e) => { e.stopPropagation(); beginRename(en) }}><Pencil size={12} /></button>
                <button className="icon-btn" style={{ width: 22, height: 22 }} title={t('panel.action.revealInFileManager')} onClick={(e) => { e.stopPropagation(); reveal(en) }}><ExternalLink size={12} /></button>
                <button className="icon-btn" style={{ width: 22, height: 22 }} title={t('panel.action.moveToTrash')} onClick={(e) => { e.stopPropagation(); void trash(en) }}><Trash2 size={12} /></button>
              </span>
            </>
          )}
        </div>
      ))}
    </div>
  )
}

const SandboxFilesTab: React.FC<{
  cfg: TanguDesktopConfig
  sessionId: string
  sessionConfig?: AgentConfig
  running: boolean
  onToast: (t: string, e?: boolean) => void
}> = ({ cfg, sessionId, sessionConfig, running, onToast }) => {
  const { t } = useI18n()
  const [files, setFiles] = useState<WorkspaceFileMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<{ path: string; mimeType: string; content: string } | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setFiles(await api.listWorkspace(cfg, sessionId))
    } catch (e: any) {
      onToast(t('panel.toast.workspaceLoadFail', { err: e?.message || e }), true)
    } finally {
      setLoading(false)
    }
  }, [cfg, sessionId, onToast])

  useEffect(() => {
    void refresh()
  }, [refresh, running]) // run 结束(running 变化)后刷新,看到新产物

  const open = async (f: WorkspaceFileMeta) => {
    try {
      const r = await api.readWorkspaceFile(cfg, sessionId, f.path)
      setPreview({ path: f.path, mimeType: r.mimeType, content: r.content })
    } catch (e: any) {
      onToast(t('panel.toast.readFail', { err: e?.message || e }), true)
    }
  }

  const upload = async (list: FileList | null) => {
    if (!list?.length) return
    const payload = await Promise.all(
      Array.from(list).map(async (f) => {
        const buf = new Uint8Array(await f.arrayBuffer())
        let bin = ''
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
        return { path: f.name, content: btoa(bin), encoding: 'base64' as const, mimeType: f.type }
      }),
    )
    try {
      const r = await api.uploadWorkspaceFiles(cfg, sessionId, payload)
      onToast(t('panel.toast.uploaded', { saved: r.saved, total: r.total }))
      void refresh()
    } catch (e: any) {
      onToast(t('panel.toast.uploadFail', { err: e?.message || e }), true)
    }
  }

  const isText = (m: string) => m.startsWith('text/') || /json|xml|javascript|csv/.test(m)
  const isImage = (m: string) => m.startsWith('image/')

  if (preview) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <button className="btn ghost sm" onClick={() => setPreview(null)}>← {t('panel.back')}</button>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {preview.path}
          </span>
        </div>
        {isImage(preview.mimeType) ? (
          <img src={`data:${preview.mimeType};base64,${preview.content}`} style={{ maxWidth: '100%', borderRadius: 'var(--radius-md)' }} />
        ) : isText(preview.mimeType) ? (
          <pre style={{
            fontSize: 11.5, fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            background: 'var(--bg-card)', border: 'var(--border-width) solid var(--border)',
            borderRadius: 'var(--radius-md)', padding: 10, maxHeight: '70vh', overflowY: 'auto',
          }}>
            {safeAtobUtf8(preview.content, t('panel.preview.decodeFailed'))}
          </pre>
        ) : (
          <div className="panel-note">{t('panel.preview.binaryDownload')}</div>
        )}
      </div>
    )
  }

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        void upload(e.dataTransfer.files)
      }}
    >
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        <span className="panel-section-title" style={{ flex: 1, padding: 0 }}>{t('panel.sessionFiles')}</span>
        <label className="icon-btn" style={{ width: 24, height: 24 }} title={t('panel.action.uploadFile')}>
          <Upload size={13} />
          <input type="file" multiple hidden onChange={(e) => { void upload(e.target.files); e.target.value = '' }} />
        </label>
        <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => void refresh()} title={t('panel.action.refresh')}>
          {loading ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
        </button>
      </div>
      {files.length === 0 && <div className="panel-note">{t('panel.noFilesYet')}</div>}
      {files.map((f) => (
        <div className="file-row" key={f.path} onClick={() => void open(f)} role="button" tabIndex={0}>
          {f.mimeType.startsWith('image/') ? <ImageIcon size={13} /> : <FileText size={13} />}
          <span className="file-name">{f.path.replace(/^\//, '')}</span>
          <span className="file-size">{fmtSize(f.size)}</span>
          <span className="file-act">
            <button
              className="icon-btn"
              style={{ width: 22, height: 22 }}
              title={t('panel.action.download')}
              onClick={(e) => {
                e.stopPropagation()
                void api.downloadWorkspaceFile(cfg, sessionId, f.path).catch((err) => onToast(err.message, true))
              }}
            >
              <Download size={12} />
            </button>
            <button
              className="icon-btn"
              style={{ width: 22, height: 22 }}
              title={t('panel.action.delete')}
              onClick={(e) => {
                e.stopPropagation()
                void api.deleteWorkspaceFile(cfg, sessionId, f.path).then(() => refresh()).catch((err) => onToast(err.message, true))
              }}
            >
              <Trash2 size={12} />
            </button>
          </span>
        </div>
      ))}
    </div>
  )
}

// ── 记忆·日志 ────────────────────────────────────────────────────────────────

const MemoryTab: React.FC<{
  cfg: TanguDesktopConfig
  onToast: (t: string, e?: boolean) => void
}> = ({ cfg, onToast }) => {
  const { t } = useI18n()
  const [memory, setMemory] = useState<string | null>(null)
  const [log, setLog] = useState<{ date: string; content: string } | null>(null)
  const [logDate, setLogDate] = useState('')
  const [draft, setDraft] = useState('')

  const refresh = useCallback(async () => {
    try {
      const m = await api.getMemory(cfg)
      setMemory(m.content || '')
    } catch (e: any) {
      setMemory(null)
      onToast(t('panel.toast.memoryLoadFail', { err: e?.message || e }), true)
    }
    try {
      const l = await api.getLog(cfg, logDate || undefined)
      setLog({ date: l.date, content: l.content || '' })
    } catch { /* log 可选 */ }
  }, [cfg, logDate, onToast])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const append = async () => {
    const text = draft.trim()
    if (!text) return
    try {
      const r = await api.appendMemory(cfg, text)
      onToast(r.appended ? t('panel.toast.memorySaved') : t('panel.toast.memoryNotWritten'))
      setDraft('')
      void refresh()
    } catch (e: any) {
      onToast(t('panel.toast.appendFail', { err: e?.message || e }), true)
    }
  }

  return (
    <div>
      <div className="panel-section-title">{t('panel.memory.title')}</div>
      {memory === null && <div className="panel-note">{t('panel.memory.notConnected')}</div>}
      {memory !== null && (
        memory ? (
          <div style={{ fontSize: 12.5, padding: '0 8px' }} className="msg-content">
            <Markdown content={memory} />
          </div>
        ) : (
          <div className="panel-note">{t('panel.memory.empty')}</div>
        )
      )}
      <div style={{ display: 'flex', gap: 6, padding: '8px 8px 0' }}>
        <input
          type="text"
          value={draft}
          placeholder={t('panel.memory.appendPlaceholder')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void append()}
          style={{
            flex: 1, fontSize: 12.5, padding: '5px 8px', background: 'var(--bg-card)',
            border: 'var(--border-width) solid var(--border)', borderRadius: 'var(--radius-sm)', outline: 'none',
          }}
        />
        <button className="btn ghost sm" onClick={() => void append()}>{t('panel.memory.append')}</button>
      </div>

      <div className="panel-section-title" style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
        {t('panel.activityLog')}
        <input
          type="date"
          value={logDate}
          onChange={(e) => setLogDate(e.target.value)}
          style={{
            fontSize: 11, background: 'var(--bg-card)', color: 'var(--text-muted)',
            border: 'var(--border-width) solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '1px 4px',
          }}
        />
      </div>
      {log && (
        log.content ? (
          <div style={{ fontSize: 12.5, padding: '0 8px' }} className="msg-content">
            <Markdown content={log.content} />
          </div>
        ) : (
          <div className="panel-note">{t('panel.log.empty', { date: log.date })}</div>
        )
      )}
    </div>
  )
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** base64 → UTF-8 文本(atob 直接转会乱码)。 */
function safeAtobUtf8(b64: string, decodeFailMsg = '(decode failed)'): string {
  try {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new TextDecoder().decode(bytes)
  } catch {
    return decodeFailMsg
  }
}
