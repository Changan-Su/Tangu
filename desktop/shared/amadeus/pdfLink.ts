// PDF wikilink subpath codec — the stable public contract for linking a note to a
// spot in a PDF, aligned with obsidian-pdf-plus: `[[report.pdf#page=3&color=yellow&annot=id]]`.
// Isomorphic (renderer + editor + main): standard JS only, no Node / Electron / React.
//
// Only `page` is load-bearing this round; `color`/`annot` are optional locate hints.
// Future params (selection=a,b,c,d, rect=x,y,w,h) slot into the same `&`-joined subpath —
// this file is the single extension point.

export interface PdfLoc {
  /** 1-based page number. */
  page: number
  /** Highlight color name (optional locate hint / palette echo). */
  color?: string
  /** pdf.js annotation id, for locating a specific highlight rather than just the page. */
  annot?: string
}

const isPdfPath = (s: string): boolean => /\.pdf$/i.test(s.trim())

/** Does a wikilink's inner text point at a PDF? (`report.pdf`, `report.pdf#page=2`, `a/b.pdf|x`) */
export function isPdfLinkInner(inner: string): boolean {
  let s = inner.trim()
  const bar = s.indexOf('|')
  if (bar >= 0) s = s.slice(0, bar)
  const hash = s.indexOf('#')
  if (hash >= 0) s = s.slice(0, hash)
  return isPdfPath(s)
}

/** Encode a location into a subpath (no leading `#`): `page=3&color=yellow&annot=id`. */
export function encodePdfSubpath(loc: PdfLoc): string {
  const parts = [`page=${Math.max(1, Math.trunc(loc.page) || 1)}`]
  if (loc.color) parts.push(`color=${encodeURIComponent(loc.color)}`)
  if (loc.annot) parts.push(`annot=${encodeURIComponent(loc.annot)}`)
  return parts.join('&')
}

/** Parse a subpath (`#`-prefixed or not) into a location; returns null if no valid `page`. */
export function parsePdfSubpath(subpath: string): PdfLoc | null {
  const raw = subpath.replace(/^#/, '')
  if (!raw) return null
  const params = new Map<string, string>()
  for (const kv of raw.split('&')) {
    const eq = kv.indexOf('=')
    if (eq < 0) continue
    params.set(kv.slice(0, eq), kv.slice(eq + 1))
  }
  const page = parseInt(params.get('page') ?? '', 10)
  if (!Number.isFinite(page) || page < 1) return null
  const loc: PdfLoc = { page }
  const color = params.get('color')
  if (color) loc.color = decodeURIComponent(color)
  const annot = params.get('annot')
  if (annot) loc.annot = decodeURIComponent(annot)
  return loc
}

/** Split a raw wikilink inner (`report.pdf#page=3&...`, alias stripped) into target path + location. */
export function parsePdfLinkInner(inner: string): { target: string; loc: PdfLoc | null } | null {
  let s = inner.trim()
  const bar = s.indexOf('|')
  if (bar >= 0) s = s.slice(0, bar).trim()
  const hash = s.indexOf('#')
  const target = (hash >= 0 ? s.slice(0, hash) : s).trim()
  if (!isPdfPath(target)) return null
  return { target, loc: hash >= 0 ? parsePdfSubpath(s.slice(hash + 1)) : null }
}

/** Build a copy-to-clipboard wikilink to a PDF location: `[[report.pdf#page=3&annot=id]]`. */
export function buildPdfLink(pdfName: string, loc: PdfLoc): string {
  return `[[${pdfName}#${encodePdfSubpath(loc)}]]`
}
