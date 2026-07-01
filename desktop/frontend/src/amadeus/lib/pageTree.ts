// Build a nested folder tree from flat, vault-relative page paths + folder paths.
// Renderer-only, pure. File nodes keep the original page path verbatim so
// loadPage/rename receive exactly what listPages produced; explicit folders make
// empty directories visible too.

export interface TreeNode {
  name: string
  /** '' for the synthetic root; the '/'-joined folder path for folders; the verbatim page path for files. */
  path: string
  kind: 'folder' | 'file'
  children: TreeNode[]
}

export function buildTree(pages: string[], folders: string[] = []): TreeNode {
  const root: TreeNode = { name: '', path: '', kind: 'folder', children: [] }

  const ensureFolder = (relPath: string): TreeNode => {
    let node = root
    let prefix = ''
    for (const seg of relPath.split(/[\\/]/).filter(Boolean)) {
      prefix = prefix ? `${prefix}/${seg}` : seg
      let child = node.children.find((c) => c.kind === 'folder' && c.name === seg)
      if (!child) {
        child = { name: seg, path: prefix, kind: 'folder', children: [] }
        node.children.push(child)
      }
      node = child
    }
    return node
  }

  for (const f of folders) if (f) ensureFolder(f)

  for (const page of pages) {
    const segs = page.split(/[\\/]/).filter(Boolean)
    if (segs.length === 0) continue
    const fileSeg = segs[segs.length - 1]
    const folderPath = segs.slice(0, -1).join('/')
    const parent = folderPath ? ensureFolder(folderPath) : root
    parent.children.push({ name: fileSeg, path: page, kind: 'file', children: [] })
  }

  sortTree(root)
  return root
}

/** Folders first, then files; each group alphabetized. Recurses into folders. */
function sortTree(node: TreeNode): void {
  node.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  for (const c of node.children) if (c.kind === 'folder') sortTree(c)
}
