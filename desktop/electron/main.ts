/**
 * Tangu 桌面 GUI — Electron 主进程。
 * 负责:建窗 + 配置持久化(IPC)+ 托管内置 tangu-server(managed 模式,backendManager)。
 * agent 调用由 renderer 直连 HTTP/SSE(localhost),不经主进程代理。
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { dirname, join } from 'path'
import { pathToFileURL } from 'url'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { BackendManager, type BackendStatus } from './backendManager'
import {
  forsionDeviceLogin, forsionLogout, forsionWhoami, loadTanguCreds,
} from './forsionAuth'

/** 持久化配置(userData/tangu-desktop-config.json)。 */
interface TanguStoredConfig {
  /** managed=自动托管内置后端;external=连接外部 tangu-server。 */
  mode: 'managed' | 'external'
  backendUrl: string // external 模式
  token: string // external 模式
  modelId: string
  cloudUrl: string // managed:传给 tangu-server 的 Forsion 云端
  cloudToken: string // managed:forsion_token(空则子进程回退 tangu login 凭证)
  sandbox: 'auto' | 'docker' | 'none'
}

const DEFAULT_CONFIG: TanguStoredConfig = {
  mode: 'external',
  backendUrl: 'http://localhost:8787',
  token: '',
  modelId: '',
  cloudUrl: '',
  cloudToken: '',
  sandbox: 'auto',
}

const configPath = (): string => join(app.getPath('userData'), 'tangu-desktop-config.json')

async function loadConfig(): Promise<TanguStoredConfig> {
  let merged: TanguStoredConfig
  try {
    merged = { ...DEFAULT_CONFIG, ...JSON.parse(await readFile(configPath(), 'utf8')) }
  } catch {
    merged = { ...DEFAULT_CONFIG }
  }
  // 环境变量兜底(与包内 standalone/worker 同名约定):配置里没填时生效。
  //   TANGU_CLOUD_URL    Forsion 云端地址(managed 模式 / 登录默认地址)
  //   TANGU_BACKEND_URL  external 模式的外部 tangu-server 地址
  if (!merged.cloudUrl) {
    merged.cloudUrl = process.env.TANGU_CLOUD_URL || loadTanguCreds().cloudUrl || ''
  }
  if (process.env.TANGU_BACKEND_URL && merged.backendUrl === DEFAULT_CONFIG.backendUrl) {
    merged.backendUrl = process.env.TANGU_BACKEND_URL
  }
  return merged
}
async function saveConfig(patch: Partial<TanguStoredConfig>): Promise<TanguStoredConfig> {
  const merged = { ...(await loadConfig()), ...patch }
  await mkdir(app.getPath('userData'), { recursive: true }).catch(() => {})
  await writeFile(configPath(), JSON.stringify(merged, null, 2), 'utf8')
  return merged
}

const backend = new BackendManager()
let mainWindow: BrowserWindow | null = null

/** renderer 视角的有效配置:managed 就绪时 backendUrl/token 来自托管子进程。 */
async function effectiveConfig(): Promise<TanguStoredConfig & { backendState: BackendStatus; homeDir: string }> {
  const stored = await loadConfig()
  const st = backend.getStatus()
  const homeDir = app.getPath('home')
  if (stored.mode === 'managed' && st.state === 'ready' && st.url) {
    return { ...stored, backendUrl: st.url, token: backend.getToken(), backendState: st, homeDir }
  }
  return { ...stored, backendState: st, homeDir }
}

