/**
 * 跨生态 agent 资产发现入口:三个 adapter 并行扫描,单个失败不阻断
 * (目录不存在 = 空结果)。技能 id 全局去重(跨生态撞名时追加 -<ecosystem>)。
 */
import { homedir } from 'node:os'
import type { DiscoveredSkill, DiscoveryResult } from './types'
import { scanClaude } from './claudeAdapter'
import { scanCodex } from './codexAdapter'
import { scanHermes } from './hermesAdapter'

export type { DiscoveredMcp, DiscoveredMcpConfig, DiscoveredSkill, DiscoveryResult, Ecosystem } from './types'
export { importSkills, importMcp } from './importer'

export async function scanAll(home = homedir()): Promise<DiscoveryResult> {
  const settled = await Promise.allSettled([
    Promise.resolve().then(() => scanClaude(home)),
    Promise.resolve().then(() => scanCodex(home)),
    Promise.resolve().then(() => scanHermes(home)),
  ])
  const merged: DiscoveryResult = { skills: [], mcpServers: [] }
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue // 单生态崩了照常返回其余
    merged.skills.push(...r.value.skills)
    merged.mcpServers.push(...r.value.mcpServers)
  }
  merged.skills = dedupeSkillIds(merged.skills)
  return merged
}

function dedupeSkillIds(skills: DiscoveredSkill[]): DiscoveredSkill[] {
  const seen = new Set<string>()
  return skills.map((s) => {
    let id = s.id
    if (seen.has(id)) id = `${id}-${s.ecosystem}`
    let n = 2
    while (seen.has(id)) id = `${s.id}-${s.ecosystem}-${n++}`
    seen.add(id)
    return id === s.id ? s : { ...s, id }
  })
}
