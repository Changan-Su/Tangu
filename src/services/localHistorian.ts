/**
 * 本地 Historian（Special Agent）—— 按「轮」触发，区别于云端 historian.ts 的空闲扫描。
 *
 * 一应一和 = 1 轮（= 1 个 done run）。每个用户会话 run 完成后（agentLoop done 钩子）：
 *   - 每 everyTitleRounds 轮：总结并更新会话标题；
 *   - 每 everyMemoryRounds 轮：判断是否更新用户 LOG/memory（经 brain.memory），有则写入；
 *   - 首轮（roundN===1 且 firstRoundTrigger）必触发两者。
 * 配置见 special-agents.json（enabled 默认关、需选 modelId）。活动写 special_agent_log（隔离记录，
 * 驱动 Historian 工作视图），不进用户会话列表。本地特性：仅 host-exec profile 形态启用，云端 no-op。
 *
 * 成本：背景任务、用户未主动发起 → 只记 usage（projectSource='tangu-historian'），默认不扣配额。
 */
import { v4 as uuidv4 } from 'uuid';
import { query } from '../core/db.js';
import { deps } from '../seams/runtime.js';
import type { ChatMessage } from '../core/types.js';
import { loadSpecialAgentsConfig, DEFAULT_HISTORIAN_PROMPT } from './specialAgentsConfig.js';
import { enterRunContext } from '../seams/runContext.js';

const MAX_TRANSCRIPT_CHARS = 8000;
const CHARGE_USER = false;
const MIN_NEW_CHARS = 120; // 自上次维护以来的新对话字符数地板;不足视为琐碎轮,跳过整次判断

/**
 * 构造 Historian 的结构化判断 system prompt:一次调用、输出 JSON,title/log/memory 各自独立判断。
 * customPrompt = 用户可配的「判断哲学」(留空用默认);代码强制 JSON 输出格式 + 仅含到期字段。
 * 关键:LOG(当天流水:发生了什么)与 memory(长期稳定事实/偏好,跨会话有用、绝非流水账)是**两类不同内容**,
 * 不得相同;memory 要克制,多数对话应为空。
 */
function buildJudgeSystem(customPrompt: string, wantTitle: boolean, wantLog: boolean, wantMemory: boolean, curMemory: string): string {
  const fields: string[] = [];
  if (wantTitle) fields.push('"title": a phrase of ≤16 characters in the user\'s language summarizing this conversation\'s topic, used as the session title (always provide it)');
  if (wantLog) fields.push('"log": if this conversation has an event/progress/output "worth noting for the day", write one short sentence in the user\'s language; otherwise give an empty string ""');
  if (wantMemory) {
    fields.push(
      '"memory": **full overwrite** — based on the [Current Long-Term Memory] below and this conversation, output the **complete updated long-term memory in full** ' +
      '(you may add entries, revise, or delete outdated/corrected entries; keep old entries that still hold). Only provide it when there is a real change; if nothing changed, give an empty string "". ' +
      'Memory is long-term stable information about the user themselves (identity/preferences/goals/important facts); keep it concise and itemized, and **do not put the day\'s running log into it** (that is the log).',
    );
  }
  return [
    (customPrompt && customPrompt.trim()) || DEFAULT_HISTORIAN_PROMPT,
    wantMemory ? `\n[Current Long-Term Memory]\n${curMemory.trim() || '(empty)'}` : '',
    '\nRead the conversation below and judge; output **a single JSON object** only, with the following fields:',
    '- ' + fields.join('\n- '),
    'Example: {"title":"Gradient visualization","log":"Finished first draft of donk_intro.docx","memory":"- Learning linear algebra and multivariable calculus\\n- Prefers concise, direct answers"}',
    'Give an empty string for fields that need no update. Output JSON only — no code fences, no extra text.',
  ].filter(Boolean).join('\n');
}

