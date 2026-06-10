/**
 * 工具系统门面(G3 拆分后)。工具实现按域拆在 builtin/* 各 provider,经 toolRegistry 自注册;
 * 本文件只负责:① 固定顺序注册内置 provider ② 保持 getToolDefinitions/executeTool 既有签名
 * (agentLoop / tui 的 import 点零改动)。大输出落盘见 outputPersist.ts。
 */
import type { Tool, ToolCall } from '../core/types.js';
import { deps } from '../seams/runtime.js';
import { executeCustomTool } from './customTools.js';
import { registerToolProvider, resolveTools, type ToolDef } from './toolRegistry.js';
import { datetimeProvider, calculatorProvider } from './builtin/coreUtils.js';
import { memoryLogProvider } from './builtin/memoryLog.js';
import { webSearchProvider } from './builtin/webSearch.js';
import { workspaceFilesProvider } from './builtin/workspaceFiles.js';
import { skillsProvider } from './builtin/skills.js';
import { sandboxPythonProvider } from './builtin/sandboxPython.js';
import { hostExecProvider } from './hostExec.js';
import type { ToolContext, ToolResult, ToolImpl } from './toolTypes.js';

// 类型 re-export:保持既有 `from './registry.js'` 的 import 路径不变。
export type { ToolContext, ToolResult, ToolImpl } from './toolTypes.js';

// ── 内置 provider 注册。顺序 = 原 TOOLS 字面量字段顺序(get_datetime → remember/log_event/read_log
//    → calculator → web_search → list_files/read_file/write_file → use_skill → pip_install/run_python),
//    喂给 LLM 的 defs 顺序保持字节级一致;hostExecProvider 最后(host 模式真实 FS 工具追加在末尾,
//    对齐原「HOST_TOOLS 末尾叠加」行为)。──
registerToolProvider(datetimeProvider);
registerToolProvider(memoryLogProvider);
registerToolProvider(calculatorProvider);
registerToolProvider(webSearchProvider);
registerToolProvider(workspaceFilesProvider);
registerToolProvider(skillsProvider);
registerToolProvider(sandboxPythonProvider);
registerToolProvider(hostExecProvider);

/** ctx 自带 profile(loop 按 run.app_id 解析)优先;缺省回退本进程装配的 profile。 */
function currentProfile(ctx: ToolContext) {
  return ctx.profile ?? deps().profile;
}

/** 返回喂给 LLM 的工具定义（OpenAI function 格式）：按模式/profile 过滤的内置 + 本 run 的自定义工具（按名去重，内置优先）。 */
export function getToolDefinitions(ctx: ToolContext): Tool[] {
  const hasSkills = !!(ctx.enabledSkillIds && ctx.enabledSkillIds.length);
  const tools = resolveTools(currentProfile(ctx), ctx);
  const defs: Tool[] = [];
  for (const [name, t] of tools) {
    if (name === 'use_skill' && !hasSkills) continue; // 无启用技能时不暴露 use_skill
    defs.push(t.definition);
  }
  if (ctx.customTools && ctx.customTools.size) {
    for (const t of ctx.customTools.values()) {
      if (tools.has(t.name)) continue; // 内置同名优先
      defs.push(t.definition);
    }
  }
  return defs;
}

/** 执行一个工具调用。先查（按模式/profile 过滤的）内置，再查本 run 的自定义工具；未知工具返回 isError。 */
export async function executeTool(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
  const name = call.function.name;
  let args: Record<string, any> = {};
  try {
    args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
  } catch {
    args = {};
  }

  const impl: ToolDef | undefined = resolveTools(currentProfile(ctx), ctx).get(name);
  if (impl) {
    try {
      const result = await impl.execute(args, ctx);
      return { toolCallId: call.id, name, result: String(result), isError: false };
    } catch (e: any) {
      return { toolCallId: call.id, name, result: `Error: ${e?.message || e}`, isError: true };
    }
  }

  const custom = ctx.customTools?.get(name);
  if (custom) {
    try {
      const result = await executeCustomTool(custom, args, ctx);
      const isError = typeof result === 'string' && result.startsWith('Error:');
      return { toolCallId: call.id, name, result: String(result), isError };
    } catch (e: any) {
      return { toolCallId: call.id, name, result: `Error: ${e?.message || e}`, isError: true };
    }
  }

  return { toolCallId: call.id, name, result: `Tool "${name}" is not available.`, isError: true };
}
