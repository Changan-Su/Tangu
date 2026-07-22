/**
 * Tangu 示例插件(tangu-sample-plugin):演示文件夹插件的三个常用贡献点——
 * 工具(sample_greet)+ 设置 schema(text/toggle,设置 → 插件 里通用渲染)+ promptSection(启用时注入系统提示)。
 * 硬约束:对核心仅 `import type`(tsconfig verbatimModuleSyntax 把值导入变成编译错误);运行时能力全走 ctx.sdk。
 */
import type { TanguPlugin, PluginMeta, ToolProvider, ToolContext, AppProfile } from '@forsion/tangu-agent';

const ID = 'sample-plugin';

const plugin: TanguPlugin = {
  activate(ctx) {
    const store = ctx.sdk.pluginStore;
    // 工具门禁:插件启用才对模型可见(设置里启停即时生效,无需重启)。
    const gate = (_profile: AppProfile, _c: ToolContext): boolean => store.isPluginEnabledSync(ID);

    const toolProvider: ToolProvider = {
      id: 'plugin:sample-plugin',
      tools: () => [
        {
          name: 'sample_greet',
          mode: 'both',
          isEnabledFor: gate,
          capabilities: { sideEffect: 'none', parallel: true },
          definition: {
            type: 'function',
            function: {
              name: 'sample_greet',
              description: 'Greet someone by name. Demo tool from the sample plugin; the greeting prefix comes from the plugin settings.',
              parameters: {
                type: 'object',
                properties: { name: { type: 'string', description: 'Who to greet' } },
                required: ['name'],
              },
            },
          },
          execute: (args, _c: ToolContext) => {
            const s = store.getScopeSettings(ID, 'global');
            const prefix = typeof s.prefix === 'string' && s.prefix ? s.prefix : 'Hello';
            return `${prefix}, ${String(args.name || 'world')}!`;
          },
        },
      ],
    };

    const meta: PluginMeta = {
      id: ID,
      name: '示例插件',
      nameEn: 'Sample Plugin',
      description: '插件开发模板:演示工具、设置 schema 与 promptSection 三个贡献点。',
      descriptionEn: 'Plugin template: demonstrates a tool, a settings schema and a promptSection.',
      scopes: ['global'],
      defaultEnabled: false,
      settings: {
        fields: [
          { key: 'prefix', type: 'text', label: '问候前缀', labelEn: 'Greeting prefix', default: 'Hello', placeholder: 'Hello / 你好 / Bonjour…' },
          { key: 'excited', type: 'toggle', label: '热情模式(promptSection 演示)', labelEn: 'Excited mode (promptSection demo)', default: false },
        ],
      },
      toolProvider,
      // 启用时注入系统提示片段(注入模型的提示词一律英文;返回空串 = 不注入)。
      promptSection: () => {
        const s = store.getScopeSettings(ID, 'global');
        return s.excited ? 'When greeting people (e.g. via the sample_greet tool), be warm and enthusiastic.' : '';
      },
    };

    ctx.registerPlugin(meta);
    ctx.log('sample-plugin activated');
  },
  deactivate() { /* 本插件无外部资源,无需清理 */ },
};

export default plugin;
