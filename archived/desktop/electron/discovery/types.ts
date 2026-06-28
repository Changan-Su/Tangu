/**
 * 跨生态 agent 资产发现:扫描本机 ~/.claude(Claude Code)、~/.codex(Codex)、
 * ~/.hermes(Hermes)的技能与 MCP server 配置,供设置面板勾选导入 ~/.tangu。
 * 纯 Node 实现(不依赖 electron),便于 tsx 直跑验证。
 */

export type Ecosystem = 'claude-code' | 'codex' | 'hermes'

export interface DiscoveredSkill {
  ecosystem: Ecosystem
  /** 全局唯一(scanAll 层去重);导入时作为 ~/.tangu/skills/<安全化 id>/ 目录名。 */
  id: string
  name: string
  description: string
  /** 复制源:目录(含 SKILL.md)或单个 .md 文件(导入时包成 <id>/SKILL.md)。 */
  sourceDir: string
}

/** 与 Tangu McpServerConfig(src/mcp/config.ts)同形,导入时基本零转换。 */
export interface DiscoveredMcpConfig {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  transport?: 'stdio' | 'http' | 'sse'
  headers?: Record<string, string>
  timeoutMs?: number
}

export interface DiscoveredMcp {
  ecosystem: Ecosystem
  name: string
  config: DiscoveredMcpConfig
}

export interface DiscoveryResult {
  skills: DiscoveredSkill[]
  mcpServers: DiscoveredMcp[]
}