/** 从模型输出里提取首个 JSON 对象(容忍代码围栏 / 前后噪声)。失败 → null。 */
function parseJudgement(raw: string): { title?: string; log?: string; memory?: string } | null {
  let s = String(raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const i = s.indexOf('{');
  const j = s.lastIndexOf('}');
  if (i >= 0 && j > i) s = s.slice(i, j + 1);
  try {
    const o = JSON.parse(s);
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}

/** 纯判定:第 roundN 轮是否触发(首轮可强制 + 每 every 轮)。roundN<1 不触发。 */
export function isRoundDue(roundN: number, every: number, firstRoundTrigger: boolean): boolean {
  if (roundN < 1) return false;
  if (roundN === 1 && firstRoundTrigger) return true;
  return every > 0 && roundN % every === 0;
}

/**
 * 自本会话上次 Historian 动作（special_agent_log）以来，新对话内容是否够「实质」。
 * 无历史动作 = 该会话首次维护 → 放行。两列均为 SQL TIMESTAMP（同域可比，方言安全）。查询失败 → 放行（不阻断既有行为）。
 */
async function enoughNewSinceLastAction(sessionId: string): Promise<boolean> {
  try {
    const last = await query<any[]>(
      `SELECT created_at FROM special_agent_log WHERE session_ref = ? AND agent = 'historian'
       ORDER BY created_at DESC LIMIT 1`,
      [sessionId],
    );
    const since = last[0]?.created_at;
    if (!since) return true; // 本会话尚未维护过 → 放行
    const rows = await query<any[]>(
      `SELECT content FROM chat_messages WHERE session_id = ? AND created_at > ? AND role IN ('user', 'model', 'assistant')`,
      [sessionId, since],
    );
    const chars = (rows || []).reduce((s, r) => s + String(r.content || '').trim().length, 0);
    return chars >= MIN_NEW_CHARS;
  } catch {
    return true;
  }
}

async function recentTranscript(sessionId: string, limit = 30): Promise<string> {
  const rows = await query<any[]>(
    `SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?`,
    [sessionId, limit],
  );
  rows.reverse();
  const lines: string[] = [];
  for (const m of rows) {
    const role = m.role === 'model' ? 'assistant' : m.role;
    if (role !== 'user' && role !== 'assistant') continue;
    const content = String(m.content || '').trim();
    if (content) lines.push(`${role === 'user' ? '用户' : 'AI'}：${content}`);
  }
  let s = lines.join('\n');
  if (s.length > MAX_TRANSCRIPT_CHARS) s = s.slice(-MAX_TRANSCRIPT_CHARS);
  return s;
}

/** 单次轻量补全（系统提示 + transcript）。失败返回 ''(并打日志说明原因)。记 usage（默认不扣配额）。 */
async function complete(label: string, modelId: string, system: string, transcript: string, userId: string, maxTokens: number): Promise<string> {
  try {
    const { model, apiKey, baseUrl, apiModelId } = await deps().brain.llm.resolveModelAndKey(modelId);
    const payload = await deps().brain.llm.buildProviderPayload({
      model, apiModelId,
      messages: [{ role: 'system', content: system }, { role: 'user', content: transcript }] as ChatMessage[],
      projectSource: '', temperature: 0.3, maxTokens, stream: true,
      provider: (model as any)?.provider,
    } as any);
    const res = await deps().brain.llm.streamProviderCompletion({ apiKey, baseUrl, payload, provider: (model as any)?.provider });
    try {
      const cost = await deps().billing.calculateCost(modelId, res.usage?.prompt_tokens || 0, res.usage?.completion_tokens || 0);
      const u = await deps().brain.users.getUserById(userId);
      await (deps().billing.logApiUsage as any)(
        u?.username || userId, modelId, model.name, model.provider,
        res.usage?.prompt_tokens || 0, res.usage?.completion_tokens || 0, true, undefined, 'tangu-historian', cost,
      );
      if (CHARGE_USER) await deps().billing.consumeTokenPoints(userId, cost).catch(() => {});
    } catch { /* 记账失败不阻断 */ }
    const out = String(res?.content || '').trim();
    if (!out) log(`${label} 模型返回空内容(model=${modelId})`);
    return out;
  } catch (e: any) {
    log(`${label} 模型调用失败(model=${modelId}): ${e?.message || e}`);
    return '';
  }
}

async function logActivity(userId: string, action: string, detail: string, sessionRef: string): Promise<void> {
  try {
    await query(
      `INSERT INTO special_agent_log (id, user_id, agent, action, detail, session_ref) VALUES (?, ?, 'historian', ?, ?, ?)`,
      [uuidv4(), userId, action, detail.slice(0, 1000), sessionRef],
    );
  } catch (e: any) {
    log(`写 special_agent_log 失败(${action}): ${e?.message || e}`);
  }
}

function log(msg: string): void {
  try { deps().host.log(`[historian] ${msg}`); } catch { console.log(`[historian] ${msg}`); }
}
/** 是否本地形态(host-exec profile)。云端 baseline 无 hostExec → Historian 整体 no-op。 */
function isLocal(): boolean {
  try { return !!deps().profile.capabilities.hostExec; } catch { return false; }
}

/**
 * run 完成钩子：判断并执行标题/记忆更新。fire-and-forget（agentLoop void 调用），绝不抛。
 * 仅处理 kind='user' 的会话；Historian 自身不产生 run，无递归风险。
 */
export async function onUserRunDone(sessionId: string, userId: string, agentSlug?: string): Promise<void> {
  if (!isLocal()) return;
  // 解析本 run 的 agent:优先传入的 agentSlug,否则从会话 agent_config.agentSlug 兜底读(任意入口/旧路径都落对 agent)。
  // 重注入 Historian 自己的异步上下文 → deps().brain.memory(动态本地库)读写落到该 agent 的文件夹(fire-and-forget
  // 不保证继承原 run 的 ALS,故显式重设;云端 isLocal=false 已 return)。
  let effectiveSlug = agentSlug;
  if (!effectiveSlug) {
    try {
      const r = await query<any[]>(`SELECT agent_config FROM chat_sessions WHERE id = ? LIMIT 1`, [sessionId]);
      const raw = r[0]?.agent_config;
      const cfg0 = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
      if (cfg0?.agentSlug) effectiveSlug = String(cfg0.agentSlug);
    } catch { /* ignore */ }
  }
  if (effectiveSlug) enterRunContext(userId, undefined, effectiveSlug);
  let cfg;
  try { cfg = loadSpecialAgentsConfig().historian; } catch { return; }
  if (!cfg.enabled || !cfg.modelId) return;

  try {
    // 仅用户会话；并发安全：roundN 由 done run 计数推出（幂等）。
    const skRows = await query<any[]>(`SELECT kind, title FROM chat_sessions WHERE id = ? LIMIT 1`, [sessionId]);
    const sk = skRows[0];
    if (!sk || (sk.kind && sk.kind !== 'user')) return;

    // 注意:不能用 `COUNT(*)::int`(PG cast)——standalone 是 SQLite,`::` 会报 unrecognized token。
    const cntRows = await query<any[]>(
      `SELECT COUNT(*) AS n FROM agent_runs WHERE session_id = ? AND status = 'done'`,
      [sessionId],
    );
    const roundN = Number(cntRows[0]?.n) || 0;
    if (roundN < 1) return;

    const titleDue = isRoundDue(roundN, cfg.everyTitleRounds, cfg.firstRoundTrigger);
    const memoryDue = isRoundDue(roundN, cfg.everyMemoryRounds, cfg.firstRoundTrigger);
    if (!titleDue && !memoryDue) return;
    // LOG(当天流水,append-only,无侵蚀)跟随 title 的较高频率;只有 memory 整文重写走稀疏的 everyMemoryRounds。
    const logDue = titleDue;

    // 实质增量地板:自上次维护以来新增内容太少 → 跳过整次判断(避免琐碎轮重复总结 / 反复重写记忆侵蚀)。
    if (!(await enoughNewSinceLastAction(sessionId))) { log(`第 ${roundN} 轮到点但自上次维护无实质新增,跳过`); return; }
    log(`第 ${roundN} 轮触发(标题:${titleDue} 记忆:${memoryDue},模型 ${cfg.modelId})`);

    const transcript = await recentTranscript(sessionId);
    if (!transcript.trim()) { log('无可用对话内容,跳过'); return; }

    // memory 是「读-改-写」:把现有记忆喂给模型,让它产出更新后的完整记忆(增量或修订)。
    const curMem = memoryDue
      ? String((await deps().brain.memory.getMemory(userId).catch(() => ({ content: '' })))?.content || '')
      : '';

    // 一次结构化判断:title / log / memory 各自独立(到期才要、不需要则空)。
    const sys = buildJudgeSystem(cfg.prompt, titleDue, logDue, memoryDue, curMem);
    const raw = await complete('判断', cfg.modelId, sys, transcript, userId, 1200);
    const j = parseJudgement(raw);
    if (!j) { log(`判断输出无法解析为 JSON: "${raw.slice(0, 80)}"`); return; }
    const title = String(j.title || '').trim().replace(/^["'《「]+|["'》」]+$/g, '').slice(0, 60);
    const logText = String(j.log || '').trim();
    const memoryDoc = String(j.memory || '').trim();
    const okShort = (s: string) => !!s && s.toUpperCase() !== 'NOTHING' && s.length >= 2 && s.length <= 400;
    log(`判断: title="${title}" log="${logText.slice(0, 30)}" memoryΔ=${memoryDoc ? `${curMem.length}→${memoryDoc.length}` : '无'}`);

    if (titleDue && okShort(title)) {
      await query(`UPDATE chat_sessions SET title = ? WHERE id = ?`, [title, sessionId]).catch((e: any) => log(`更新标题失败: ${e?.message || e}`));
      await logActivity(userId, 'title_updated', title, sessionId);
      log(`已更新标题: ${title}`);
    }
    if (logDue && okShort(logText)) {
      // LOG = 当天流水(append-only)。共享 LOG 经 brain(云端)。
      await deps().brain.memory.appendLogEntry(userId, logText).then(() => log('已写入 LOG')).catch((e: any) => log(`写 LOG 失败: ${e?.message || e}`));
      await logActivity(userId, 'log_appended', logText, sessionId);
    }
    if (memoryDue && memoryDoc && memoryDoc.toUpperCase() !== 'NOTHING' && memoryDoc !== curMem.trim()) {
      // memory = 整体覆盖(读-改-写)。防异常缩水:旧记忆较多而新内容骤降 → 疑似截断,弃用。
      const suspiciousShrink = curMem.trim().length > 200 && memoryDoc.length < curMem.trim().length * 0.4;
      const setMem = deps().brain.memory.setMemory;
      if (suspiciousShrink) {
        log(`记忆疑似异常缩水(${curMem.trim().length}→${memoryDoc.length}),跳过覆盖`);
      } else if (setMem) {
        try {
          await setMem(userId, memoryDoc.slice(0, 20000));
          await logActivity(userId, 'memory_updated', memoryDoc.slice(0, 300), sessionId);
          log('已更新 memory(整体覆盖)');
        } catch (e: any) { log(`写 memory 失败(服务端可能未部署 PUT /brain/memory): ${e?.message || e}`); }
      } else {
        log('当前 brain 不支持 setMemory,跳过记忆覆盖(需更新服务端)');
      }
    }
  } catch (e: any) {
    log(`onUserRunDone 异常: ${e?.message || e}`);
  }
}
