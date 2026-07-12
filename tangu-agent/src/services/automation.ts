/**
 * Agent 自动化 launcher —— muse_watch 规则带 agentSlug 时,命中不唤 Muse,而是往该规则的
 * **常驻 kind='automation' 会话**(首次命中创建)enqueue 一个无人值守 run。
 *
 * 每规则一条常驻会话(而非每次命中新建):防重入=isRunning 一条 SQL;运行历史=该会话的
 * agent_runs(与 Muse 单会话多 run 完全同构,桌面「自动化」Space 右栏统一列 runs);
 * 避开 SQLite/PG 双方言按 agent_config JSON 过滤会话的坑(会话归属在 JS 里比对)。
 *
 * 无人值守护栏(评审定论):
 *   - approvalMode **强制 'full-auto'**——approvals.requestApproval 无超时,后台 run 没有 SSE
 *     订阅者,非 full-auto 必然永久卡 'running' 直到进程重启;不用 planMode(只读白名单废掉意义)。
 *   - maxIterations = min(def.maxIterations ?? 20, 50);单趟成本闸 TANGU_MAX_RUN_COST 自动生效。
 *   - 在跑/无模型/agent 不存在 → 本轮跳过且**不计入返回**(调用方不 markTriggersFired,下轮重试)。
 *   - 自激回路由 validateTriggerInput 的 agentSlug 规则 cooldown ≥1h 下限兜底。
 * 由 muse.ts supervisor tick 调用(评估在 muse.enabled 闸之前——关 Muse 不灭 agent 自动化)。
 */
import { v4 as uuidv4 } from 'uuid';
import { query } from '../core/db.js';
import { deps } from '../seams/runtime.js';
import { createRun } from './runStore.js';
import { enqueueRun } from './agentLoop.js';
import { getAgent } from '../agents/agentRegistry.js';
import { resolveBackgroundModelId } from './specialAgentsConfig.js';
import type { MuseTrigger } from './museTriggers.js';

function log(msg: string): void {
  try { deps().host.log(`[automation] ${msg}`); } catch { console.log(`[automation] ${msg}`); }
}
function automationUserId(): string {
  return process.env.TANGU_USER_ID || 'local';
}

/** 双方言容错:pg 的 JSONB 返回对象,SQLite 存 TEXT 返回字符串。 */
function parseAgentConfig(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  try { return JSON.parse(String(raw || '{}')); } catch { return {}; }
}

export interface AutomationSessionRow {
  id: string;
  title: string;
  triggerId: string | null;
  agentSlug: string | null;
  created_at: string;
  updated_at: string;
}

/** 全部自动化会话(≤MAX_TRIGGERS 条,量小;triggerId 过滤在 JS 里做——见头注释双方言说明)。 */
export async function listAutomationSessions(triggerId?: string): Promise<AutomationSessionRow[]> {
  const rows = await query<any[]>(
    `SELECT id, title, agent_config, created_at, updated_at FROM chat_sessions
     WHERE user_id = ? AND kind = 'automation' ORDER BY updated_at DESC`,
    [automationUserId()],
  );
  const out: AutomationSessionRow[] = [];
  for (const r of rows || []) {
    const cfg = parseAgentConfig(r.agent_config);
    const tid = typeof cfg.automationTriggerId === 'string' ? cfg.automationTriggerId : null;
    if (triggerId && tid !== triggerId) continue;
    out.push({
      id: r.id,
      title: String(r.title || ''),
      triggerId: tid,
      agentSlug: typeof cfg.agentSlug === 'string' ? cfg.agentSlug : null,
      created_at: r.created_at,
      updated_at: r.updated_at,
    });
  }
  return out;
}

async function ensureAutomationSession(t: MuseTrigger, modelId: string): Promise<string> {
  const existing = await listAutomationSessions(t.id);
  if (existing.length) return existing[0].id;
  const id = uuidv4();
  const agentConfig = JSON.stringify({ agentSlug: t.agentSlug, automationTriggerId: t.id });
  await query(
    `INSERT INTO chat_sessions (id, user_id, app_id, title, model_id, kind, agent_config)
     VALUES (?, ?, ?, ?, ?, 'automation', ?)`,
    [id, automationUserId(), deps().profile.appId, String(t.desc).slice(0, 80), modelId, agentConfig],
  );
  return id;
}

// 与 muse.ts 的同名私有函数同款 SQL(不从 muse.ts 导出——muse.ts import 本模块,反向即循环依赖)。
async function isRunning(sessionId: string): Promise<boolean> {
  const rows = await query<any[]>(
    `SELECT 1 FROM agent_runs WHERE session_id = ? AND status IN ('queued', 'running') LIMIT 1`,
    [sessionId],
  );
  return !!rows.length;
}
async function anyUserRunActive(): Promise<boolean> {
  const rows = await query<any[]>(
    `SELECT 1 FROM agent_runs r JOIN chat_sessions s ON s.id = r.session_id
     WHERE r.status IN ('queued', 'running') AND s.kind = 'user' LIMIT 1`,
  );
  return !!rows.length;
}

function automationMessage(t: MuseTrigger): string {
  const c = t.cond;
  const cond =
    c.type === 'file_chars_gte' ? `file ${c.path} reached ${c.n}+ non-whitespace chars`
    : c.type === 'event_seen' ? `new activity matched "${c.match}"`
    : `daily at ${c.time}`;
  return (
    `[Automation] Watch rule "${t.desc}" fired (${cond}). ` +
    'You are running unattended — do not ask the user questions; finish the task and summarize what you did.\n\n' +
    `Task: ${t.prompt || t.desc}`
  );
}

/**
 * 启动一批命中的 agent 规则,返回**实际起跑**的规则 id(调用方只对这些 markTriggersFired——
 * 让位/在跑/无模型/agent 缺失都不烧 cooldown,下轮重试)。
 */
export async function launchAutomationTriggers(fired: MuseTrigger[]): Promise<string[]> {
  const launched: string[] = [];
  if (!fired.length) return launched;
  try {
    if (await anyUserRunActive()) { log('用户有进行中的 run,本轮让位'); return launched; }
  } catch { return launched; }
  for (const t of fired) {
    try {
      const slug = String(t.agentSlug || '');
      const def = await getAgent(slug);
      if (!def) { log(`规则 ${t.id} 的 agent "${slug}" 不存在,跳过`); continue; }
      const modelId = def.model || (await resolveBackgroundModelId(''));
      if (!modelId) { log(`规则 ${t.id} 无可用模型,跳过`); continue; }
      const sessionId = await ensureAutomationSession(t, modelId);
      if (await isRunning(sessionId)) { log(`规则 ${t.id} 上次运行未结束,本轮跳过`); continue; }
      const runId = uuidv4();
      await createRun({
        id: runId,
        sessionId,
        userId: automationUserId(),
        appId: deps().profile.appId,
        modelId,
        assistantMessageId: uuidv4(),
        input: {
          message: automationMessage(t),
          userMessageId: uuidv4(),
          attachments: [],
          agentConfig: {
            agentSlug: slug,
            execMode: 'host',
            approvalMode: 'full-auto',
            maxIterations: Math.min(def.maxIterations ?? 20, 50),
          },
        },
      });
      enqueueRun(sessionId, runId);
      launched.push(t.id);
      log(`规则 ${t.id} → agent "${slug}" 无人值守运行已启动(模型 ${modelId})`);
    } catch (e: any) {
      log(`规则 ${t.id} 启动失败:${e?.message || e}`);
    }
  }
  return launched;
}
