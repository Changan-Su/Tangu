// Serves vault asset files (images / pdf / audio / video) to the renderer over a custom,
// vault-clamped protocol:
//   amadeus-asset://v/<encoded vault-relative path>

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { protocol } from 'electron'
import { ASSET_SCHEME } from '@amadeus-shared/assets'

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp',
  // 内联预览:PDF 必须给真 MIME(octet-stream 会触发下载而非 Chromium 内置阅读器)。
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
}

/** Must run BEFORE app 'ready'. */
export function registerAssetSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ASSET_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ])
}

/** Find the first file with `basename` anywhere in the vault (for Obsidian-style `![[pic.png]]`).
 *  ponytail: linear walk on cache-miss (browser caches the served image); add a basename index if slow. */
async function findByBasename(root: string, basename: string): Promise<string | null> {
  const target = basename.toLowerCase()
  const walk = async (dir: string): Promise<string | null> => {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return null
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) {
        const hit = await walk(abs)
        if (hit) return hit
      } else if (e.isFile() && e.name.toLowerCase() === target) {
        return abs
      }
    }
    return null
  }
  return walk(root)
}

/** Must run AFTER app 'ready'. */
export function registerAssetProtocol(getVaultRoot: () => string | null): void {
  protocol.handle(ASSET_SCHEME, async (request) => {
    const root = getVaultRoot()
    if (!root) return new Response('no vault', { status: 404 })

    let vaultRel: string
    try {
      vaultRel = decodeURIComponent(new URL(request.url).pathname.replace(/^\/+/, ''))
    } catch {
      return new Response('bad url', { status: 400 })
    }

    let abs = path.resolve(root, vaultRel)
    const rel = path.relative(root, abs)
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return new Response('forbidden', { status: 403 })
    }

    let data: Buffer
    try {
      data = await fs.readFile(abs)
    } catch {
      // Bare basename (e.g. `![[pic.png]]`) → locate it anywhere in the vault.
      const found = vaultRel.includes('/') ? null : await findByBasename(root, path.basename(vaultRel))
      if (!found) return new Response('not found', { status: 404 })
      abs = found
      try {
        data = await fs.readFile(abs)
      } catch {
        return new Response('not found', { status: 404 })
      }
    }
    const ext = path.extname(abs).slice(1).toLowerCase()
    const mime = MIME[ext] ?? 'application/octet-stream'

    // 音视频拖进度条 / PDF 阅读器分页都靠 Range;Chromium 只发单区间,支持 bytes=a-b / a- / -n 三形。
    // ponytail: 整文件已读进内存再切片,vault 级文件够用;超大视频卡顿再改 fd 区间读。
    const range = request.headers.get('range')
    const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null
    if (m && (m[1] !== '' || m[2] !== '')) {
      const size = data.byteLength
      let start = m[1] === '' ? size - Number(m[2]) : Number(m[1])
      const end = Math.min(m[1] !== '' && m[2] !== '' ? Number(m[2]) : size - 1, size - 1)
      start = Math.max(0, start)
      if (start > end || start >= size) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
      }
      return new Response(new Uint8Array(data.subarray(start, end + 1)), {
        status: 206,
        headers: {
          'Content-Type': mime,
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes',
        },
      })
    }
    return new Response(new Uint8Array(data), {
      headers: { 'Content-Type': mime, 'Accept-Ranges': 'bytes' },
    })
  })
}
