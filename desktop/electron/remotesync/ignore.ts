/**
 * 忽略规则(Forsion 自研):默认规则 + 用户 glob。
 * 语法:`*` 段内通配、`**` 跨段通配、`?` 单字符;
 * 不含 `/` 的模式匹配任意层级的文件/目录名;含 `/` 的匹配完整相对路径;
 * 以 `/` 结尾视为目录前缀(等价 `xxx/**`)。
 */

export const DEFAULT_IGNORES = ['.DS_Store', 'desktop.ini', 'Thumbs.db', '.git/', '.trash/']

function globToRegExp(glob: string): RegExp {
  let out = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        out += '.*'
        i++
      } else {
        out += '[^/]*'
      }
    } else if (c === '?') {
      out += '[^/]'
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${out}$`)
}

/** 编译规则集 → 判定函数(入参 posix 相对路径,不含前导 /)。 */
export function compileIgnore(userGlobs: string[] = []): (relPath: string) => boolean {
  const nameRes: RegExp[] = []
  const pathRes: RegExp[] = []
  for (const raw of [...DEFAULT_IGNORES, ...userGlobs]) {
    const g = raw.trim()
    if (!g || g.startsWith('#')) continue
    if (g.endsWith('/')) pathRes.push(globToRegExp(`${g}**`))
    else if (g.includes('/')) pathRes.push(globToRegExp(g.replace(/^\//, '')))
    else nameRes.push(globToRegExp(g))
  }
  return (relPath: string): boolean => {
    if (pathRes.some((re) => re.test(relPath))) return true
    if (nameRes.length === 0) return false
    return relPath.split('/').some((seg) => nameRes.some((re) => re.test(seg)))
  }
}
