/**
 * 云工作区文件工具:list_files / read_file / write_file(execute 体从 registry.ts 原样搬移)。
 * mode:'sandbox' —— host 模式由 hostExec 的真实 FS 工具覆盖。
 */
import {
  listFiles, readFile, writeFile,
  listFilesLocal, readFileLocal, writeFileLocal,
} from '../fileWorkspace.js';
import { getSessionDir, markSessionDirty } from '../../sandbox/sessionSandbox.js';
import type { ToolProvider } from '../toolRegistry.js';

export const workspaceFilesProvider: ToolProvider = {
  id: 'builtin:workspace-files',
  tools: () => [
    {
      name: 'list_files',
      mode: 'sandbox',
      definition: {
        type: 'function',
        function: {
          name: 'list_files',
          description: '列出 agent 工作区某目录下的文件与子目录。',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string', description: "目录路径，根为 '/'" } },
            required: [],
          },
        },
      },
      execute: async (args, ctx) => {
        const p = String(args.path ?? '/');
        const dir = await getSessionDir(ctx).catch(() => null);
        return dir ? listFilesLocal(dir, p) : listFiles(ctx.userId, ctx.appId, ctx.sessionId, p);
      },
    },
    {
      name: 'read_file',
      mode: 'sandbox',
      definition: {
        type: 'function',
        function: {
          name: 'read_file',
          description: '读取 agent 工作区某文件的文本内容。大文件可用 offset/limit 按行分页读取。',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '文件路径，如 /notes/a.txt' },
              offset: { type: 'number', description: '起始行（从 0 计），默认 0' },
              limit: { type: 'number', description: '最多返回的行数（默认读尽，受上限封顶）' },
            },
            required: ['path'],
          },
        },
      },
      execute: async (args, ctx) => {
        const p = String(args.path ?? '');
        const offset = Number.isFinite(Number(args.offset)) && Number(args.offset) >= 0 ? Number(args.offset) : undefined;
        const limit = Number.isFinite(Number(args.limit)) && Number(args.limit) > 0 ? Number(args.limit) : undefined;
        const dir = await getSessionDir(ctx).catch(() => null);
        return dir
          ? readFileLocal(dir, p, offset, limit)
          : readFile(ctx.userId, ctx.appId, ctx.sessionId, p, offset, limit);
      },
    },
    {
      name: 'write_file',
      mode: 'sandbox',
      definition: {
        type: 'function',
        function: {
          name: 'write_file',
          description: '在 agent 工作区写入/覆盖一个文本文件（中间目录自动创建）。',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '文件路径，如 /out/result.py' },
              content: { type: 'string', description: '文件文本内容' },
            },
            required: ['path', 'content'],
          },
        },
      },
      execute: async (args, ctx) => {
        const p = String(args.path ?? '');
        const content = String(args.content ?? '');
        const dir = await getSessionDir(ctx).catch(() => null);
        if (dir) {
          const r = await writeFileLocal(dir, p, content);
          markSessionDirty(ctx); // 标脏 → run 末 snapshot 选择性回写
          return r;
        }
        return writeFile(ctx.userId, ctx.appId, ctx.sessionId, p, content);
      },
    },
  ],
};
