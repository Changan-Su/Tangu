/**
 * muse_watch —— 给后台 Muse 设「盯任务」规则(用户在任意聊天里说一声即可设定)。
 *
 * 规则落 ~/.tangu/agents/muse/triggers.json,由 Muse supervisor 每次巡检零 token 评估,
 * 命中才唤醒 Muse 周期(见 services/museTriggers.ts)。可见性:本地限定(hostExec,照 inbox_send);
 * 不进 PLAN_MODE_TOOLS(写操作;Muse 自己的 planMode 周期设不了 watch=防自激)。
 */
import type { ToolProvider } from '../toolRegistry.js';
import {
  loadTriggers,
  removeTrigger,
  validateTriggerInput,
  upsertTrigger,
  type MuseTrigger,
} from '../../services/museTriggers.js';
import { getAgent } from '../../agents/agentRegistry.js';

function fmt(t: MuseTrigger): string {
  const c = t.cond as any;
  const cond =
    c.type === 'file_chars_gte' ? `${c.path} ≥ ${c.n} chars`
    : c.type === 'event_seen' ? `activity contains "${c.match}"`
    : `daily at ${c.time}`;
  const runner = t.agentSlug ? `, runs agent "${t.agentSlug}"` : '';
  return `${t.id}${t.enabled ? '' : ' (disabled)'} — ${t.desc} [${cond}]${runner} cooldown ${t.cooldownHours}h, last fired ${t.lastFiredAt || 'never'}`;
}

export const museWatchProvider: ToolProvider = {
  id: 'builtin:muse_watch',
  tools: () => [
    {
      name: 'muse_watch',
      mode: 'both',
      isEnabledFor: (profile) => !!profile.capabilities.hostExec, // 本地限定;云端 no-op
      definition: {
        type: 'function',
        function: {
          name: 'muse_watch',
          description:
            'Manage automation watch rules: when a rule fires, by default Muse (the background agent) wakes up and turns it into a todo/reminder for the user; ' +
            'set `agent` to instead have that agent run the rule\'s prompt unattended (full-auto, its own automation session). ' +
            'Use when the user asks to "keep an eye on" something, e.g. "remind me when xxx.md reaches 100 characters" → set a file_chars_gte rule. ' +
            'Condition types: file_chars_gte (file reaches n non-whitespace chars), event_seen (a new in-app activity line contains `match`, e.g. a file name or event like "note.edit"), daily_at (fires once a day after HH:MM). ' +
            'Rules are evaluated by code every few minutes at zero cost; an agent only runs when one fires.',
          parameters: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['set', 'list', 'remove'], description: 'set=add a rule, list=show rules, remove=delete by id' },
              desc: { type: 'string', description: 'set: human-readable description of the task (shown to the user)' },
              cond_type: { type: 'string', enum: ['file_chars_gte', 'event_seen', 'daily_at'], description: 'set: condition type' },
              path: { type: 'string', description: 'set(file_chars_gte): file path (absolute, or relative to the current workspace)' },
              n: { type: 'number', description: 'set(file_chars_gte): non-whitespace character threshold' },
              match: { type: 'string', description: 'set(event_seen): substring to look for in new activity lines' },
              time: { type: 'string', description: 'set(daily_at): local time "HH:MM"' },
              prompt: { type: 'string', description: 'set: optional extra instruction for the runner when the rule fires (English preferred)' },
              cooldown_hours: { type: 'number', description: 'set: hours to wait before the rule may fire again (default 24; min 1 when `agent` is set)' },
              agent: { type: 'string', description: 'set: optional agent slug to run the prompt unattended when the rule fires (omit = wake Muse)' },
              id: { type: 'string', description: 'remove: rule id (from list)' },
            },
            required: ['action'],
          },
        },
      },
      execute: async (args, ctx) => {
        const action = String(args.action || '');
        if (action === 'list') {
          const list = await loadTriggers();
          return list.length ? `${list.length} watch rule(s):\n${list.map(fmt).join('\n')}` : '(no watch rules)';
        }
        if (action === 'remove') {
          const id = String(args.id || '').trim();
          if (!id) return 'Error: id 必填(先 list 查看)';
          return (await removeTrigger(id)) ? `已删除规则 ${id}。` : `Error: 未找到规则 ${id}`;
        }
        if (action !== 'set') return 'Error: action 须为 set/list/remove';

        const v = validateTriggerInput(args as any, { cwd: ctx.cwd });
        if (!v.ok) return `Error: ${v.error}`;
        if (v.value.agentSlug && !(await getAgent(v.value.agentSlug))) {
          return `Error: agent "${v.value.agentSlug}" 不存在(先用 manage_agent 查看可用 agent)`;
        }
        const r = await upsertTrigger(v.value);
        if (!r.ok) return `Error: ${r.error}`;
        const note = v.value.agentSlug
          ? `(命中后由 agent "${v.value.agentSlug}" 全自动执行;巡检约每 5 分钟评估一次)`
          : v.value.cond.type === 'daily_at'
            ? '(每天过点后的首次巡检触发;若设了 Muse 运行时段,时段外会顺延补发)'
            : '(Muse 巡检周期约每 5 分钟评估一次;需 Muse 已在设置中启用)';
        return `已设定盯任务 ${r.trigger.id}:「${v.value.desc}」${note}`;
      },
    },
  ],
};
