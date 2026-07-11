/**
 * 页面级共享(P2)+ 发布(P3)的浏览器端 API 面:挂 window.amadeusCollab(web 专属)。
 * 模型:同步共享=页+子页面,参与者须登录+同意邀请(可设密码/有效期/角色);发布=公开只读链接。
 * 活动 vault id 与 cloudBridge 同源;切库 = localStorage + reload(干净重建)。
 */
import { subscribePresence, type PresenceUser } from './cloudPresence'
import { ensureActiveVault, ACTIVE_VAULT_KEY } from './cloudBridge'

export interface CollabCfg {
  apiBase: string
  getToken(): string
}

const j = async <T>(res: Response): Promise<T> => {
  if (!res.ok) {
    let body: any = null
    try { body = await res.json() } catch { /* non-json */ }
    const err = new Error(body?.detail || `http ${res.status}`) as Error & { status?: number; code?: string }
    err.status = res.status
    err.code = body?.code
    throw err
  }
  return res.json() as Promise<T>
}

export function installCloudCollab(cfg: CollabCfg): void {
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> =>
    j<T>(await fetch(`${cfg.apiBase}/amadeus${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.getToken()}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }))

  const vid = (): Promise<string> => ensureActiveVault()

  const myUserId = (): string | null => {
    try {
      const payload = cfg.getToken().split('.')[1]
      const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
      return typeof json.userId === 'string' ? json.userId : null
    } catch {
      return null
    }
  }

  let hbTimer: ReturnType<typeof setInterval> | null = null
  let hbPage: string | null = null
  const beat = (): void => {
    void vid().then((v) =>
      fetch(`${cfg.apiBase}/amadeus/vaults/${encodeURIComponent(v)}/presence`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: hbPage }),
      }),
    ).catch(() => {})
  }

  window.amadeusCollab = {
    listVaults: () => call<{ vaults: any[] }>('GET', '/vaults').then((r) => r.vaults),
    activeVaultId: vid,
    switchVault(id: string) {
      try { localStorage.setItem(ACTIVE_VAULT_KEY, id) } catch { /* ignore */ }
      location.reload()
    },
    // ── 同步共享(owner)──
    pageShare: async (path: string) =>
      call<{ share: any; quota: { collab: number; publish: number } }>('GET', `/vaults/${encodeURIComponent(await vid())}/page-shares?path=${encodeURIComponent(path)}`),
    createPageShare: async (path: string, opts: { role?: 'editor' | 'viewer'; expiresDays?: number | null; password?: string | null }) =>
      call<any>('POST', `/vaults/${encodeURIComponent(await vid())}/page-shares`, { path, ...opts }),
    updatePageShare: async (id: string, patch: { role?: 'editor' | 'viewer'; password?: string | null; expiresDays?: number | null; rotate?: boolean }) =>
      call<any>('PATCH', `/vaults/${encodeURIComponent(await vid())}/page-shares/${encodeURIComponent(id)}`, patch),
    revokePageShare: async (id: string) => { await call('DELETE', `/vaults/${encodeURIComponent(await vid())}/page-shares/${encodeURIComponent(id)}`) },
    setParticipantRole: async (id: string, userId: string, role: 'editor' | 'viewer') => {
      await call('PATCH', `/vaults/${encodeURIComponent(await vid())}/page-shares/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, { role })
    },
    removeParticipant: async (id: string, userId: string) => {
      await call('DELETE', `/vaults/${encodeURIComponent(await vid())}/page-shares/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`)
    },
    // ── 参与者 ──
    sharedWithMe: () => call<{ items: Array<{ vaultId: string; path: string; title: string; role: string; ownerName: string | null }> }>('GET', '/shared-with-me').then((r) => r.items),
    leaveShare: async (id: string) => {
      const me = myUserId()
      if (me) await call('DELETE', `/vaults/${encodeURIComponent(await vid())}/page-shares/${encodeURIComponent(id)}/members/${encodeURIComponent(me)}`)
    },
    inviteUrl: (token: string) => `${location.origin}/invite/${token}`,
    // ── 发布(公开链接)──
    publishes: async () => call<{ shares: Array<{ token: string; mode: string; path: string; createdAt: string }>; quota: { collab: number; publish: number } }>('GET', `/vaults/${encodeURIComponent(await vid())}/shares`),
    createPublish: async (mode: 'page' | 'subtree', path: string) => {
      const r = await call<{ token: string; mode: string; path: string }>('POST', `/vaults/${encodeURIComponent(await vid())}/shares`, { mode, path })
      return { ...r, url: `${location.origin}/share/${r.token}` }
    },
    revokePublish: async (token: string) => { await call('DELETE', `/vaults/${encodeURIComponent(await vid())}/shares/${encodeURIComponent(token)}`) },
    publishUrl: (token: string) => `${location.origin}/share/${token}`,
    // ── presence ──
    heartbeat(page: string | null) {
      hbPage = page
      beat()
      if (!hbTimer) hbTimer = setInterval(beat, 30_000)
    },
    stopHeartbeat() {
      if (hbTimer) { clearInterval(hbTimer); hbTimer = null }
    },
    onPresence: (cb: (list: PresenceUser[]) => void) => subscribePresence(cb),
    myUserId,
  }
}
