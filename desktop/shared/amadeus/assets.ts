// Asset path transforms (pure, shared by main & renderer).
//
// On disk a block stores PORTABLE, page-folder-relative image links, e.g.
//   ![](.amadeus/img-xyz.png)
// The renderer can't load those directly (its base URL isn't the vault), so for DISPLAY
// we rewrite them to a custom protocol URL that the main process resolves against the vault:
//   ![](amadeus-asset://v/<encoded vault-relative path>)
// …and rewrite back to the relative form before persisting, keeping main.md Obsidian-clean.

export const ASSET_SCHEME = 'amadeus-asset'

/** Join a vault-relative dir with a page-relative path (always '/'-separated). */
export function joinRel(dir: string, rel: string): string {
  const d = dir.replace(/\\/g, '/').replace(/\/+$/, '')
  const r = rel.replace(/\\/g, '/')
  return !d || d === '.' ? r : `${d}/${r}`.replace(/\/{2,}/g, '/')
}

/** Make `vaultRel` relative to a vault-relative dir (inverse of joinRel). */
export function relFrom(dir: string, vaultRel: string): string {
  const d = dir.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!d || d === '.') return vaultRel
  const prefix = `${d}/`
  return vaultRel.startsWith(prefix) ? vaultRel.slice(prefix.length) : vaultRel
}

export function toAssetUrl(vaultRelPath: string): string {
  return `${ASSET_SCHEME}://v/${encodeURIComponent(vaultRelPath)}`
}

export function fromAssetUrl(url: string): string | null {
  const prefix = `${ASSET_SCHEME}://v/`
  if (!url.startsWith(prefix)) return null
  try {
    return decodeURIComponent(url.slice(prefix.length))
  } catch {
    return null
  }
}

// ![alt](path) or ![alt](path "title") — captures alt-wrapper, the URL token, then the rest.
const IMG_RE = /(!\[[^\]]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g

function isExternal(url: string): boolean {
  return /^(https?:|data:|amadeus-asset:|blob:|\/)/.test(url)
}

/** Stored (page-relative) markdown → display markdown (protocol URLs for local images). */
export function toDisplayMarkdown(md: string, pageDir: string): string {
  return md.replace(IMG_RE, (full, pre: string, url: string, rest: string) => {
    const u = url.trim()
    if (isExternal(u)) return full
    return pre + toAssetUrl(joinRel(pageDir, u)) + rest
  })
}

/** Display markdown (protocol URLs) → stored (page-relative) markdown. */
export function toStoredMarkdown(md: string, pageDir: string): string {
  return md.replace(IMG_RE, (full, pre: string, url: string, rest: string) => {
    const vaultRel = fromAssetUrl(url.trim())
    if (vaultRel == null) return full
    return pre + relFrom(pageDir, vaultRel) + rest
  })
}
