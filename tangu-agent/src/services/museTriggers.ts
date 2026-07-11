/**
 * Muse 触发规则(watch)—— `~/.tangu/agents/muse/triggers.json`。
 *
 * 「帮我盯着 xxx.md 写满 100 字」这类**设定任务**由任意本地 agent 经 muse_watch 工具写成结构化规则;
 * muse.ts 的 supervisor tick(已有 5min 轮询)零 token 评估,命中才起 Muse 周期(kickoff 带触发说明)。
 * 三种条件:
 *   file_chars_gte —— 文件非空白字符数 ≥ n(粗粒度"写满 X 字");
 *   event_seen     —— lastFiredAt(或创建)之后的活动日志行含子串(数据源=userActivity);
 *   daily_at       —— 每天过 HH:MM 触发,**补发语义**(过点且距上次 >20h;时段外恢复后首个 tick 补上)。
 * lastFiredAt 只在 Muse 周期真正启动后写回——被预算/让位闸挡住不烧 cooldown。
 * 该文件不进云同步(agentFileSync 白名单不含它)、不影响 agent 名册缓存(dirStamp 只看 config/SOUL)。
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { agentsDir } from '../core/tanguHome.js';
import { MUSE_AGENT_SLUG } from '../agents/agentRegistry.js';

export type MuseTriggerCond =
  | { type: 'file_chars_gte'; path: string; n: number }
  | { type: 'event_seen'; match: string }
  | { type: 'daily_at'; time: string };

export interface MuseTrigger {
  id: string;
  /** 人话描述(面板/列表展示)。 */
  desc: string;
  cond: MuseTriggerCond;
  /** 命中时给 Muse 的附加指令(可空;英文最佳)。 */
  prompt?: string;
  /** 触发后的冷却(小时);期间不复触。 */
  cooldownHours: number;
  /** 上次真正触发 Muse 周期的时刻(ISO);null=从未。 */
  lastFiredAt: string | null;
  enabled: boolean;
  createdAt: string;
}

export const triggersFile = (): string => join(agentsDir(), MUSE_AGENT_SLUG, 'triggers.json');

export async function loadTriggers(): Promise<MuseTrigger[]> {
  try {
    const raw = await fs.readFile(triggersFile(), 'utf8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((t) => t && typeof t.id === 'string' && t.cond?.type) : [];
  } catch {
    return []; // 无文件/损坏 → 空(muse_watch set 时重建)
  }
}

export async function saveTriggers(list: MuseTrigger[]): Promise<void> {
  await fs.mkdir(join(agentsDir(), MUSE_AGENT_SLUG), { recursive: true });
  await fs.writeFile(triggersFile(), JSON.stringify(list, null, 2), 'utf8');
}

export async function removeTrigger(id: string): Promise<boolean> {
  const list = await loadTriggers();
  const next = list.filter((t) => t.id !== id);
  if (next.length === list.length) return false;
  await saveTriggers(next);
  return true;
}

/** 触发后写回 lastFiredAt(仅在 Muse 周期真正启动后调用)。 */
export async function markTriggersFired(ids: string[], at = new Date()): Promise<void> {
  if (!ids.length) return;
  const list = await loadTriggers();
  const iso = at.toISOString();
  for (const t of list) if (ids.includes(t.id)) t.lastFiredAt = iso;
  await saveTriggers(list);
}

export interface EvaluateEnv {
  now?: Date;
  /** 活动日志行(event_seen 数据源;调用方给近窗口行,规则内再按 lastFiredAt 过滤)。 */
  activityLines?: string[];
  /** 文件非空白字符数;不存在/不可读 → null。测试可注入。 */
  readFileChars?: (path: string) => Promise<number | null>;
}

async function defaultReadFileChars(path: string): Promise<number | null> {
  try {
    const raw = await fs.readFile(path, 'utf8');
    // ponytail: 全文非空白字符数(含 frontmatter/块标记),"写满 X 字"的粗粒度语义够用
    return raw.replace(/\s/g, '').length;
  } catch {
    return null;
  }
}

/** 行首 12 位本地时间戳(userActivity 格式)。 */
function lineTs(line: string): string {
  return line.slice(0, 12);
}

function toActivityTs(d: Date): string {
  const p = (x: number): string => String(x).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
}

/** 评估到期规则(纯读,不写回)。返回本轮命中的规则列表。 */
export async function evaluateTriggers(triggers: MuseTrigger[], env: EvaluateEnv = {}): Promise<MuseTrigger[]> {
  const now = env.now ?? new Date();
  const readChars = env.readFileChars ?? defaultReadFileChars;
  const lines = env.activityLines ?? [];
  const fired: MuseTrigger[] = [];
  for (const t of triggers) {
    if (!t.enabled) continue;
    const lastMs = t.lastFiredAt ? Date.parse(t.lastFiredAt) : 0;
    const cooldownMs = Math.max(0, Number(t.cooldownHours) || 0) * 3600_000;
    if (lastMs && now.getTime() - lastMs < cooldownMs) continue;
    const c = t.cond;
    try {
      if (c.type === 'file_chars_gte') {
        const chars = await readChars(c.path);
        if (chars !== null && chars >= c.n) fired.push(t);
      } else if (c.type === 'event_seen') {
        // 只看「上次触发(或规则创建)之后」的行——不吃存量旧事件。
        const sinceIso = t.lastFiredAt || t.createdAt || '';
        const since = sinceIso ? toActivityTs(new Date(sinceIso)) : '';
        if (lines.some((l) => l.includes(c.match) && (!since || lineTs(l) >= since))) fired.push(t);
      } else if (c.type === 'daily_at') {
        const m = /^(\d{1,2}):(\d{2})$/.exec(String(c.time || ''));
        if (!m) continue;
        const due = new Date(now);
        due.setHours(Number(m[1]), Number(m[2]), 0, 0);
        // 补发语义:今天已过点 且 距上次触发 >20h(而非"恰在那一分钟"),时段外恢复后首个 tick 补上。
        if (now >= due && now.getTime() - lastMs > 20 * 3600_000) fired.push(t);
      }
    } catch { /* 单规则失败不阻断其余 */ }
  }
  return fired;
}

/** 命中规则 → Muse kickoff 附加段(英文,进模型)。 */
export function buildTriggerKickoff(fired: MuseTrigger[]): string {
  if (!fired.length) return '';
  const lines = fired.slice(0, 5).map((t) => {
    const cond =
      t.cond.type === 'file_chars_gte'
        ? `file ${t.cond.path} reached ${t.cond.n}+ non-whitespace chars`
        : t.cond.type === 'event_seen'
          ? `activity matched "${t.cond.match}"`
          : `daily at ${t.cond.time}`;
    return `- ${t.desc} (${cond})${t.prompt ? ` — ${t.prompt}` : ''}`;
  });
  return (
    '\n\n[Watch triggers fired this cycle — the user explicitly asked to be told about these; handle them FIRST via add_muse_todo]\n' +
    lines.join('\n')
  );
}
