/**
 * todo 任务清单工具:todo_write(整单替换)+ todo_read。多步任务的过程性短期记忆,
 * 防止长 run 中途忘步骤(对齐 Claude Code TodoWrite / hermes todo 的用法)。
 * 持久化在 chat_sessions.todos(JSONB,migrate.ts 幂等加列);写入即向 run 事件总线发
 * `todo` 事件,TUI/桌面可实时渲染清单。
 */
import { query } from '../../core/db.js';
import { publish } from '../../services/eventBus.js';
import type { ToolProvider } from '../toolRegistry.js';

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

const MAX_ITEMS = 50;
const MAX_CONTENT_CHARS = 500;

function renderTodos(todos: TodoItem[]): string {
  if (!todos.length) return '(empty todo list)';
  const mark = { pending: '[ ]', in_progress: '[~]', completed: '[x]' } as const;
  return todos.map((t, i) => `${i + 1}. ${mark[t.status]} ${t.content}`).join('\n');
}

async function loadTodos(sessionId: string): Promise<TodoItem[]> {
  const rows = await query<any[]>(`SELECT todos FROM chat_sessions WHERE id = ?`, [sessionId]);
  const raw = rows?.[0]?.todos;
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return Array.isArray(parsed) ? parsed : [];
}

export const todoProvider: ToolProvider = {
  id: 'builtin:todo',
  tools: () => [
    {
      name: 'todo_write',
      mode: 'both',
      definition: {
        type: 'function',
        function: {
          name: 'todo_write',
          description:
            '维护本会话的任务清单(整单替换)。规划多步任务时先写清单;每完成一步就更新状态再继续。' +
            'status ∈ pending | in_progress | completed;同一时刻至多一项 in_progress。',
          parameters: {
            type: 'object',
            properties: {
              todos: {
                type: 'array',
                description: '完整的任务清单(整单替换旧清单)',
                items: {
                  type: 'object',
                  properties: {
                    content: { type: 'string', description: '任务描述(祈使句)' },
                    status: { type: 'string', enum: ['pending', 'in_progress', 'completed'], description: '任务状态' },
                  },
                  required: ['content', 'status'],
                },
              },
            },
            required: ['todos'],
          },
        },
      },
      execute: async (args, ctx) => {
        const input = Array.isArray(args.todos) ? args.todos : null;
        if (!input) return 'Error: todos 必须是数组';
        const todos: TodoItem[] = input.slice(0, MAX_ITEMS).map((t: any) => ({
          content: String(t?.content ?? '').slice(0, MAX_CONTENT_CHARS),
          status: (['pending', 'in_progress', 'completed'].includes(t?.status) ? t.status : 'pending') as TodoItem['status'],
        })).filter((t: TodoItem) => t.content);
        await query(`UPDATE chat_sessions SET todos = ? WHERE id = ?`, [JSON.stringify(todos), ctx.sessionId]);
        if (ctx.runId) void publish(ctx.runId, 'todo', { todos });
        const done = todos.filter((t) => t.status === 'completed').length;
        return `todo list updated (${done}/${todos.length} done)\n${renderTodos(todos)}`;
      },
    },
    {
      name: 'todo_read',
      mode: 'both',
      definition: {
        type: 'function',
        function: {
          name: 'todo_read',
          description: '读取本会话当前的任务清单(恢复上下文/检查剩余步骤时用)。',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      execute: async (_args, ctx) => {
        try {
          return renderTodos(await loadTodos(ctx.sessionId));
        } catch (e: any) {
          return `Error: ${e?.message || e}`;
        }
      },
    },
  ],
};