// 串行化:连续 config:set(如先改 cloudUrl 再改 sandbox)触发的多次 ensureBackend
// 排队执行,避免并发 start() 双 spawn/端口竞争。
let ensureChain: Promise<void> = Promise.resolve()
function ensureBackend(): Promise<void> {
  ensureChain = ensureChain.then(async () => {
    const stored = await loadConfig()
    if (stored.mode !== 'managed') {
      await backend.stop()
      return
    }
    await backend.start({
      cloudUrl: stored.cloudUrl,
      cloudToken: stored.cloudToken,
      modelId: stored.modelId || undefined,
      sandbox: stored.sandbox,
    })
  }).catch((e) => {
    console.error('[tangu-desktop] ensureBackend failed:', e)
  })
  return ensureChain
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 880,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#F5EFE4', // 宣纸白,避免白屏闪烁
    webPreferences: {
      preload: join(__dirname, '../preload/preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox:true 不支持 ESM preload(electron-vite 产出 .mjs);renderer 无 Node 能力,
      // 暴露面仅 contextBridge 的最小 API,风险可控。改 CJS preload 后可翻转。
      sandbox: false,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  ipcMain.handle('config:get', () => effectiveConfig())
  ipcMain.handle('config:set', async (_e, patch: Partial<TanguStoredConfig>) => {
    const before = await loadConfig()
    const merged = await saveConfig(patch)
    // 模式/托管参数变化 → 重启托管后端(切到 external 则停掉)。
    const managedKeys: Array<keyof TanguStoredConfig> = ['mode', 'cloudUrl', 'cloudToken', 'sandbox']
    if (managedKeys.some((k) => patch[k] !== undefined && patch[k] !== before[k])) {
      void ensureBackend()
    }
    return effectiveConfig()
  })
  // 本机模式的工作目录选择(host-exec 的 cwd)。
  ipcMain.handle('dialog:pickDirectory', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow
    const r = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: '选择 Agent 工作目录' })
      : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], title: '选择 Agent 工作目录' })
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0]
  })

  ipcMain.handle('backend:getStatus', () => backend.getStatus())
  ipcMain.handle('backend:getLogs', () => backend.getLogs())
  ipcMain.handle('backend:restart', async () => {
    await ensureBackend()
    return backend.getStatus()
  })

  // ── Forsion 账号 / provider OAuth 登录(与 `tangu login` 同一份凭证)──
  const broadcast = (channel: string, payload: any): void => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
  }

  ipcMain.handle('auth:status', async () => {
    const stored = await loadConfig()
    const creds = loadTanguCreds()
    const cloudUrl = stored.cloudUrl || creds.cloudUrl || ''
    const token = stored.cloudToken || creds.token || ''
    const who = token ? await forsionWhoami(cloudUrl, token) : null
    return {
      loggedIn: !!token,
      cloudUrl,
      username: who?.username || null,
      tokenSource: stored.cloudToken ? 'config' : creds.token ? 'tangu-login' : null,
    }
  })

  ipcMain.handle('auth:forsionLogin', async (_e, cloudUrl?: string) => {
    const stored = await loadConfig()
    const url = (cloudUrl || stored.cloudUrl || '').trim()
    const r = await forsionDeviceLogin(url, (info) => broadcast('auth:device', info))
    // 登录成功:cloudUrl 记进配置(token 留在 auth.json,managed 后端/getToken 自动回退读取);
    // managed 模式重启后端让子进程吃到新凭证。
    await saveConfig({ cloudUrl: r.cloudUrl })
    if (stored.mode === 'managed') void ensureBackend()
    return { ok: true, cloudUrl: r.cloudUrl }
  })

  ipcMain.handle('auth:logout', async () => {
    forsionLogout()
    const stored = await loadConfig()
    if (stored.mode === 'managed') void ensureBackend()
    return { ok: true }
  })

  // provider OAuth(xAI 等):动态 import 包 dist 的 providerOAuth(dev=包根 dist,打包=resources/tangu-server/dist),
  // 与 `tangu login <provider>` 同一实现、同一份 ~/.tangu/provider-auth.json。
  const providerOAuthModule = async (): Promise<any> => {
    const entry = BackendManager.resolveEntry()
    if (!entry) throw new Error('找不到 tangu-server dist(dev 下请先在包根 npm run build)')
    const distRoot = dirname(dirname(entry)) // …/dist/standalone/main.js → …/dist
    return import(pathToFileURL(join(distRoot, 'llm', 'providerOAuth.js')).href)
  }

  ipcMain.handle('auth:providers', async () => {
    try {
      const m = await providerOAuthModule()
      const ids: string[] = Object.keys(m.OAUTH_PROVIDERS || {})
      const logged = new Set<string>()
      try {
        const credsPath = join(app.getPath('home'), '.tangu', 'provider-auth.json')
        const raw = JSON.parse(await readFile(credsPath, 'utf8'))
        for (const k of Object.keys(raw || {})) logged.add(k)
      } catch { /* 未登录过 */ }
      return ids.map((id) => ({ id, loggedIn: logged.has(id) }))
    } catch {
      return []
    }
  })

  ipcMain.handle('auth:providerLogin', async (_e, id: string) => {
    const m = await providerOAuthModule()
    const p = m.OAUTH_PROVIDERS?.[id]
    if (!p) throw new Error(`未知 provider: ${id}`)
    await m.providerOAuthLogin(p) // loopback+PKCE,自动开浏览器,落盘 provider-auth.json
    const stored = await loadConfig()
    if (stored.mode === 'managed') void ensureBackend() // 重启让后端加载该 provider
    return { ok: true, id }
  })

  backend.onStatus((st) => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send('backend:status', st)
    }
  })

  void ensureBackend()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', (e) => {
  // 优雅停后端(SIGTERM→3s→SIGKILL);停完再真正退出。
  const st = backend.getStatus().state
  if (st === 'ready' || st === 'starting') {
    e.preventDefault()
    void backend.stop().finally(() => app.exit(0))
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
