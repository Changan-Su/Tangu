/**
 * delegate 工具:把可隔离的子任务外包给子代理(services/subAgent.ts),只把结论带回父上下文。
 * 适合大范围搜索/批量分析——中间过程不占父上下文。仅 hostExec profile(本地形态)暴露;
 * 深度上限 1(子代理内本工具不可见,见 ToolContext.subAgentDepth)。
 */
import { runSubAgent } from '../../services/subAgent.js';
import type { ToolProvider } from '../toolRegistry.js';

export const delegateProvider: ToolProvider = {
  id: 'builtin:delegate',
  tools: () => [
    {
      name: 'delegate',
      mode: 'both',
      // 本地形态限定(云端待计费按子轮次核验后再开)+ 防递归:子代理内不可见
      isEnabledFor: (profile, ctx) => profile.capabilities.hostExec && !(ctx.subAgentDepth && ctx.subAgentDepth >= 1),
      definition: {
        type: 'function',
        function: {
          name: 'delegate',
          description:
            '把一个独立子任务外包给子代理执行(子代理有自己的上下文和同套工具,最多 8 轮),' +
            '返回其最终报告。适合大范围搜索、批量文件分析等中间过程冗长的任务——' +
            '过程不占用你的上下文,你只拿结论。子任务描述必须自包含(子代理看不到当前对话)。',
          parameters: {
            type: 'object',
            properties: {
              task: { type: 'string', description: '子任务描述(自包含、目标明确,说清要返回什么)' },
              context: { type: 'string', description: '可选:子代理需要的背景信息(相关路径、已知结论等)' },
            },
            required: ['task'],
          },
        },
      },
      execute: async (args, ctx) => {
        const task = String(args.task ?? '').trim();
        if (!task) return 'Error: task is required';
        const modelId = ctx.modelId || ctx.profile?.defaultModelId || '';
        if (!modelId) return 'Error: 无可用模型(父 run 未带 modelId)';
        try {
          return await runSubAgent({
            task,
            context: args.context ? String(args.context) : undefined,
            parentCtx: ctx,
            modelId,
          });
        } catch (e: any) {
          return `Error: 子代理失败: ${e?.message || e}`;
        }
      },
    },
  ],
};
