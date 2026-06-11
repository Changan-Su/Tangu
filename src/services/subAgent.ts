/**
 * delegate 子代理:在父 run 内开一个独立上下文的小 loop(无 DB 会话、无历史),
 * 把可并行/可隔离的子任务(大范围搜索、批量文件分析)外包出去,只把**结论**带回父上下文,
 * 避免父上下文被中间过程灌爆(对齐 hermes delegate_task / Claude Code Agent tool)。
 *
 * 约束:
 *   - 深度上限 1(子代理内 delegate 不可见,见 ToolContext.subAgentDepth)
 *   - maxIterations 8,单工具结果照旧 capToolResult 由各工具自管
 *   - 工具集 = 主 registry 按 subCtx 过滤(delegate 自动滤掉);审批闸门照走(host 模式)
 *   - 仅 hostExec profile 暴露(本地形态;云端待计费/配额按子轮次核验后再开)——故计费走
 *     noopBilling,这里不重复扣点;usage 经 `subagent` 事件上报给父 run 的订阅者
 */
import { deps } from '../seams/runtime.js';
import { getToolDefinitions, executeTool, type ToolContext } from '../tools/registry.js';
import { gateToolCall } from './approvals.js';
import { publish } from './eventBus.js';
import type { ChatMessage } from '../core/types.js';

const SUB_MAX_ITERATIONS = 8;
const SUB_RESULT_CAP = 12_000;

const SUB_SYSTEM_PROMPT =
  '你是一个子任务代理(sub-agent):独立完成指派的子任务,然后给出**自包含的最终报告**。\n' +
  '- 你的最终回复会原样返回给主代理,主代理看不到你的中间过程——所有结论/文件路径/关键发现必须写进最终回复\n' +
  '- 聚焦指派的子任务,不要扩大范围;能用工具验证的就验证\n' +
  '- 简洁:报告以要点为主,引用 文件:行号 定位';

export interface SubAgentParams {
  task: string;
  context?: string;
  parentCtx: ToolContext;
  modelId: string;
}

export async function runSubAgent(p: SubAgentParams): Promise<string> {
  const { parentCtx } = p;
  const runId = parentCtx.runId || '';
  const { llm } = deps().brain;

  const subCtx: ToolContext = {
    ...parentCtx,
    subAgentDepth: (parentCtx.subAgentDepth || 0) + 1,
  };
  const toolDefs = getToolDefinitions(subCtx);

  const { model, apiKey, baseUrl, apiModelId } = await llm.resolveModelAndKey(p.modelId);

  const messages: ChatMessage[] = [
    { role: 'system', content: SUB_SYSTEM_PROMPT } as ChatMessage,
    {
      role: 'user',
      content: p.context ? `${p.task}\n\n## 背景\n${p.context}` : p.task,
    } as ChatMessage,
  ];

  if (runId) void publish(runId, 'subagent', { phase: 'start', task: p.task.slice(0, 200) });

  let finalContent = '';
  for (let iteration = 0; iteration < SUB_MAX_ITERATIONS; iteration++) {
    if (parentCtx.signal?.aborted) throw new Error('aborted');
    const lastIter = iteration === SUB_MAX_ITERATIONS - 1;

    const payload = await llm.buildProviderPayload({
      model,
      apiModelId,
      messages,
      projectSource: parentCtx.appId,
      temperature: 0.7,
      tools: toolDefs,
      toolChoice: lastIter ? 'none' : 'auto',
      attachments: [],
      thinkingLevel: 'off',
      stream: true,
      // 子代理用独立缓存路由键:消息序列与父会话完全不同,蹭父会话的键反而打散其缓存
      cacheKey: `${parentCtx.sessionId}:sub`,
    });

    const res = await llm.streamProviderCompletion({
      apiKey,
      baseUrl,
      payload,
      provider: (model as any)?.provider,
      signal: parentCtx.signal,
    });

    if (runId) {
      void publish(runId, 'subagent', {
        phase: 'iteration',
        iteration,
        usage: { prompt: res.usage.prompt_tokens || 0, completion: res.usage.completion_tokens || 0 },
        toolCalls: (res.toolCalls || []).map((c) => c.function.name),
      });
    }

    if (!res.toolCalls?.length || lastIter) {
      finalContent = res.content || finalContent;
      break;
    }

    messages.push({ role: 'assistant', content: res.content || '', tool_calls: res.toolCalls } as ChatMessage);
    for (const call of res.toolCalls) {
      if (parentCtx.signal?.aborted) throw new Error('aborted');
      // 审批闸门照走(host 模式破坏性操作仍需用户批准;审批请求发到父 run 的事件流)
      const decision = await gateToolCall(
        runId,
        call,
        { sessionId: parentCtx.sessionId, execMode: parentCtx.execMode, approvalMode: parentCtx.approvalMode },
        parentCtx.signal,
      );
      let content: string;
      let isError = false;
      if (decision.action === 'reject') {
        content = '用户拒绝了该操作。';
        isError = true;
      } else {
        const execCall = decision.argsOverride
          ? { ...call, function: { ...call.function, arguments: JSON.stringify(decision.argsOverride) } }
          : call;
        const r = await executeTool(execCall, subCtx);
        content = r.result;
        isError = r.isError;
      }
      if (runId) {
        void publish(runId, 'subagent', {
          phase: 'tool',
          name: call.function.name,
          isError,
          preview: content.slice(0, 160),
        });
      }
      messages.push({ role: 'tool', content, tool_call_id: call.id } as ChatMessage);
    }
  }

  const result = (finalContent || '(子代理未产出结论)').slice(0, SUB_RESULT_CAP);
  if (runId) void publish(runId, 'subagent', { phase: 'done', resultChars: result.length });
  return result;
}
