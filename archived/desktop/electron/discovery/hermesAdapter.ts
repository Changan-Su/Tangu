/**
 * Hermes 生态扫描:
 * - 技能:~/.hermes/skills/ 两种布局——`<name>.md` 平铺 与 `<category>/<name>/SKILL.md`
 * - MCP:~/.hermes/config.yaml 的 `mcp_servers:` 块
 *   (字段 command/args/env/url/transport/headers/timeout;timeout 秒 → timeoutMs)
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import YAML from 'yaml'
import type { DiscoveredMcp, DiscoveredSkill, DiscoveryResult } from './types'
import { asStringArray, asStringRecord, parseSkillMeta, safeIsDir, safeIsFile, safeReaddir } from './scanUtil'

const ECOSYSTEM = 'hermes' as const

export function scanHermes(home = homedir()): DiscoveryResult {
  const root = join(home, '.hermes')
  return {
    skills: scanSkills(join(root, 'skills')),
    mcpServers: scanMcp(join(root, 'config.yaml')),
  }
}

function scanSkills(dir: string): DiscoveredSkill[] {
  if (!existsSync(dir)) return []
  const out: DiscoveredSkill[] = []
  const seen = new Set<string>()
  const push = (skill: DiscoveredSkill): void => {
    if (seen.has(skill.id)) return
    seen.add(skill.id)
    out.push(skill)
  }
  for (const entry of safeReaddir(dir)) {
    const path = join(dir, entry)
    if (entry.endsWith('.md') && safeIsFile(path)) {
      // 布局 1:平铺 <name>.md(单文件源,导入时包成 <id>/SKILL.md)
      const base = basename(entry, '.md')
      const meta = parseSkillMeta(path, base)
      if (meta) push({ ecosystem: ECOSYSTEM, id: base, name: meta.name, description: meta.description, sourceDir: path })
    } else if (safeIsDir(path)) {
      // 布局 2:<category>/<name>/SKILL.md(目录源,整目录复制)
      for (const sub of safeReaddir(path)) {
        const skillDir = join(path, sub)
        if (!safeIsDir(skillDir)) continue
        const skillFile = join(skillDir, 'SKILL.md')
        if (!existsSync(skillFile)) continue
        const meta = parseSkillMeta(skillFile, sub)
        if (!meta) continue
        const id = seen.has(sub) ? `${entry}-${sub}` : sub // 跨分类同名时带分类前缀
        push({ ecosystem: ECOSYSTEM, id, name: meta.name, description: meta.description, sourceDir: skillDir })
      }
    }
  }
  return out
}

function scanMcp(configFile: string): DiscoveredMcp[] {
  if (!existsSync(configFile)) return []
  let parsed: Record<string, unknown> | null
  try {
    parsed = YAML.parse(readFileSync(configFile, 'utf8')) as Record<string, unknown> | null
  } catch {
    return [] // 坏 YAML 不阻断
  }
  const servers = parsed?.mcp_servers
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return []
  const out: DiscoveredMcp[] = []
  for (const [name, raw] of Object.entries(servers as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const def = raw as Record<string, unknown>
    const command = typeof def.command === 'string' ? def.command : undefined
    const url = typeof def.url === 'string' ? def.url : undefined
    if (!command && !url) continue
    const timeout = typeof def.timeout === 'number' && def.timeout > 0 ? def.timeout : undefined
    out.push({
      ecosystem: ECOSYSTEM,
      name,
      config: {
        command,
        args: asStringArray(def.args),
        env: asStringRecord(def.env),
        url,
        transport:
          def.transport === 'stdio' || def.transport === 'http' || def.transport === 'sse'
            ? def.transport
            : command
              ? 'stdio'
              : 'http',
        headers: asStringRecord(def.headers),
        timeoutMs: timeout ? timeout * 1000 : undefined, // hermes 用秒
      },
    })
  }
  return out
}
