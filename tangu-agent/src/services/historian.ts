/**
 * Historian：空闲会话复盘。开启后周期扫描「空闲超过 idleMinutes 且自上次复盘后有新活动」的
 * AI Studio 会话，用一个轻量模型判断这段对话是否有值得长期留痕的内容；有则往用户当天日志追加一条。
 *
 * 触发标记：每趟（含判定为「无内容」）都置 chat_sessions.historian_last_summary_at=NOW()，
 * 配合扫描谓词 `last IS NULL OR last < updated_at`，保证只在会话有**新活动**后才再扫，不重复处理。
 * 成本：背景任务、用户未主动发起 → 只记 usage（projectSource='ai-studio-historian'），默认不扣用户配额。
 */
import { query, getOlderThanSql } from '../core/db.js';
import { deps } from '../seams/runtime.js';
import type { ChatMessage } from '../core/types.js';
import { historianConfig } from './historianConfig.js';
import { enterRunContext } from '../seams/runContext.js';
import { cloudGetAgent } from '../agents/cloudAgentStore.js';
import { resolveMemorySlug } from '../agents/agentRegistry.js';

// ── 注入依赖的 lazy 别名(保持下方调用点不变)──
const resolveModelAndKey = (modelId: string) => deps().brain.llm.resolveModelAndKey(modelId);
const buildProviderPayload = (opts: any) => deps().brain.llm.buildProviderPayload(opts);
const streamProviderCompletion = (opts: any) => deps().brain.llm.streamProviderCompletion(opts);
const calculateCost = (modelId: string, tin: number, tout: number, model?: any) => deps().billing.calculateCost(modelId, tin, tout, model);
const consumeTokenPoints = (userId: string, amount: number) => deps().billing.consumeTokenPoints(userId, amount);
const logApiUsage = (...args: any[]) => (deps().billing.logApiUsage as any)(...args);
const getUserById = (id: string) => deps().brain.users.getUserById(id);
const appendLogEntry = (userId: string, text: string) => deps().brain.memory.appendLogEntry(userId, text);

const BATCH = 20;
const MAX_TRANSCRIPT_CHARS = 6000;
const HISTORIAN_CHARGE_USER = false; // 背景任务默认不扣用户配额；置 true 则按 cost 扣

const HISTORIAN_PROMPT =
  'You are a "historian". Below is a recent conversation between a user and an AI. ' +
  'If it contains facts, conclusions, or outputs worth recording long-term (e.g. a task was completed, a clear conclusion was reached, a file was generated, or the user expressed a clear long-term preference), ' +
  "write a single concise log entry in the user's language (≤60 characters; no pleasantries, do not restate the whole text, no quotes). " +
  'If there is nothing worth recording, reply with a single word: NOTHING. ' +
  'Do not output anything other than the log entry or NOTHING.';

