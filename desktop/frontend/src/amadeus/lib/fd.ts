// `.fd` 子笔记文件夹(Notion「笔记即文件夹」)的路径约定,纯函数零依赖。
// 约定:笔记 X.md 拥有同目录旁挂文件夹 X.fd/,存放「在 X.md 内创建」的子笔记/数据库;
// X.md 的 frontmatter `children:` 镜像 .fd 直接子文件清单(漂移容忍,UI 变更时重算)。

export const isNoteMd = (p: string): boolean => /\.md$/i.test(p)

/** 'Notes/Diary.md' → 'Notes/Diary.fd' */
export const fdDirOf = (notePath: string): string => notePath.replace(/\.md$/i, '.fd')

/** 'Notes/Diary.fd' → 'Notes/Diary.md' */
export const noteOfFd = (fdPath: string): string => fdPath.replace(/\.fd$/i, '.md')

export const isFdDir = (p: string): boolean => /\.fd$/i.test(p)

/** path 所在的最近 .fd 祖先段('Notes/Diary.fd/x.md' → 'Notes/Diary.fd';无 → null)。 */
export function nearestFd(path: string): string | null {
  const segs = path.replace(/\\/g, '/').split('/')
  for (let i = segs.length - 2; i >= 0; i--) {
    if (/\.fd$/i.test(segs[i])) return segs.slice(0, i + 1).join('/')
  }
  return null
}

/** children = .fd 直接子文件(pages+files 均含,不含子文件夹),basename、字典序。 */
export function computeFdChildren(parentNote: string, pages: string[], files: string[]): string[] {
  const prefix = `${fdDirOf(parentNote)}/`
  return [...pages, ...files]
    .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
    .map((p) => p.slice(prefix.length))
    .sort((a, b) => a.localeCompare(b))
}
