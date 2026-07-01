import { useMemo, useState, type ComponentType } from 'react'
import { usePageStore } from '../store/pageStore'
import { useUiStore } from '../store/uiStore'
import { usePluginStore } from '../plugins/pluginStore'
import { buildTree } from '../lib/pageTree'
import { FolderTree, type CtxTarget } from './FolderTree'
import { TagPane } from './TagPane'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { ConfirmDialog, PromptDialog, FolderPickerDialog } from './Dialogs'
import { amadeus } from '../api'

type Dialog =
  | { type: 'rename-page'; path: string; initial: string }
  | { type: 'move-page'; path: string }
  | { type: 'delete-page'; path: string; name: string }
  | { type: 'new-folder'; parent: string }
  | { type: 'rename-folder'; path: string; initial: string }
  | { type: 'delete-folder'; path: string; name: string }

function parentFolderOf(pagePath: string): string {
  const parts = pagePath.split('/')
  parts.pop()
  return parts.join('/')
}

export function VaultSidebar() {
  const vaultRoot = usePageStore((s) => s.vaultRoot)
  const pages = usePageStore((s) => s.pages)
  const folders = usePageStore((s) => s.folders)
  const activePage = usePageStore((s) => s.activePage)
  const openVault = usePageStore((s) => s.openVault)
  const loadPage = usePageStore((s) => s.loadPage)
  const renamePage = usePageStore((s) => s.renamePage)
  const createPage = usePageStore((s) => s.createPage)
  const createPageInFolder = usePageStore((s) => s.createPageInFolder)
  const deletePage = usePageStore((s) => s.deletePage)
  const movePage = usePageStore((s) => s.movePage)
  const createFolder = usePageStore((s) => s.createFolder)
  const renameFolder = usePageStore((s) => s.renameFolder)
  const deleteFolder = usePageStore((s) => s.deleteFolder)

  const setPalette = useUiStore((s) => s.setPalette)
  const panels = usePluginStore((s) => s.panels)
  const [menu, setMenu] = useState<{ items: MenuItem[]; x: number; y: number } | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const tree = useMemo(() => buildTree(pages, folders), [pages, folders])

  const notify = useUiStore((s) => s.notify)
  const reveal = async (targetPath: string): Promise<void> => {
    try {
      await amadeus.revealInFileManager(targetPath)
    } catch (e) {
      notify(`无法在文件管理器中显示：${String(e)}`)
    }
  }

  const renamePageAt = async (path: string, newName: string): Promise<void> => {
    if (path !== activePage) await loadPage(path)
    await renamePage(newName)
  }

  const onContext = (target: CtxTarget, x: number, y: number): void => {
    const items: MenuItem[] =
      target.kind === 'file'
        ? [
            { label: '打开', onClick: () => void loadPage(target.path) },
            { label: '重命名', onClick: () => setDialog({ type: 'rename-page', path: target.path, initial: target.name }) },
            { label: '移动到…', onClick: () => setDialog({ type: 'move-page', path: target.path }) },
            { label: '在文件管理器中显示', onClick: () => void reveal(target.path) },
            { label: '删除', danger: true, onClick: () => setDialog({ type: 'delete-page', path: target.path, name: target.name }) },
          ]
        : [
            { label: '新建页面', onClick: () => void createPageInFolder(target.path) },
            { label: '新建子文件夹', onClick: () => setDialog({ type: 'new-folder', parent: target.path }) },
            { label: '重命名', onClick: () => setDialog({ type: 'rename-folder', path: target.path, initial: target.name }) },
            { label: '在文件管理器中显示', onClick: () => void reveal(target.path) },
            { label: '删除', danger: true, onClick: () => setDialog({ type: 'delete-folder', path: target.path, name: target.name }) },
          ]
    setMenu({ items, x, y })
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="brand">Amadeus</div>
        <div className="sidebar-head-actions">
          <button className="icon-btn" title="设置" onClick={() => setPalette('settings')}>
            ⚙
          </button>
          <button className="btn-ghost" onClick={() => void openVault()}>
            {vaultRoot ? '切换' : '打开 Vault'}
          </button>
        </div>
      </div>
      {vaultRoot && (
        <div className="vault-path" title={vaultRoot}>
          {vaultRoot}
        </div>
      )}
      <div className="page-list">
        <FolderTree node={tree} depth={0} onContext={onContext} />
        {vaultRoot && pages.length === 0 && folders.length === 0 && (
          <div className="hint">这个 Vault 还没有页面</div>
        )}
      </div>
      <TagPane />
      {vaultRoot && panels.map((o) => (
        <SidebarPanel key={o.item.id} title={o.item.title} Component={o.item.component} />
      ))}
      {vaultRoot && (
        <div className="sidebar-foot">
          <button className="btn-new" onClick={() => void createPage()}>
            ＋ 新页面
          </button>
          <button
            className="btn-new btn-new-folder"
            title="在根目录新建文件夹"
            onClick={() => setDialog({ type: 'new-folder', parent: '' })}
          >
            ＋ 文件夹
          </button>
        </div>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}

      {dialog?.type === 'rename-page' && (
        <PromptDialog
          title="重命名页面"
          initial={dialog.initial}
          confirmLabel="重命名"
          onConfirm={(v) => void renamePageAt(dialog.path, v)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'move-page' && (
        <FolderPickerDialog
          title="移动到文件夹"
          folders={folders}
          currentFolder={parentFolderOf(dialog.path)}
          onPick={(folder) => void movePage(dialog.path, folder)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'delete-page' && (
        <ConfirmDialog
          title={`删除页面「${dialog.name}」？`}
          message="此操作会删除该页面及其所有块文件，无法撤销。"
          onConfirm={() => void deletePage(dialog.path)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'new-folder' && (
        <PromptDialog
          title="新建文件夹"
          label={dialog.parent ? `位置：${dialog.parent}` : '位置：根目录'}
          confirmLabel="创建"
          onConfirm={(v) => void createFolder(dialog.parent, v)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'rename-folder' && (
        <PromptDialog
          title="重命名文件夹"
          initial={dialog.initial}
          confirmLabel="重命名"
          onConfirm={(v) => void renameFolder(dialog.path, v)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'delete-folder' && (
        <ConfirmDialog
          title={`删除文件夹「${dialog.name}」？`}
          message="文件夹内的所有页面与子文件夹都会被删除，无法撤销。"
          onConfirm={() => void deleteFolder(dialog.path)}
          onClose={() => setDialog(null)}
        />
      )}
    </aside>
  )
}

function SidebarPanel({ title, Component }: { title: string; Component: ComponentType }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="side-panel">
      <button className="side-panel-head" onClick={() => setOpen((o) => !o)}>
        <span className="backlinks-chevron">{open ? '▾' : '▸'}</span>
        {title}
      </button>
      {open && (
        <div className="side-panel-body">
          <Component />
        </div>
      )}
    </div>
  )
}