type Resolved = Awaited<ReturnType<typeof resolveModelAndKey>>;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/** 启动 historian 周期扫描（默认每 2min）。幂等；enabled=false 时每 tick 空跑。 */
export function startHistorian(intervalMs = 120_000): void {
  if (timer) return;
  timer = setInterval(() => { void tick(); }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
}

/** 停止 historian 扫描器(dispose/热加载用)。 */
export function stopHistorian(): void {
  if (timer) { clearInterval(timer); timer = null; }
}

async function tick(): Promise<void> {
  const cfg = historianConfig();
  if (!cfg.enabled || !cfg.modelId) return; // admin 未开启 / 未配模型 → 空跑
  if (running) return; // 防 tick 重叠
  running = true;
  try {
    const rows = await query<any[]>(
      `SELECT s.id, s.user_id
         FROM chat_sessions s
        WHERE s.app_id = 'ai-studio'
          AND s.archived = FALSE
          AND ${getOlderThanSql('s.updated_at', cfg.idleMinutes)}
          AND (s.historian_last_summary_at IS NULL OR s.historian_last_summary_at < s.updated_at)
        ORDER BY s.updated_at ASC
        LIMIT ?`,
      [BATCH],
    );
    // tangu 会话(web/安卓云端 Tangu Space):同谓词空闲扫描,但做「标题+日志」两件套维护
    // (桌面 localHistorian 的云端等价物;memory 整文覆盖刻意不做——空闲版上下文不足,留桌面按轮版)。
    const tanguRows = await query<any[]>(
      `SELECT s.id, s.user_id, s.title, s.agent_config
         FROM chat_sessions s
        WHERE s.app_id = 'tangu'
          AND s.archived = FALSE
          AND (s.kind IS NULL OR s.kind = 'user')
          AND ${getOlderThanSql('s.updated_at', cfg.idleMinutes)}
          AND (s.historian_last_summary_at IS NULL OR s.historian_last_summary_at < s.updated_at)
        ORDER BY s.updated_at ASC
        LIMIT ?`,
      [BATCH],
    );
    if (!rows.length && !tanguRows.length) return;

    // 整批共用一次模型解析；失败（如配置的模型被禁用）则本 tick 跳过，下 tick 重试（不标记，不丢会话）。
    let resolved: Resolved;
    try {
      resolved = await resolveModelAndKey(cfg.modelId);
    } catch (e: any) {
      console.warn('[historian] 解析摘要模型失败（检查 admin 配置的模型是否启用）:', e?.message || e);
      return;
    }

    for (const r of rows) {
      try {
        await summarizeSession(r.id, r.user_id, cfg.modelId, resolved);
      } catch (e: any) {
        console.warn(`[historian] session ${r.id} 复盘失败:`, e?.message || e);
      }
    }
    for (const r of tanguRows) {
      try {
        await summarizeTanguSession(r, cfg.modelId, resolved);
      } catch (e: any) {
        console.warn(`[historian] tangu session ${r.id} 复盘失败:`, e?.message || e);
      }
    }
  } catch (e: any) {
    console.warn('[historian] tick failed:', e?.message || e);
  } finally {
    running = false;
  }
}

const markPass = (sessionId: string) =>
  query(`UPDATE chat_sessions SET historian_last_summary_at = CURRENT_TIMESTAMP WHERE id = ?`, [sessionId]).catch(() => {});

/** 最近消息（去空 / 去 tool 行）拼 transcript 并截断兜成本；空串 = 无可复盘内容。 */
async function buildTranscript(sessionId: string): Promise<string> {
  const msgs = await query<any[]>(
    `SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY timestamp DESC LIMIT 30`,
    [sessionId],
  );
  msgs.reverse();
  const lines: string[] = [];
  for (const m of msgs) {
    const role = m.role === 'model' ? 'assistant' : m.role;
    if (role !== 'user' && role !== 'assistant') continue;
    const content = String(m.content || '').trim();
    if (!content) continue;
    lines.push(`${role === 'user' ? '用户' : 'AI'}：${content}`);
  }
  let transcript = lines.join('\n').trim();
  if (transcript.length > MAX_TRANSCRIPT_CHARS) transcript = transcript.slice(-MAX_TRANSCRIPT_CHARS);
  return transcript;
}

async function summarizeSession(sessionId: string, userId: string, modelId: string, resolved: Resolved): Promise<void> {
  const transcript = await buildTranscript(sessionId);
  if (!transcript) { await markPass(sessionId); return; } // 无可复盘内容，仍标记避免重扫

  const { model, apiKey, baseUrl, apiModelId } = resolved;
  const messages = [
    { role: 'system', content: HISTORIAN_PROMPT },
    { role: 'user', content: transcript },
  ] as ChatMessage[];
  const payload = await buildProviderPayload({
    model, apiModelId, messages,
    projectSource: '', // 不叠 ai-studio 项目层，保持 historian 指令干净
    temperature: 0.3,
    maxTokens: 300,
    stream: true,
  });
  const res = await streamProviderCompletion({ apiKey, baseUrl, payload });

  // 记 usage（默认不扣配额）。失败不阻断。
  try {
    const user = await getUserById(userId);
    const cost = await calculateCost(modelId, res.usage.prompt_tokens, res.usage.completion_tokens);
    await logApiUsage(
      user?.username || userId, modelId, model.name, model.provider,
      res.usage.prompt_tokens, res.usage.completion_tokens, true, undefined, 'ai-studio-historian', cost,
    );
    if (HISTORIAN_CHARGE_USER) await consumeTokenPoints(userId, cost).catch(() => {});
  } catch { /* 记账失败不阻断复盘 */ }

  const out = String(res.content || '').trim();
  const skip = !out || out.toUpperCase() === 'NOTHING' || out.length < 4 || out.length > 200;
  if (!skip) {
    await appendLogEntry(userId, out).catch((e: any) => console.warn('[historian] appendLog failed:', e?.message || e));
  }
  await markPass(sessionId); // 无论是否写日志都标记本趟
}

// ── tangu 云端会话(web/安卓 Tangu Space)的空闲复盘:标题 + 日志两件套 ─────────────
// 桌面 localHistorian(按轮触发)的云端等价物:worker 无共享库跑不了按轮版,网关定时扫描补位。
// memory 整文覆盖刻意不做(空闲版上下文不足以安全改写长期记忆,交桌面按轮版)。

const TANGU_HISTORIAN_PROMPT =
  'You are a "historian" maintaining a chat session between a user and an AI assistant. ' +
  'Based on the recent conversation below, output STRICT JSON (no markdown fence): {"title": string, "log": string}\n' +
  '- "title": a concise session title in the user\'s language (at most 20 characters, no quotes or decoration). ' +
  'Output an empty string if the current title already fits the conversation.\n' +
  '- "log": if the conversation contains facts, conclusions, completed tasks, or clear long-term preferences worth recording, ' +
  "write ONE concise log entry in the user's language (at most 60 characters, no pleasantries); otherwise an empty string.\n" +
  'Output nothing other than the JSON object.';

/** 容错解析模型 JSON 输出(剥 ``` 围栏;失败 → null)。 */
function parseTitleLog(raw: string): { title: string; log: string } | null {
  let s = String(raw || '').trim();
  if (s.startsWith('```')) s = s.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    const j = JSON.parse(s);
    return { title: String(j?.title ?? '').trim(), log: String(j?.log ?? '').trim() };
  } catch {
    return null;
  }
}

