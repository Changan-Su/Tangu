import { promises as fs } from 'node:fs'
import path from 'node:path'
import { ipcMain, shell, type BrowserWindow } from 'electron'
import { IPC, type DbReadResult, type ExternalPluginSource } from '@amadeus-shared/ipc'
import { dbFileSchema, parseDb, serializeDb } from '@amadeus-shared/db/schema'
import { loadPage, newPage, pageFileName, savePage } from '@amadeus-shared/compiler'
import type { PageManifest } from '@amadeus-shared/compiler'
import { VaultManager } from './fs/vaultManager'
import { VaultWatcher } from './fs/watcher'
import { VaultIndex } from './fs/vaultIndex'
import { readConfig, writeConfig } from './settings'

const nowIso = (): string => new Date().toISOString()

const SAMPLE_MANIFEST = `{
  "id": "hello-amadeus",
  "name": "Hello Amadeus",
  "version": "1.0.0",
  "description": "示例插件：演示命令、slash 项与主题三种贡献点。",
  "main": "main.js"
}
`

// The plugin body runs with \`ctx\` in scope and may return a disposer (see PluginContext).
const SAMPLE_MAIN = `// Hello Amadeus —— 示例插件。文件体即 setup(ctx)，可 return 一个清理函数。
ctx.registerCommand({
  id: 'hello',
  title: 'Hello：打个招呼',
  keywords: 'hello hi 你好 shili',
  run: () => ctx.app.notify('你好，来自示例插件 👋'),
})
ctx.registerSlashItem({
  id: 'signature',
  label: '示例签名',
  icon: '✶',
  group: '示例',
  scaffold: '> —— 由 Amadeus 示例插件插入\\n\\n',
  keywords: 'sign 签名 shili sample',
})
ctx.registerTheme({
  id: 'sky',
  label: '天蓝',
  swatch: '#38bdf8',
  css: "[data-theme='sky'][data-mode='light']{--primary:#0284c7;--primary-2:#0369a1;--on-primary:#ffffff} [data-theme='sky'][data-mode='dark']{--primary:#38bdf8;--primary-2:#7dd3fc;--on-primary:#04283b}",
})
return () => {}
`

