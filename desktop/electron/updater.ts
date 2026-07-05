/**
 * 应用内自动更新封装(electron-updater)——检查 / 下载 / 安装(quitAndInstall)三步全手动流程。
 *
 *  - Windows(NSIS)/ Linux(AppImage):走 electron-updater 完整应用内更新(检测→下载→重启安装)。
 *  - macOS:未签名应用无法经 Squirrel.Mac 自装(硬性要求 Developer ID 签名+公证+zip 目标),
 *    因此 mac 仅经 GitHub API 比对最新 release 版本做「检测」,UI 引导用户去 Releases 页手动下载。
 *
 * 所有状态经主窗口 webContents 广播 'updater:status' 给渲染层;dev 未打包态 electron-updater
 * 无 app-update.yml 会抛 → 统一 no-op 返回 phase:'unsupported'。
 */
import { app, BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import { isNewer, notesToString } from './updaterUtil'

// electron-updater 是 CJS 默认导出对象;ESM 下解构取 autoUpdater 最稳。
const { autoUpdater } = electronUpdater

const GH_OWNER = 'Changan-Su'
const GH_REPO = 'Forsion' // 2026-07-05 GitHub 仓已改名(旧名 Tangu 经重定向仍可达,老客户端不断链)

export type UpdaterPhase =
  | 'idle' | 'checking' | 'available' | 'not-available'
  | 'downloading' | 'downloaded' | 'error' | 'unsupported'

export interface UpdaterStatus {
  phase: UpdaterPhase
  version?: string
  releaseNotes?: string
  percent?: number
  error?: string
}

let wired = false
let lastStatus: UpdaterStatus = { phase: 'idle' }

function broadcast(status: UpdaterStatus): void {
  lastStatus = status
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('updater:status', status)
  }
}

/** dev/未打包态:electron-updater 无 app-update.yml 会抛 → 统一 no-op。 */
function unsupported(): boolean {
  return !app.isPackaged
}

function ensureWired(): void {
  if (wired) return
  wired = true
  autoUpdater.autoDownload = false // 手动下载
  autoUpdater.autoInstallOnAppQuit = false // 全程手动:下完不主动在退出时装
  autoUpdater.on('checking-for-update', () => broadcast({ phase: 'checking' }))
  autoUpdater.on('update-available', (info) =>
    broadcast({ phase: 'available', version: info.version, releaseNotes: notesToString(info.releaseNotes) }))
  autoUpdater.on('update-not-available', () => broadcast({ phase: 'not-available' }))
  autoUpdater.on('download-progress', (p) =>
    broadcast({ phase: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) =>
    broadcast({ phase: 'downloaded', version: info.version }))
  autoUpdater.on('error', (err) =>
    broadcast({ phase: 'error', error: err?.message || String(err) }))
}

/** macOS:仅经 GitHub API 检测最新 release 版本(不下载/不自装)。 */
async function checkMac(): Promise<UpdaterStatus> {
  broadcast({ phase: 'checking' })
  try {
    const res = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) throw new Error(`GitHub API ${res.status}`)
    const data: any = await res.json()
    const remote = String(data?.tag_name || '').replace(/^v/i, '')
    if (remote && isNewer(remote, app.getVersion())) {
      broadcast({ phase: 'available', version: remote, releaseNotes: typeof data?.body === 'string' ? data.body : undefined })
    } else {
      broadcast({ phase: 'not-available' })
    }
  } catch (err: any) {
    broadcast({ phase: 'error', error: err?.message || String(err) })
  }
  return lastStatus
}

export function getUpdaterStatus(): UpdaterStatus {
  return lastStatus
}

export async function checkForUpdates(): Promise<UpdaterStatus> {
  if (unsupported()) {
    const s: UpdaterStatus = { phase: 'unsupported' }
    broadcast(s)
    return s
  }
  if (process.platform === 'darwin') return checkMac()
  ensureWired()
  try {
    await autoUpdater.checkForUpdates() // 事件流驱动 UI,不依赖返回值
  } catch (err: any) {
    broadcast({ phase: 'error', error: err?.message || String(err) })
  }
  return lastStatus
}

export async function downloadUpdate(): Promise<void> {
  if (unsupported() || process.platform === 'darwin') return
  ensureWired()
  try {
    await autoUpdater.downloadUpdate()
  } catch (err: any) {
    broadcast({ phase: 'error', error: err?.message || String(err) })
  }
}

/**
 * Win/Linux:退出并安装(isSilent=false 显示安装器,isForceRunAfter=true 装完重启 app)。
 * 调用方(main 的 updater:install 处理器)须先优雅停后端,避免 before-quit 的 app.exit(0)
 * 截断 electron-updater 的退出安装路径。
 */
export function installUpdate(): void {
  if (unsupported() || process.platform === 'darwin') return
  autoUpdater.quitAndInstall(false, true)
}
