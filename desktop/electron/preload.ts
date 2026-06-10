/**
 * Preload:contextBridge 暴露最小安全 API(配置读写 + 托管后端状态)。
 * agent 调用 renderer 直连 HTTP,不经主进程。
 */
import { contextBridge, ipcRenderer } from 'electron'

export interface BackendStatus {
  state: 'stopped' | 'starting' | 'ready' | 'crashed'
  url: string | null
  pid: number | null
  lastError: string | null
}

const api = {
  getConfig: (): Promise<any> => ipcRenderer.invoke('config:get'),
  setConfig: (patch: Record<string, any>): Promise<any> => ipcRenderer.invoke('config:set', patch),
  backendStatus: (): Promise<BackendStatus> => ipcRenderer.invoke('backend:getStatus'),
  backendLogs: (): Promise<string[]> => ipcRenderer.invoke('backend:getLogs'),
  backendRestart: (): Promise<BackendStatus> => ipcRenderer.invoke('backend:restart'),
  onBackendStatus: (cb: (st: BackendStatus) => void): (() => void) => {
    const listener = (_e: unknown, st: BackendStatus): void => cb(st)
    ipcRenderer.on('backend:status', listener)
    return () => ipcRenderer.removeListener('backend:status', listener)
  },
  // ── Forsion 账号 / provider OAuth 登录(与 `tangu login` 同一份凭证)──
  authStatus: (): Promise<any> => ipcRenderer.invoke('auth:status'),
  forsionLogin: (cloudUrl?: string): Promise<any> => ipcRenderer.invoke('auth:forsionLogin', cloudUrl),
  forsionLogout: (): Promise<any> => ipcRenderer.invoke('auth:logout'),
  authProviders: (): Promise<Array<{ id: string; loggedIn: boolean }>> => ipcRenderer.invoke('auth:providers'),
  providerLogin: (id: string): Promise<any> => ipcRenderer.invoke('auth:providerLogin', id),
  onAuthDevice: (cb: (info: { url: string; userCode: string }) => void): (() => void) => {
    const listener = (_e: unknown, info: { url: string; userCode: string }): void => cb(info)
    ipcRenderer.on('auth:device', listener)
    return () => ipcRenderer.removeListener('auth:device', listener)
  },
}

contextBridge.exposeInMainWorld('tangu', api)

export type TanguDesktopApi = typeof api
