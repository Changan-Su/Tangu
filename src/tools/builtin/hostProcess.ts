/**
 * 后台进程工具(host 模式):run_background 启动长跑命令(dev server/watch/长测试),
 * list_processes / read_process_output 轮询,kill_process 终止(进审批闸门,见 approvals)。
 * 注册表与生命周期在 ../processRegistry.ts;模块 dispose 时统一 SIGKILL 防泄漏。
 * 注意:不给 run_bash 加 background 参数——改既有工具的 schema 会打破 defs 字节级前缀稳定。
 */
import { startBackgroundProcess, listProcesses, getProcess, killProcess } from '../processRegistry.js';
import type { ToolProvider } from '../toolRegistry.js';

const READ_CHUNK_CHARS = 20_000;

export const hostProcessProvider: ToolProvider = {
  id: 'builtin:host-process',
  tools: () => [
    {
      name: 'run_background',
      mode: 'host',
      isEnabledFor: (profile) => profile.capabilities.hostExec,
      definition: {
        type: 'function',
        function: {
          name: 'run_background',
          description:
            '在本机后台启动一条长跑 shell 命令(dev server、watch、长测试等),立即返回 process_id。' +
            '用 read_process_output 看输出、list_processes 看状态、kill_process 终止。' +
            '一次性命令请用 run_bash;只有需要持续运行/不能阻塞后续步骤的才用这个。',
          parameters: {
            type: 'object',
            properties: { command: { type: 'string', description: '要后台执行的 shell 命令' } },
            required: ['command'],
          },
        },
      },
      execute: (args, ctx) => {
        const command = String(args.command ?? '').trim();
        if (!command) return 'Error: command is required';
        const r = startBackgroundProcess(ctx.sessionId, command, ctx.cwd || process.cwd());
        if (typeof r === 'string') return r;
        return `started background process ${r.id} (pid ${r.pid})\n稍后用 read_process_output 查看输出。`;
      },
    },
    {
      name: 'list_processes',
      mode: 'host',
      isEnabledFor: (profile) => profile.capabilities.hostExec,
      definition: {
        type: 'function',
        function: {
          name: 'list_processes',
          description: '列出本会话启动的后台进程(id/命令/状态/运行时长)。',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      execute: (_args, ctx) => {
        const list = listProcesses(ctx.sessionId);
        if (!list.length) return '(no background processes)';
        return list
          .map((p) => {
            const dur = Math.round(((p.endedAt ?? Date.now()) - p.startedAt) / 1000);
            const code = p.exitCode !== null ? ` exit=${p.exitCode}` : '';
            return `${p.id} [${p.status}${code}] ${dur}s · ${p.command.length > 80 ? p.command.slice(0, 80) + '…' : p.command}`;
          })
          .join('\n');
      },
    },
    {
      name: 'read_process_output',
      mode: 'host',
      isEnabledFor: (profile) => profile.capabilities.hostExec,
      definition: {
        type: 'function',
        function: {
          name: 'read_process_output',
          description: '读取某后台进程的累计输出(stdout+stderr 合流)。offset 为字符偏移,省略则读尾部。',
          parameters: {
            type: 'object',
            properties: {
              process_id: { type: 'string', description: 'run_background 返回的进程 id' },
              offset: { type: 'number', description: '起始字符偏移(默认读最近 20000 字符)' },
            },
            required: ['process_id'],
          },
        },
      },
      execute: (args, ctx) => {
        const p = getProcess(ctx.sessionId, String(args.process_id ?? ''));
        if (!p) return `Error: 进程 ${args.process_id} 不存在`;
        const total = p.output.length;
        const offset = Number.isFinite(Number(args.offset)) && Number(args.offset) >= 0 ? Number(args.offset) : Math.max(0, total - READ_CHUNK_CHARS);
        const chunk = p.output.slice(offset, offset + READ_CHUNK_CHARS);
        const head = `[${p.id} ${p.status}${p.exitCode !== null ? ` exit=${p.exitCode}` : ''} · chars ${offset}-${offset + chunk.length} of ${total}${p.truncated ? '(头部已被环形缓冲覆盖)' : ''}]`;
        return `${head}\n${chunk || '(no output yet)'}`;
      },
    },
    {
      name: 'kill_process',
      mode: 'host',
      isEnabledFor: (profile) => profile.capabilities.hostExec,
      definition: {
        type: 'function',
        function: {
          name: 'kill_process',
          description: '终止某个后台进程(SIGTERM→3s→SIGKILL)。',
          parameters: {
            type: 'object',
            properties: { process_id: { type: 'string', description: '要终止的进程 id' } },
            required: ['process_id'],
          },
        },
      },
      execute: (args, ctx) => killProcess(ctx.sessionId, String(args.process_id ?? '')),
    },
  ],
};
