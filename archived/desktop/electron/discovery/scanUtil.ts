/** discovery 共享小工具:容错 fs 访问 + SKILL.md / 普通 .md 的元数据提取。 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import matter from 'gray-matter'

export function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

export function safeIsDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

export function safeIsFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** 正文首个非空行(frontmatter 缺 description 时的回退)。 */
export function firstLine(body: string): string {
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim().replace(/^#+\s*/, '')
    if (t) return t.length > 200 ? `${t.slice(0, 200)}…` : t
  }
  return ''
}

/** 解析技能 .md:gray-matter 提 name/description,无 frontmatter 回退 fallbackName/正文首行。 */
export function parseSkillMeta(file: string, fallbackName: string): { name: string; description: string } | null {
  try {
    const raw = readFileSync(file, 'utf8')
    const { data, content } = matter(raw)
    return {
      name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : fallbackName,
      description:
        typeof data.description === 'string' && data.description.trim()
          ? data.description.trim()
          : firstLine(content),
    }
  } catch {
    return null // 单个文件坏了不阻断整体扫描
  }
}

export function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out = v.filter((x): x is string => typeof x === 'string')
  return out.length ? out : undefined
}

export function asStringRecord(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string') out[k] = val
    else if (typeof val === 'number' || typeof val === 'boolean') out[k] = String(val)
  }
  return Object.keys(out).length ? out : undefined
}
