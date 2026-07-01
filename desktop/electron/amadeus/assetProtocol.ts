// Serves vault image files to the renderer over a custom, vault-clamped protocol:
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
    return new Response(new Uint8Array(data), {
      headers: { 'Content-Type': MIME[ext] ?? 'application/octet-stream' },
    })
  })
}
