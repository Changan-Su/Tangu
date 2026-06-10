/**
 * 记忆/日志工具:remember / log_event / read_log(execute 体从 registry.ts 原样搬移)。
 * 经 deps().brain.memory 落云端(或 standalone 的 httpBrain)。
 */
import { deps } from '../../seams/runtime.js';
import type { ToolProvider } from '../toolRegistry.js';

// ── 注入依赖的 lazy 别名(保持下方调用点不变)──
const appendMemoryEntry = (userId: string, text: string, opts?: { dedup?: boolean; cap?: number }) =>
  deps().brain.memory.appendMemoryEntry(userId, text, opts);
const appendLogEntry = (userId: string, text: string) => deps().brain.memory.appendLogEntry(userId, text);
const getLog = (userId: string, date?: string) => deps().brain.memory.getLog(userId, date);

export const memoryLogProvider: ToolProvider = {
  id: 'builtin:memory-log',
  tools: () => [
    {
      name: 'remember',
      isEnabledFor: (profile) => profile.capabilities.memory,
      definition: {
        type: 'function',
        function: {
          name: 'remember',
          description:
            '把一条关于用户的稳定、长期有用的事实/偏好写入长期记忆（跨会话保留，会注入到后续对话）。' +
            '仅用于持久信息（如长期偏好、背景设定、称呼），不要记录一次性任务细节或临时上下文。重复内容会被自动忽略。',
          parameters: {
            type: 'object',
            properties: { fact: { type: 'string', description: '要长期记住的一句话事实/偏好' } },
            required: ['fact'],
          },
        },
      },
      execute: async (args, ctx) => {
        const fact = String(args.fact ?? '').trim();
        if (!fact) return 'Error: fact is required';
        const r = await appendMemoryEntry(ctx.userId, fact, { dedup: true });
        if (r.appended) return '已记入长期记忆。';
        if (r.reason === 'duplicate') return '已存在相同记忆，无需重复记录。';
        if (r.reason === 'full') return '长期记忆已接近上限，本条未写入。可提醒用户在账户中心整理记忆。';
        return 'Error: fact is required';
      },
    },
    {
      name: 'log_event',
      isEnabledFor: (profile) => profile.capabilities.log,
      definition: {
        type: 'function',
        function: {
          name: 'log_event',
          description:
            '把本次交互中值得留痕的事件/进展追加到用户「今天」的活动日志（按日期归档，用户可在账户中心查看）。' +
            '用于记录已完成的事、得出的结论、产出的文件等；不要记录琐碎闲聊。',
          parameters: {
            type: 'object',
            properties: { text: { type: 'string', description: '要记入今天日志的一句话事件/进展' } },
            required: ['text'],
          },
        },
      },
      execute: async (args, ctx) => {
        const text = String(args.text ?? '').trim();
        if (!text) return 'Error: text is required';
        const r = await appendLogEntry(ctx.userId, text);
        return `已记入 ${r.date} 日志（${r.time}）。`;
      },
    },
    {
      name: 'read_log',
      isEnabledFor: (profile) => profile.capabilities.log,
      definition: {
        type: 'function',
        function: {
          name: 'read_log',
          description: '读取用户某一天的活动日志（markdown）。日期格式 YYYY-MM-DD，缺省读今天。',
          parameters: {
            type: 'object',
            properties: { date: { type: 'string', description: '日期 YYYY-MM-DD，缺省今天' } },
            required: [],
          },
        },
      },
      execute: async (args, ctx) => {
        const date = String(args.date ?? '').trim() || undefined;
        const r = await getLog(ctx.userId, date);
        return r.content?.trim() ? r.content : `（${r.date} 暂无日志）`;
      },
    },
  ],
};
