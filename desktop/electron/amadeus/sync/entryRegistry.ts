/**
 * 按条目云同步的注册表纯逻辑(scope 匹配/改名重写/云名校验)。
 * 持久化在 settings.ts 的 AmadeusConfig.entrySync;引擎装配在 ipc.ts(照「与我共享」先例)。
 *
 * scope 语义(全部 NFC、POSIX 相对路径):
 * - kind 'folder' → 条目本身 + 子树全部;
 * - kind 'page'   → .md 本身 + <stem>.fd/ 子笔记树(照 pageScopeMirror 的页范围规则);
 * - kind 'asset'  → 精确路径;
 * - 条目的祖先目录也算命中 —— 引擎的文件夹 move/mkdir 事件要能过闸,否则含同步条目的
 *   上级目录改名会退化成 unlink+add(云端丢文件);
 * - 冲突副本「x (conflict YYYY-MM-DD HHmm).ext」按原名归一后匹配(引擎物化的副本必须能推上云)。
 */
import { createHash } from 'node:crypto'
import { normalizeServerPath } from './syncPaths'
import { SHARED_DIR } from './collabMain'

export interface EntrySyncEntry {
  /** vault 相对路径(POSIX、NFC)。 */
  path: string
  kind: 'page' | 'folder' | 'asset'
}

export interface EntrySyncVault {
  /** 本地 vault 根(绝对路径)。 */
  vaultRoot: string
  /** 云端工作区根下的文件夹名(单段)。 */
  cloudName: string
  entries: EntrySyncEntry[]
}

export const hash8 = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 8)

const nfc = (s: string): string => s.replace(/\\/g, '/').normalize('NFC')

/** 冲突副本名归一:剥掉 reconcile.conflictCopyPath 加的「 (conflict YYYY-MM-DD HHmm)」尾缀。 */
export function stripConflictSuffix(rel: string): string {
  return rel.replace(/ \(conflict \d{4}-\d{2}-\d{2} \d{4}\)(?=(?:\.[^./]+)?$)/, '')
}

export interface ScopeSet {
  exact: Set<string>
  prefixes: string[]
  /** 全部条目路径(祖先目录判定用)。 */
  paths: string[]
}

export function buildScope(entries: EntrySyncEntry[]): ScopeSet {
  const exact = new Set<string>()
  const prefixes: string[] = []
  const paths: string[] = []
  for (const e of entries) {
    const p = nfc(e.path)
    if (!p) continue
    exact.add(p)
    paths.push(p)
    if (e.kind === 'folder') prefixes.push(`${p}/`)
    else if (e.kind === 'page') prefixes.push(`${p.replace(/\.md$/i, '')}.fd/`)
  }
  return { exact, prefixes, paths }
}

export function scopeMatches(scope: ScopeSet, relRaw: string): boolean {
  const rel = stripConflictSuffix(nfc(relRaw))
  if (!rel) return false
  if (scope.exact.has(rel)) return true
  for (const pre of scope.prefixes) {
    if (rel.startsWith(pre) || `${rel}/` === pre) return true
  }
  // 祖先目录:rel 是某条目(或其 .fd 前缀)的上级 → 放行(folder move/mkdir 事件)。
  const dir = `${rel}/`
  for (const p of scope.paths) if (p.startsWith(dir)) return true
  for (const pre of scope.prefixes) if (pre.startsWith(dir)) return true
  return false
}

/** 本地改名/移动跟随:from 精确条目或其祖先目录被改名 → 重写受影响条目路径。 */
export function rewriteEntriesForMove(
  entries: EntrySyncEntry[],
  fromRaw: string,
  toRaw: string,
): { changed: boolean; next: EntrySyncEntry[] } {
  const from = nfc(fromRaw)
  const to = nfc(toRaw)
  let changed = false
  const next = entries.map((e) => {
    const p = nfc(e.path)
    if (p === from) {
      changed = true
      return { ...e, path: to }
    }
    if (p.startsWith(`${from}/`)) {
      changed = true
      return { ...e, path: to + p.slice(from.length) }
    }
    return e
  })
  return { changed, next }
}

/** 远端结构事件跟随(op 已剥掉 serverDir 前缀翻译成 vault 相对路径)。 */
export function applyRemoteOpToEntries(
  entries: EntrySyncEntry[],
  op: 'move' | 'rename-folder' | 'move-folder' | 'delete' | 'delete-folder',
  rel: string,
  newRel: string | null,
): { changed: boolean; next: EntrySyncEntry[] } {
  if (op === 'delete' || op === 'delete-folder') {
    const from = nfc(rel)
    const next = entries.filter((e) => {
      const p = nfc(e.path)
      return !(p === from || (op === 'delete-folder' && p.startsWith(`${from}/`)))
    })
    return { changed: next.length !== entries.length, next }
  }
  if (!newRel) return { changed: false, next: entries }
  return rewriteEntriesForMove(entries, rel, newRel)
}

/** 云名校验:单段、服务端路径合法、避开保留字。返回错误文案或 null。 */
export function validateCloudName(name: string, otherNames: string[]): string | null {
  const n = normalizeServerPath(name)
  if (!n || n !== name.normalize('NFC').trim()) return '名称不合法'
  if (n.includes('/')) return '名称不能包含 /'
  if (n === SHARED_DIR) return `「${SHARED_DIR}」是保留名称`
  if (otherNames.includes(n)) return '该名称已被其他 Vault 的云同步占用'
  return null
}
