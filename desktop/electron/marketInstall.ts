/**
 * Market 安装核心:把下载到的 zip 解压到 ~/.tangu/<type>/<slug>/。
 * 纯逻辑(只依赖 jszip + fs/path,不 import electron),便于单测路径穿越 / 剥顶层。
 */
import JSZip from 'jszip'
import { mkdir, writeFile } from 'fs/promises'
import { join, dirname, relative, isAbsolute } from 'path'

/** type → ~/.tangu 下的子目录。 */
export const MARKET_SUBDIR: Record<string, string> = { skill: 'skills', agent: 'agents', plugin: 'plugins' }

/** install_slug 必须是 kebab(防目录穿越 / data-attr 注入)。 */
export function isSafeSlug(s: unknown): s is string {
  return typeof s === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(s)
}

/** 是否应剥掉单层顶级目录(GitHub source zip 会套一层 owner-repo-sha/)。 */
export function shouldStripTop(names: string[]): boolean {
  const files = names.map((n) => n.replace(/\\/g, '/')).filter((n) => n && !n.endsWith('/'))
  if (!files.length) return false
  const tops = new Set(files.map((n) => n.split('/')[0]))
  return tops.size === 1 && files.every((n) => n.includes('/'))
}

/** 条目在 destRoot 下的安全相对路径;非法(穿越/绝对/空/目录)返回 null。 */
export function safeEntryPath(name: string, strip: boolean): string | null {
  let rel = name.replace(/\\/g, '/')
  if (strip) rel = rel.split('/').slice(1).join('/')
  rel = rel.replace(/^\/+/, '')
  if (!rel || rel.endsWith('/')) return null
  const probe = relative('/__root__', join('/__root__', rel))
  if (!probe || probe.startsWith('..') || isAbsolute(probe)) return null
  return rel
}

/** 解压 zip 到 destRoot(剥顶层 + 防穿越)。返回写入文件数。遇到穿越路径直接抛错。 */
export async function extractZipToDir(zipBuffer: Buffer, destRoot: string): Promise<number> {
  const zip = await JSZip.loadAsync(zipBuffer)
  const entries = Object.values(zip.files).filter((f) => !f.dir)
  const strip = shouldStripTop(entries.map((f) => f.name))
  await mkdir(destRoot, { recursive: true })
  let n = 0
  for (const f of entries) {
    const rel = safeEntryPath(f.name, strip)
    if (rel === null) {
      if (/(^|\/)\.\.(\/|$)/.test(f.name.replace(/\\/g, '/'))) throw new Error(`压缩包含非法路径: ${f.name}`)
      continue
    }
    const out = join(destRoot, rel)
    await mkdir(dirname(out), { recursive: true })
    await writeFile(out, Buffer.from(await f.async('arraybuffer')))
    n++
  }
  if (n === 0) throw new Error('压缩包为空或无有效文件')
  return n
}
