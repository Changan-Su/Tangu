// Pure placement math for a dragged-in note attachment (no fs/electron → unit-testable).
// All paths are vault-relative, POSIX ('/'-separated).

import path from 'node:path'

export interface AttachmentPlacement {
  /** attachments=<note dir>/attachments/;same=note's own dir;vault=fixed folder (see `folder`). */
  mode: 'attachments' | 'same' | 'vault'
  /** vault-relative folder used when mode==='vault' (e.g. "assets"). */
  folder: string
}

/** Where the file is written + how the note references it.
 *  `destDirRel` does NOT depend on `base` (safe to compute before de-duping the name).
 *  `pageRel` is relative to the note's folder — used for `[name](rel)` links (may start with "../"). */
export function attachmentPaths(
  pagePath: string,
  base: string,
  opts: AttachmentPlacement,
): { destDirRel: string; fileVaultRel: string; pageRel: string } {
  const dir = path.posix.dirname(pagePath.replace(/\\/g, '/'))
  const pageDirRel = dir === '.' ? '' : dir
  const clean = (s: string): string => s.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const destDirRel =
    opts.mode === 'same' ? pageDirRel
    : opts.mode === 'vault' ? clean(opts.folder)
    : clean(`${pageDirRel}/attachments`)
  const fileVaultRel = destDirRel ? `${destDirRel}/${base}` : base
  const pageRel = path.posix.relative(pageDirRel || '.', fileVaultRel)
  return { destDirRel, fileVaultRel, pageRel }
}