export function registerIpc(getWindow: () => BrowserWindow | null): {
  getVaultRoot: () => string | null
} {
  const vault = new VaultManager()
  const index = new VaultIndex(vault)
  let structureTimer: ReturnType<typeof setTimeout> | null = null

  const watcher = new VaultWatcher(
    vault,
    (pagePath) => {
      void index.update(pagePath) // keep search/backlinks/embeds fresh on external edits
      getWindow()?.webContents.send(IPC.externalChange, pagePath)
    },
    () => {
      // External add/remove of pages or folders → debounce a reindex + notify the renderer.
      if (structureTimer) clearTimeout(structureTimer)
      structureTimer = setTimeout(() => {
        structureTimer = null
        void index.build()
        getWindow()?.webContents.send(IPC.structureChange)
      }, 300)
    },
  )
  const rememberPage = (pagePath: string): Promise<void> => writeConfig({ lastPage: pagePath })

  ipcMain.handle(IPC.openVault, async () => {
    const root = await vault.openDialog()
    if (!root) return null
    watcher.start(root)
    await writeConfig({ lastVault: root, lastPage: undefined })
    await index.build()
    return { root, pages: await vault.listPages(), folders: await vault.listFolders() }
  })

  ipcMain.handle(IPC.restoreVault, async () => {
    const { lastVault, lastPage } = await readConfig()
    if (!lastVault) return null
    try {
      const stat = await fs.stat(lastVault)
      if (!stat.isDirectory()) return null
    } catch {
      return null
    }
    vault.setRoot(lastVault)
    watcher.start(lastVault)
    const pages = await vault.listPages()
    const folders = await vault.listFolders()
    await index.build()
    return {
      root: lastVault,
      pages,
      folders,
      lastPage: lastPage && pages.includes(lastPage) ? lastPage : undefined,
    }
  })

  ipcMain.handle(IPC.listPages, () => vault.listPages())
  ipcMain.handle(IPC.listFiles, () => vault.listFiles())

  ipcMain.handle(IPC.loadPage, async (_e, pagePath: string) => {
    const page = await loadPage(vault.pageIO(pagePath), pagePath, nowIso())
    await rememberPage(pagePath)
    return page
  })

  // 只读加载(模板读取等):不写 lastPage,不当成「打开」;文件不存在直接报错——
  // 编译器 loadPage 缺文件会 newPage 落盘,只读语义下不允许悄悄造文件。
  ipcMain.handle(IPC.readPage, async (_e, pagePath: string) => {
    const io = vault.pageIO(pagePath)
    if (!(await io.exists(pageFileName(pagePath)))) throw new Error(`note not found: ${pagePath}`)
    return loadPage(io, pagePath, nowIso())
  })

  ipcMain.handle(IPC.newPage, async (_e, pagePath: string) => {
    const page = await newPage(vault.pageIO(pagePath), pagePath, nowIso())
    await rememberPage(pagePath)
    await index.update(pagePath)
    return page
  })

  ipcMain.handle(
    IPC.savePage,
    async (_e, pagePath: string, manifest: PageManifest, contents: Record<string, string>) => {
      await savePage(vault.pageIO(pagePath), pagePath, manifest, { contents })
      await index.update(pagePath)
    },
  )

  ipcMain.handle(
    IPC.renamePage,
    async (
      _e,
      oldPath: string,
      newName: string,
      manifest: PageManifest,
      contents: Record<string, string>,
    ) => {
      // Same folder only; sanitize the name (no path separators / traversal).
      const dir = path.dirname(oldPath)
      let base = newName.trim().replace(/[\\/]/g, '')
      if (!base) throw new Error('页面名不能为空')
      if (base.toLowerCase().endsWith('.md')) base = base.slice(0, -3)
      const newPath = dir === '.' ? `${base}.md` : `${dir}/${base}.md`
      if (newPath === oldPath) {
        return { newPath: oldPath, page: await loadPage(vault.pageIO(oldPath), oldPath, nowIso()) }
      }
      if (await vault.pathExists(newPath)) throw new Error('目标页面已存在')
      // v3 is single-file: persist in-flight edits, then move the one .md.
      await savePage(vault.pageIO(oldPath), oldPath, manifest, { contents })
      await vault.moveEntry(oldPath, newPath)
      await index.rename(oldPath, newPath)
      await rememberPage(newPath)
      const page = await loadPage(vault.pageIO(newPath), newPath, nowIso())
      return { newPath, page }
    },
  )

  ipcMain.handle(
    IPC.reconcilePage,
    async (_e, pagePath: string, _prevManifest: PageManifest, _prevContents: Record<string, string>) => {
      // v3 is single-file: an external edit just reloads (the .md is the single source).
      const page = await loadPage(vault.pageIO(pagePath), pagePath, nowIso())
      await index.update(pagePath)
      return page
    },
  )

  ipcMain.handle(
    IPC.saveAsset,
    (_e, pagePath: string, fileName: string, bytes: Uint8Array) =>
      vault.writeAsset(pagePath, fileName, bytes),
  )

  ipcMain.handle(
    IPC.saveAttachment,
    (_e, pagePath: string, fileName: string, bytes: Uint8Array, opts: { mode: 'attachments' | 'same' | 'vault'; folder: string }) =>
      vault.writeAttachment(pagePath, fileName, bytes, opts),
  )

  ipcMain.handle(IPC.openAttachment, async (_e, pagePath: string, ref: string) => {
    const abs = await vault.resolveAttachment(pagePath, ref)
    if (abs) await shell.openPath(abs)
  })

  // Database(.db JSON):read 按 ref 解析(与附件同一 basename 语义),write 按 read 返回的精确相对路径。
  ipcMain.handle(IPC.dbRead, async (_e, pagePath: string, ref: string): Promise<DbReadResult> => {
    const abs = await vault.resolveAttachment(pagePath, ref)
    if (!abs) return { status: 'missing' }
    const root = vault.getRoot()
    if (!root) return { status: 'missing' }
    const rel = path.relative(root, abs)
    let text: string
    try {
      text = await fs.readFile(abs, 'utf8')
    } catch {
      return { status: 'missing' }
    }
    const r = parseDb(text)
    return r.ok
      ? { status: 'ok', path: rel, data: r.data }
      : { status: 'corrupt', path: rel, message: r.error }
  })

  ipcMain.handle(IPC.dbWrite, async (_e, dbPath: string, data: unknown) => {
    const parsed = dbFileSchema.parse(data) // 防御性校验:坏数据拒写,绝不落半截文件
    await vault.writeTextFile(dbPath, serializeDb(parsed))
  })

  ipcMain.handle(IPC.search, (_e, query: string) => index.search(query))
  ipcMain.handle(IPC.backlinks, (_e, pagePath: string) => index.backlinks(pagePath))
  ipcMain.handle(IPC.reindex, () => index.build())
  ipcMain.handle(IPC.listTags, () => index.listTags())
  ipcMain.handle(IPC.pagesByTag, (_e, tag: string) => index.pagesByTag(tag))

  ipcMain.handle(IPC.listFolders, () => vault.listFolders())

  ipcMain.handle(IPC.resolveEmbed, (_e, target: string) => {
    // The inline index already holds each block's content + owning note.
    const hit = index.resolveBlock(target)
    return hit ? { owner: hit.path, content: hit.content, type: hit.type } : null
  })

  ipcMain.handle(IPC.blockBacklinks, (_e, target: string) => index.blockBacklinks(target))

  ipcMain.handle(IPC.deletePage, async (_e, pagePath: string) => {
    await vault.removeEntry(pagePath) // v3: a note is a single .md
    index.remove(pagePath)
  })

  ipcMain.handle(IPC.movePage, async (_e, pagePath: string, destFolder: string) => {
    const fileName = pageFileName(pagePath)
    const dstRel = destFolder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    const newPath = dstRel ? `${dstRel}/${fileName}` : fileName
    if (newPath === pagePath) return pagePath
    if (await vault.pathExists(newPath)) throw new Error('目标位置已存在同名页面')
    await vault.moveEntry(pagePath, newPath)
    index.remove(pagePath)
    await index.update(newPath)
    await rememberPage(newPath)
    return newPath
  })

  ipcMain.handle(IPC.createFolder, async (_e, parentFolder: string, name: string) => {
    const clean = name.trim().replace(/[\\/]/g, '')
    if (!clean) throw new Error('文件夹名不能为空')
    const parent = parentFolder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    const rel = parent ? `${parent}/${clean}` : clean
    if (await vault.pathExists(rel)) throw new Error('同名文件夹已存在')
    await vault.makeDir(rel)
    return rel
  })

  ipcMain.handle(IPC.renameFolder, async (_e, folderPath: string, newName: string) => {
    const clean = newName.trim().replace(/[\\/]/g, '')
    if (!clean) throw new Error('文件夹名不能为空')
    const parentDir = path.dirname(folderPath)
    const parentRel = parentDir === '.' ? '' : parentDir
    const newPath = parentRel ? `${parentRel}/${clean}` : clean
    if (newPath === folderPath) return folderPath
    if (await vault.pathExists(newPath)) throw new Error('同名文件夹已存在')
    await vault.moveEntry(folderPath, newPath)
    await index.build()
    return newPath
  })

  ipcMain.handle(IPC.deleteFolder, async (_e, folderPath: string) => {
    await vault.removeEntry(folderPath)
    await index.build()
  })

  const pluginsDir = (): string | null => {
    const root = vault.getRoot()
    return root ? path.join(root, '.amadeus', 'plugins') : null
  }

  ipcMain.handle(IPC.listPlugins, async (): Promise<ExternalPluginSource[]> => {
    const dir = pluginsDir()
    if (!dir) return []
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return []
    }
    const out: ExternalPluginSource[] = []
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue
      const pdir = path.join(dir, e.name)
      try {
        const m = JSON.parse(await fs.readFile(path.join(pdir, 'manifest.json'), 'utf8')) as {
          id?: string
          name?: string
          version?: string
          description?: string
          main?: string
        }
        const code = await fs.readFile(path.join(pdir, m.main || 'main.js'), 'utf8')
        out.push({
          id: m.id || e.name,
          name: m.name || e.name,
          version: m.version || '0.0.0',
          description: m.description,
          code,
        })
      } catch {
        /* skip malformed plugin */
      }
    }
    return out
  })

  ipcMain.handle(IPC.openPluginsFolder, async () => {
    const dir = pluginsDir()
    if (!dir) throw new Error('请先打开 Vault')
    await fs.mkdir(dir, { recursive: true })
    await shell.openPath(dir)
  })

  ipcMain.handle(IPC.revealInFileManager, async (_e, targetPath: string) => {
    // Clamp to the vault, then select the item in the OS file manager. showItemInFolder
    // opens the parent and highlights the entry — works for both files and folders.
    const abs = vault.absPath(targetPath)
    shell.showItemInFolder(abs)
  })

  ipcMain.handle(IPC.scaffoldPlugin, async () => {
    const dir = pluginsDir()
    if (!dir) throw new Error('请先打开 Vault')
    const pdir = path.join(dir, 'hello-amadeus')
    await fs.mkdir(pdir, { recursive: true })
    await fs.writeFile(path.join(pdir, 'manifest.json'), SAMPLE_MANIFEST, 'utf8')
    await fs.writeFile(path.join(pdir, 'main.js'), SAMPLE_MAIN, 'utf8')
  })

  return { getVaultRoot: () => vault.getRoot() }
}