async function summarizeTanguSession(
  row: { id: string; user_id: string; title: any; agent_config: any },
  modelId: string,
  resolved: Resolved,
): Promise<void> {
  const sessionId = String(row.id);
  const userId = String(row.user_id);
  const transcript = await buildTranscript(sessionId);
  if (!transcript) { await markPass(sessionId); return; }

  // 会话绑定 agent → LOG 落该 agent 的记忆域(经云端 agent 定义折叠 shareDefaultMemory);
  // 解析失败/未绑定 → 全局日志。seams 的 memory 实现读 runContext 的 currentAgentSlug。
  let memSlug: string | undefined;
  try {
    const raw = row.agent_config;
    const cfg0 = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
    if (cfg0?.agentSlug) {
      const def = await cloudGetAgent(userId, String(cfg0.agentSlug)).catch(() => null);
      if (def) memSlug = resolveMemorySlug(def);
    }
  } catch { /* ignore */ }

  const { model, apiKey, baseUrl, apiModelId } = resolved;
  const sys = `${TANGU_HISTORIAN_PROMPT}\nCurrent session title: ${JSON.stringify(String(row.title || ''))}`;
  const messages = [
    { role: 'system', content: sys },
    { role: 'user', content: transcript },
  ] as ChatMessage[];
  const payload = await buildProviderPayload({
    model, apiModelId, messages,
    projectSource: '',
    temperature: 0.3,
    maxTokens: 300,
    stream: true,
  });
  const res = await streamProviderCompletion({ apiKey, baseUrl, payload });

  try {
    const user = await getUserById(userId);
    const cost = await calculateCost(modelId, res.usage.prompt_tokens, res.usage.completion_tokens);
    await logApiUsage(
      user?.username || userId, modelId, model.name, model.provider,
      res.usage.prompt_tokens, res.usage.completion_tokens, true, undefined, 'tangu-historian', cost,
    );
    if (HISTORIAN_CHARGE_USER) await consumeTokenPoints(userId, cost).catch(() => {});
  } catch { /* 记账失败不阻断复盘 */ }

  const j = parseTitleLog(String(res.content || ''));
  if (j) {
    const title = j.title.replace(/^["'《「]+|["'》」]+$/g, '').slice(0, 60);
    if (title && title.length >= 2) {
      await query(`UPDATE chat_sessions SET title = ? WHERE id = ?`, [title, sessionId])
        .catch((e: any) => console.warn('[historian] tangu 标题更新失败:', e?.message || e));
    }
    const logText = j.log;
    if (logText && logText.length >= 2 && logText.length <= 200) {
      if (memSlug) enterRunContext(userId, undefined, memSlug);
      await appendLogEntry(userId, logText).catch((e: any) => console.warn('[historian] tangu appendLog failed:', e?.message || e));
    }
  }
  await markPass(sessionId);
}
