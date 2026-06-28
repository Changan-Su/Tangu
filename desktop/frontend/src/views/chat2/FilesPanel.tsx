/** 文件面板(右侧栏):镜像会话侧栏结构 —— 列所有本地工作区文件夹(手风琴:展开一个,收起其余),
 *  展开后用 Electron listDir 列真实磁盘目录,子文件夹可逐级展开;点文件 = 预览。
 *  云端工作区(无磁盘路径)暂不在此面板(之后再开发)。 */
import { useCallback, useEffect, useState } from 'react'
import { ChevronRight, ChevronDown, Folder, FolderOpen, RefreshCw } from 'lucide-react'
import type { WorkspaceDescriptor } from '../../types'
import type { PreviewTarget } from '../../components/WorkspaceFilePreview'
import { useI18n } from '../../i18n'
import { iconForFile, mimeForExt, fmtSize, b64ToBytes } from '../../services/fileKinds'
import { AnimatedCollapse } from '../../components/AnimatedUI'
import './sidebar2.css'

interface Entry { name: string; isDir: boolean; size: number; path: string }

const sortEntries = (es: Entry[]): Entry[] =>
  [...es].sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))

/** 本机文件 → 预览目标(主进程 readHostFile;过大返回占位,下载=在文件管理器显示)。 */
function previewTargetFor(e: Entry): PreviewTarget {
  return {
    name: e.name,
    load: async () => {
      const r = await window.tangu?.readHostFile?.(e.path)
      if (!r) return null
      if (r.tooLarge) return { tooLarge: true, size: r.size }
      return { mimeType: r.mimeType, bytes: b64ToBytes(r.content), size: r.size }
    },
    download: () => { void window.tangu?.revealHostPath?.(e.path) },
  }
}

/** 目录节点:惰性加载,可递归展开。 */
function DirRow({ entry, depth, onOpenFile }: { entry: Entry; depth: number; onOpenFile: (e: Entry) => void }) {
  const [open, setOpen] = useState(false)
  const [kids, setKids] = useState<Entry[] | null>(null)
  useEffect(() => {
    if (!open || kids) return
    let alive = true
    void window.tangu?.listDir?.(entry.path)
      .then((es) => { if (alive) setKids(sortEntries(es as Entry[])) })
      .catch(() => { if (alive) setKids([]) })
    return () => { alive = false }
  }, [open, kids, entry.path])
  return (
    <>
      <button className="t2sf-row" style={{ paddingLeft: 6 + depth * 14 }} onClick={() => setOpen((o) => !o)} title={entry.name}>
        <span className="t2sf-chev">{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
        {open ? <FolderOpen size={14} className="t2sf-fic" /> : <Folder size={14} className="t2sf-fic" />}
        <span className="t2sf-name">{entry.name}</span>
      </button>
      <AnimatedCollapse open={open}>
        {kids === null
          ? <div className="t2sf-loading" style={{ paddingLeft: 6 + (depth + 1) * 14 + 16 }}>…</div>
          : <>{kids.map((k) => k.isDir
            ? <DirRow key={k.path} entry={k} depth={depth + 1} onOpenFile={onOpenFile} />
            : <FileRow key={k.path} entry={k} depth={depth + 1} onOpenFile={onOpenFile} />)}</>}
      </AnimatedCollapse>
    </>
  )
}

function FileRow({ entry, depth, onOpenFile }: { entry: Entry; depth: number; onOpenFile: (e: Entry) => void }) {
  const Icon = iconForFile(mimeForExt(entry.path) || '', entry.path)
  return (
    <button className="t2sf-row t2sf-file" style={{ paddingLeft: 6 + depth * 14 }} onClick={() => onOpenFile(entry)} title={entry.name}>
      <span className="t2sf-chev" />
      <Icon size={14} className="t2sf-fic" />
      <span className="t2sf-name">{entry.name}</span>
      {entry.size > 0 && <span className="t2sf-size">{fmtSize(entry.size)}</span>}
    </button>
  )
}

export function FilesPanel({ workspaces, onOpenPreview, activeWorkspaceKey, onEnterWorkspace }: {
  workspaces: WorkspaceDescriptor[]
  onOpenPreview: (t: PreviewTarget) => void
  /** 共享「进入的工作区」key(与会话面板手风琴同步)。 */
  activeWorkspaceKey?: string | null
  onEnterWorkspace?: (key: string | null) => void
}) {
  const { t } = useI18n()
  const locals = workspaces.filter((w) => w.kind === 'local' && !!w.path)
  const [rootsByKey, setRootsByKey] = useState<Record<string, Entry[] | null>>({})
  const openFile = (e: Entry): void => onOpenPreview(previewTargetFor(e))

  const loadRoot = useCallback((key: string, path: string) => {
    setRootsByKey((m) => ({ ...m, [key]: m[key] ?? null }))
    void window.tangu?.listDir?.(path)
      .then((es) => setRootsByKey((m) => ({ ...m, [key]: sortEntries(es as Entry[]) })))
      .catch(() => setRootsByKey((m) => ({ ...m, [key]: [] })))
  }, [])

  // 手风琴(共享):点工作区头 = 就地展开/收起(与会话面板手风琴同步)。
  // 只展开,不再强制把工作区 detail 顶到主区;要进主区从会话侧栏的「查看更多」走。
  const toggleWs = (ws: WorkspaceDescriptor): void => {
    onEnterWorkspace?.(activeWorkspaceKey === ws.key ? null : ws.key)
  }

  // 当前进入的本地工作区首次展开时加载磁盘根目录。
  useEffect(() => {
    if (!activeWorkspaceKey) return
    const w = locals.find((x) => x.key === activeWorkspaceKey)
    if (w?.path && rootsByKey[activeWorkspaceKey] === undefined) loadRoot(activeWorkspaceKey, w.path)
  }, [activeWorkspaceKey, locals, rootsByKey, loadRoot])

  if (!locals.length) return <div className="panel-note" style={{ padding: '18px 12px' }}>{t('panel.files.noLocalWs')}</div>

  return (
    <aside className="t2s-side">
      <div className="t2s-scroll">
        {locals.map((ws) => {
          const open = activeWorkspaceKey === ws.key
          const roots = rootsByKey[ws.key]
          return (
            <div key={ws.key}>
              <div className="t2s-group">
                <button className="t2s-group-toggle" onClick={() => toggleWs(ws)} title={ws.path || undefined}>
                  <span className="t2s-chev">{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
                  <span className="t2s-group-name"><Folder size={12} /><span className="t2s-group-label">{ws.name}</span></span>
                </button>
                <button className="t2s-group-add" title={t('panel.files.refresh')} onClick={() => { if (ws.path) loadRoot(ws.key, ws.path) }}><RefreshCw size={13} /></button>
              </div>
              <AnimatedCollapse open={open}>
                <div className="t2sf-tree">
                  {roots == null ? <div className="t2sf-loading" style={{ paddingLeft: 22 }}>…</div>
                    : roots.length === 0 ? <div className="t2sf-empty">{t('panel.files.empty')}</div>
                    : roots.map((e) => e.isDir
                      ? <DirRow key={e.path} entry={e} depth={1} onOpenFile={openFile} />
                      : <FileRow key={e.path} entry={e} depth={1} onOpenFile={openFile} />)}
                </div>
              </AnimatedCollapse>
            </div>
          )
        })}
      </div>
    </aside>
  )
}
