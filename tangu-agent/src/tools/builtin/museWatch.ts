/**
 * muse_watch —— 给后台 Muse 设「盯任务」规则(用户在任意聊天里说一声即可设定)。
 *
 * 规则落 ~/.tangu/agents/muse/triggers.json,由 Muse supervisor 每次巡检零 token 评估,
 * 命中才唤醒 Muse 周期(见 services/museTriggers.ts)。可见性:本地限定(hostExec,照 inbox_send);
 * 不进 PLAN_MODE_TOOLS(写操作;Muse 自己的 planMode 周期设不了 watch=防自激)。
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import type { ToolProvider } from '../toolRegistry.js';
import {
  loadTriggers,
  saveTriggers,
  removeTrigger,
  type MuseTrigger,
  type MuseTriggerCond,
} from '../../services/museTriggers.js';

const MAX_TRIGGERS = 50;

function resolvePath(raw: string, cwd?: string): string {
  let p = raw.trim();
  if (p.startsWith('~/') || p === '~') p = path.join(os.homedir(), p.slice(1));
  return path.isAbsolute(p) ? path.normalize(p) : path.resolve(cwd || process.cwd(), p);
}

function fmt(t: MuseTrigger): string {
  const c = t.cond as any;
  const cond =
    c.type === 'file_chars_gte' ? `${c.path} ≥ ${c.n} chars`
    : c.type === 'event_seen' ? `activity contains "${c.match}"`
    : `daily at ${c.time}`;
  return `${t.id}${t.enabled ? '' : ' (disabled)'} — ${t.desc} [${cond}] cooldown ${t.cooldownHours}h, last fired ${t.lastFiredAt || 'never'}`;
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
            'Manage watch rules for Muse, the background agent: when a rule fires, Muse wakes up and turns it into a todo/reminder for the user. ' +
            'Use when the user asks to "keep an eye on" something, e.g. "remind me when xxx.md reaches 100 characters" → set a file_chars_gte rule. ' +
            'Condition types: file_chars_gte (file reaches n non-whitespace chars), event_seen (a new in-app activity line contains `match`, e.g. a file name or event like "note.edit"), daily_at (fires once a day after HH:MM). ' +
            'Rules are evaluated by code every few minutes at zero cost; Muse only runs when one fires.',
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
              prompt: { type: 'string', description: 'set: optional extra instruction for Muse when the rule fires (English preferred)' },
              cooldown_hours: { type: 'number', description: 'set: hours to wait before the rule may fire again (default 24)' },
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

        const desc = String(args.desc || '').trim().slice(0, 200);
        if (!desc) return 'Error: desc 必填(一句人话描述盯什么)';
        const condType = String(args.cond_type || '');
        let cond: MuseTriggerCond;
        if (condType === 'file_chars_gte') {
          const p = String(args.path || '').trim();
          const n = Math.floor(Number(args.n));
          if (!p || !Number.isFinite(n) || n <= 0) return 'Error: file_chars_gte 需要 path 和正整数 n';
          cond = { type: 'file_chars_gte', path: resolvePath(p, ctx.cwd), n };
        } else if (condType === 'event_seen') {
          const match = String(args.match || '').trim().slice(0, 120);
          if (!match) return 'Error: event_seen 需要 match 子串';
          cond = { type: 'event_seen', match };
        } else if (condType === 'daily_at') {
          const time = String(args.time || '').trim();
          if (!/^\d{1,2}:\d{2}$/.test(time)) return 'Error: daily_at 需要 time "HH:MM"';
          cond = { type: 'daily_at', time };
        } else {
          return 'Error: cond_type 须为 file_chars_gte/event_seen/daily_at';
        }
        const list = await loadTriggers();
        if (list.length >= MAX_TRIGGERS) return `Error: 规则已达上限(${MAX_TRIGGERS}),请先 remove 一些`;
        const rule: MuseTrigger = {
          id: `w-${randomUUID().slice(0, 6)}`,
          desc,
          cond,
          prompt: String(args.prompt || '').trim().slice(0, 500) || undefined,
          cooldownHours: Number.isFinite(Number(args.cooldown_hours)) && Number(args.cooldown_hours) > 0
            ? Math.min(24 * 30, Number(args.cooldown_hours))
            : 24,
          lastFiredAt: null,
          enabled: true,
          createdAt: new Date().toISOString(),
        };
        list.push(rule);
        await saveTriggers(list);
        const note = cond.type === 'daily_at'
          ? '(每天过点后的首次巡检触发;若设了 Muse 运行时段,时段外会顺延补发)'
          : '(Muse 巡检周期约每 5 分钟评估一次;需 Muse 已在设置中启用)';
        return `已设定盯任务 ${rule.id}:「${desc}」${note}`;
      },
    },
  ],
};
