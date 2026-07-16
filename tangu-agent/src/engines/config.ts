/**
 * 外部 Agent 引擎定义（host-only）。每个引擎 = 一个可被当作 ACP 子进程驱动的外部 agent CLI。
 * 内置默认 claude-code（Anthropic 官方 ACP 适配器，npx 拉起）；~/.tangu/engines.json 可覆盖/新增。
 * ponytail: 启动命令走配置 —— 换 binary/路径只改 json，不改代码。
 */
import { readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { enginePrefsFile, enginesFile } from '../core/tanguHome.js';
import { getRawSection, saveSection } from '../core/config.js';

export interface EngineDef {
  id: string;
  name: string;
  /** 拉起命令（如 'npx' 或本机 'claude-code-acp' 绝对路径）。 */
  command: string;
  args?: string[];
  /** 追加/覆盖子进程 env（默认继承父进程 env，详见 acpEngine）。 */
  env?: Record<string, string>;
  /** 透传给 ACP newSession 的默认模型（可空，空则用适配器默认）。 */
  defaultModel?: string;
  /** 静态声明模型/命令(配了则跳过运行时探测——留旋钮;一般留空走懒探测)。 */
  models?: Array<{ id: string; name: string; description?: string }>;
  commands?: Array<{ name: string; description: string; hint?: string }>;
  /** 检测提示(快速判断该 agent 是否已装/已登录;任一命中即「detected」)。无则默认可用。 */
  detect?: { dirs?: string[]; env?: string[]; bin?: string };
}

// 内置：Claude Code 经官方 ACP 适配器。需用户已装/已登录 Claude Code（适配器读 ANTHROPIC_API_KEY 或 ~/.claude）。
const BUILTIN: EngineDef[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    command: 'npx',
    args: ['-y', '@zed-industries/claude-code-acp'],
    detect: { dirs: ['~/.claude'], env: ['ANTHROPIC_API_KEY'], bin: 'claude' },
  },
  // Codex 官方 ACP 桥(内含 @openai/codex);走同一 acpEngine,零适配器。鉴权用 Codex OAuth / OPENAI_API_KEY。
  {
    id: 'codex',
    name: 'Codex',
    command: 'npx',
    args: ['-y', '@agentclientprotocol/codex-acp@latest'],
    detect: { dirs: ['~/.codex'], env: ['OPENAI_API_KEY', 'CODEX_API_KEY'], bin: 'codex' },
  },
];

/**
 * 读引擎清单：内置 + 自定义（按 id 覆盖；自定义新 id 追加）。
 * 显式传 configFile → 读该文件；否则 config.json 的 engines 段优先,缺失回落 ~/.tangu/engines.json。
 */
export function loadEngines(configFile?: string): EngineDef[] {
  let custom: EngineDef[] = [];
  const fromFile = (file: string): void => {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf-8'));
      if (Array.isArray(parsed?.engines)) custom = parsed.engines;
    } catch { /* 无文件/解析失败 → 仅用内置 */ }
  };
  if (configFile) {
    fromFile(configFile);
  } else {
    const sec = getRawSection('engines');
    if (sec !== undefined) { if (Array.isArray(sec?.engines)) custom = sec.engines; }
    else fromFile(enginesFile());
  }
  const byId = new Map<string, EngineDef>();
  for (const e of BUILTIN) byId.set(e.id, e);
  for (const e of custom) if (e?.id && e?.command) byId.set(e.id, e); // 校验 id+command 才纳入
  return [...byId.values()];
}

function expandHome(p: string): string {
  return p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p;
}

/**
 * bin 是否在 PATH 上(纯 fs 扫描,不 spawn)。
 * 额外扫常见安装目录:GUI 启动的 Electron 子进程拿到的是 launchd 精简 PATH(不含 ~/.local/bin、homebrew 等),
 * 仅靠 process.env.PATH 会漏检「明明装了」的 CLI(claude 常在 ~/.local/bin)。
 * ponytail: 静态常见目录足够;fnm/nvm 版本目录是动态的,交给 detect.dirs(~/.codex 等)兜底。
 */
function binOnPath(bin: string): boolean {
  const extra = [
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), '.npm-global', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
  ];
  const dirs = [...(process.env.PATH || '').split(path.delimiter), ...extra].filter(Boolean);
  const names = process.platform === 'win32' ? [bin, `${bin}.exe`, `${bin}.cmd`] : [bin];
  return dirs.some((d) => names.some((n) => existsSync(path.join(d, n))));
}

export type EngineStatus = 'available' | 'needs-signin' | 'not-installed';

/**
 * 三态检测:
 * - `available`     — 有鉴权信号(配置目录存在 或 相关 env 已设),或无 detect 提示(不隐藏用户自配引擎)。
 * - `needs-signin`  — bin 在 PATH(装了)但无鉴权信号(没登录/没配 key)。
 * - `not-installed` — 三者全不命中。
 * 依据:claude-code/codex 运行走 `npx @…-acp`,`bin` 只是「装了」的探测提示;有 ~/.claude / API key 即真正可用,
 * 故「有 auth 无 bin」并入 available、不设独立 unavailable 态(三态够用)。
 */
export function engineStatus(def: EngineDef): EngineStatus {
  const d = def.detect;
  if (!d) return 'available';
  const hasAuth = !!(d.dirs?.some((p) => existsSync(expandHome(p))) || d.env?.some((k) => !!process.env[k]));
  if (hasAuth) return 'available';
  if (d.bin && binOnPath(d.bin)) return 'needs-signin';
  return 'not-installed';
}

/** 兼容旧真值语义:非 not-installed 即「已检测」(needs-signin 也返回 true,由 UI 分辨是否需登录)。 */
export function isEngineAvailable(def: EngineDef): boolean {
  return engineStatus(def) !== 'not-installed';
}

export interface EnginePrefs {
  [id: string]: { defaultModel?: string };
}

/** 读引擎偏好:config.json 的 enginePrefs 段优先,缺失回落 ~/.tangu/engine-prefs.json;损坏 → {}。 */
export function loadEnginePrefs(): EnginePrefs {
  const sec = getRawSection('enginePrefs');
  if (sec !== undefined) return sec && typeof sec === 'object' ? sec : {};
  try {
    return JSON.parse(readFileSync(enginePrefsFile(), 'utf-8')) || {};
  } catch {
    return {};
  }
}

/** 写某引擎的默认模型(空串=清除)→ config.json 的 enginePrefs 段。 */
export function saveEngineDefaultModel(id: string, modelId: string): void {
  const prefs = loadEnginePrefs();
  prefs[id] = { ...(prefs[id] || {}), defaultModel: modelId || undefined };
  try {
    saveSection('enginePrefs', prefs);
  } catch (e: any) {
    console.warn('[engines] 保存 engine-prefs 失败:', e?.message || e);
  }
}
