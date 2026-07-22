/** fsPenzor 协议形状测试:mock fetch,验证 baseSeq 映射 / 409 / manifest 映射 / 下载 hash 校验。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { createPenzorRemote, expectedPartsOf } from './fsPenzor'

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')

type Call = { url: string; method: string }
const calls: Call[] = []

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): void {
  vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    calls.push({ url: u, method: init?.method ?? 'GET' })
    return handler(u, init)
  })
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const remote = () => createPenzorRemote({ baseUrl: 'https://cloud.test/', vault: 'default', getToken: () => 'tok' })

afterEach(() => {
  vi.unstubAllGlobals()
  calls.length = 0
})

describe('fsPenzor', () => {
  it('expectedPartsOf 映射(seq+hash 双条件)', () => {
    const h = sha('x')
    expect(expectedPartsOf(null)).toEqual({ baseSeq: 0, baseHash: null }) // create
    expect(expectedPartsOf(`7:${h}`)).toEqual({ baseSeq: 7, baseHash: h })
    expect(expectedPartsOf('7:not-a-hash')).toEqual({ baseSeq: 7, baseHash: null })
    expect(expectedPartsOf(undefined)).toBeUndefined()
    expect(expectedPartsOf('junk')).toBeUndefined()
  })

  it('walk → manifest 映射 id=seq:hash', async () => {
    mockFetch(() => json({ files: [{ path: 'a/b.md', size: 3, hash: 'h1', seq: 4, mtimeMs: 99 }] }))
    const out = await remote().walk()
    expect(out).toEqual([{ key: 'a/b.md', size: 3, mtimeMs: 99, id: '4:h1' }])
    expect(calls[0].url).toBe('https://cloud.test/api/remotesync/vaults/default/manifest')
  })

  it('writeFile:create 带 baseSeq=0,update 带基线 seq+hash;409 抛 cas-conflict', async () => {
    const bh = sha('base')
    mockFetch((url) => {
      if (url.includes('baseSeq=9')) return json({ code: 'CONFLICT', seq: 11 }, 409)
      return json({ path: 'x.md', size: 2, hash: 'h2', seq: 1, mtimeMs: 5 })
    })
    const r = remote()
    const ent = await r.writeFile('x.md', Buffer.from('hi'), 5, undefined, null)
    expect(calls[0].url).toContain('baseSeq=0')
    expect(calls[0].url).not.toContain('baseHash')
    expect(ent.id).toBe('1:h2')
    await expect(r.writeFile('x.md', Buffer.from('hi'), 5, undefined, `9:${bh}`)).rejects.toThrow(/cas-conflict/)
    expect(calls[1].url).toContain('baseSeq=9')
    expect(calls[1].url).toContain(`baseHash=${bh}`)
  })

  it('rm 带基线 seq;readFile 下载后 hash 校验,不符即抛', async () => {
    const good = 'content'
    mockFetch((url) => {
      if (url.includes('/file?path=')) {
        if (url.includes('bad')) return json({ path: 'bad.md', size: 7, hash: 'WRONG', seq: 1, mtimeMs: 0, url: 'https://oss.test/bad' })
        return json({ path: 'ok.md', size: 7, hash: sha(good), seq: 1, mtimeMs: 0, url: 'https://oss.test/ok' })
      }
      if (url.startsWith('https://oss.test/')) return new Response(good, { status: 200 })
      return json({ ok: true })
    })
    const r = remote()
    expect((await r.readFile('ok.md')).toString()).toBe(good)
    await expect(r.readFile('bad.md')).rejects.toThrow(/hash mismatch/)
    const bh = sha(good)
    await r.rm('ok.md', undefined, `3:${bh}`)
    expect(calls.at(-1)!.url).toContain('baseSeq=3')
    expect(calls.at(-1)!.url).toContain(`baseHash=${bh}`)
    expect(calls.at(-1)!.method).toBe('DELETE')
  })
})
