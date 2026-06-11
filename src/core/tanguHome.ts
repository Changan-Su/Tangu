/**
 * ~/.tangu —— Tangu 本地 home 目录统一布局(单一事实来源,各处不再散落拼路径)。
 *
 *   ~/.tangu/
 *   ├── auth.json            Forsion 凭证 { cloudUrl, token, model }(credStore)
 *   ├── provider-auth.json   provider OAuth 凭证 { [providerId]: OAuthTokens }(providerCreds)
 *   ├── providers.json       直连 provider 配置 DirectProvider[](desktop Providers 页/手编;assemble 自动合并)
 *   ├── mcp.json             MCP server 配置 { mcpServers: {...} }(P6)
 *   ├── skills/              本地技能(<id>/SKILL.md,兼容 .claude 技能格式;P5)
 *   └── pgdata/              嵌入式 PGlite 数据目录
 *
 * 仅 standalone/TUI/desktop 形态使用;microserver/worker 不读本目录。
 * 测试/多实例可用 env TANGU_HOME 整体重定向。
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

export function tanguHome(): string {
  return process.env.TANGU_HOME || join(homedir(), '.tangu');
}

export const authFile = (): string => join(tanguHome(), 'auth.json');
export const providerAuthFile = (): string => join(tanguHome(), 'provider-auth.json');
export const providersFile = (): string => join(tanguHome(), 'providers.json');
export const mcpConfigFile = (): string => join(tanguHome(), 'mcp.json');
export const skillsDir = (): string => join(tanguHome(), 'skills');
export const pgdataDir = (): string => join(tanguHome(), 'pgdata');

/** 确保 home 及子目录存在(幂等);返回 home 路径。 */
export function ensureHome(): string {
  mkdirSync(skillsDir(), { recursive: true });
  return tanguHome();
}
