/**
 * Penzor Cloud 后端(Forsion 自研;server 侧 = server/microserver/remotesync/):
 * 唯一支持**条件写(CAS)**的满血后端 —— expectedId 映射 baseSeq(null→0=create,
 * '`seq:hash`'→seq),walk→push 窗口的并发写在服务端变 409,绝不静默覆盖。
 * 下载走 OSS 签名 URL,取回后按 manifest hash 本地校验(损坏/截断不入库)。
 *
 * 隔离约定:不 import electron/desktop —— baseUrl 与 token 由宿主(remotesyncIpc)注入。
 */
import { sha256 } from './fsLocal'
import type { RemoteEntity, RemoteFs } from './types'

export interface PenzorConfig {
  /** 云端基址(如 https://api.forsion.net),尾斜杠可有可无。 */
  baseUrl: string
  /** 命名空间(设备同步库名,服务端校验 [A-Za-z0-9_-]{1,64})。 */
  vault: string
  /** 每次调用现取 token(登录态可能在同步过程中刷新)。null = 未登录 → 请求必然 401。 */
  getToken: () => string | null
}

interface WireMeta {
  path: string
  size: number
  hash: string
  seq: number
  mtimeMs: number
}

const idOf = (m: { seq: number; hash: string }): string => `${m.seq}:${m.hash}`

/** expectedId → CAS 查询参数:null={0}(create);'seq:hash'={seq,hash};undefined/畸形=undefined(无条件)。
 *  hash 必须一起传:删除重建会让服务端 seq 从 1 重来,只带 seq 的陈旧写会恰好撞上新行——
 *  seq+hash 双条件补上代际语义(同 seq 同 hash = 同内容,撞了也无害)。 */
export function expectedPartsOf(
  expectedId: string | null | undefined,
): { baseSeq: number; baseHash: string | null } | undefined {
  if (expectedId === null) return { baseSeq: 0, baseHash: null }
  if (typeof expectedId !== 'string') return undefined
  const i = expectedId.indexOf(':')
  const seq = Number(i === -1 ? expectedId : expectedId.slice(0, i))
  if (!Number.isInteger(seq) || seq <= 0) return undefined
  const hash = i === -1 ? '' : expectedId.slice(i + 1)
  return { baseSeq: seq, baseHash: /^[0-9a-f]{64}$/.test(hash) ? hash : null }
}

export function createPenzorRemote(cfg: PenzorConfig): RemoteFs {
  const base = cfg.baseUrl.replace(/\/+$/, '')
  const api = (p: string): string => `${base}/api/remotesync/vaults/${encodeURIComponent(cfg.vault)}${p}`

  const call = async (url: string, init: RequestInit & { signal?: AbortSignal }): Promise<Response> => {
    const token = cfg.getToken()
    if (!token) throw new Error('penzor-not-logged-in')
    const rsp = await fetch(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` },
    })
    if (rsp.status === 409) {
      const body = await rsp.json().catch(() => ({}))
      throw new Error(`cas-conflict ${String((body as { code?: string }).code ?? '')}: seq=${String((body as { seq?: number }).seq ?? '?')}`)
    }
    if (!rsp.ok) {
      const detail = await rsp.text().catch(() => '')
      throw new Error(`penzor ${init.method ?? 'GET'} ${rsp.status}: ${detail.slice(0, 200)}`)
    }
    return rsp
  }

  return {
    kind: 'penzor',
    async walk(signal) {
      const rsp = await call(api('/manifest'), { method: 'GET', signal })
      const { files } = (await rsp.json()) as { files: WireMeta[] }
      return files.map(
        (f): RemoteEntity => ({ key: f.path, size: f.size, mtimeMs: f.mtimeMs, id: idOf(f) }),
      )
    },
    async readFile(key, signal) {
      const rsp = await call(api(`/file?path=${encodeURIComponent(key)}`), { method: 'GET', signal })
      const meta = (await rsp.json()) as WireMeta & { url: string }
      const blob = await fetch(meta.url, { signal })
      if (!blob.ok) throw new Error(`penzor blob GET ${blob.status}: ${key}`)
      const data = Buffer.from(await blob.arrayBuffer())
      // 签名 URL 直取的内容按 manifest hash 校验:截断/损坏绝不入库
      if (sha256(data) !== meta.hash) throw new Error(`penzor hash mismatch: ${key}`)
      return data
    },
    async writeFile(key, data, mtimeMs, signal, expectedId) {
      const parts = expectedPartsOf(expectedId)
      const qs = new URLSearchParams({ path: key, mtimeMs: String(Math.floor(mtimeMs) || 0) })
      if (parts) {
        qs.set('baseSeq', String(parts.baseSeq))
        if (parts.baseHash) qs.set('baseHash', parts.baseHash)
      }
      const rsp = await call(api(`/file?${qs.toString()}`), {
        method: 'PUT',
        body: new Uint8Array(data),
        headers: { 'Content-Type': 'application/octet-stream' },
        signal,
      })
      const meta = (await rsp.json()) as WireMeta
      return { key, size: meta.size, mtimeMs: meta.mtimeMs, id: idOf(meta) }
    },
    async rm(key, signal, expectedId) {
      const parts = expectedPartsOf(expectedId)
      const qs = new URLSearchParams({ path: key })
      if (parts && parts.baseSeq > 0) {
        qs.set('baseSeq', String(parts.baseSeq))
        if (parts.baseHash) qs.set('baseHash', parts.baseHash)
      }
      await call(api(`/file?${qs.toString()}`), { method: 'DELETE', signal })
    },
    async check() {
      try {
        await call(api('/manifest'), { method: 'GET' })
        return { ok: true }
      } catch (e) {
        return { ok: false, error: String((e as Error)?.message || e) }
      }
    },
  }
}
