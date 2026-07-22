/**
 * 基线(prevSync)存取(Forsion 自研):单 JSON 文件,存宿主 userData(绝不落库内,
 * 否则基线会被自己同步出去)。指纹不符 = 换了同步目标 → 返回空基线(首次合流语义,
 * 绝不带着旧基线对新目标做删除判定)。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { PrevState } from './types'

export async function loadPrev(statePath: string, fingerprint: string): Promise<PrevState> {
  const fresh: PrevState = { version: 1, fingerprint, entries: {} }
  try {
    const parsed = JSON.parse(await fs.readFile(statePath, 'utf8')) as PrevState
    if (parsed?.version !== 1 || parsed.fingerprint !== fingerprint) return fresh
    if (!parsed.entries || typeof parsed.entries !== 'object') return fresh
    return parsed
  } catch {
    return fresh
  }
}

export async function savePrev(statePath: string, state: PrevState): Promise<void> {
  await fs.mkdir(path.dirname(statePath), { recursive: true })
  const tmp = `${statePath}.tmp`
  await fs.writeFile(tmp, JSON.stringify(state), 'utf8')
  await fs.rename(tmp, statePath)
}
