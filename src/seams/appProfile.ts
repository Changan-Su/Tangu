/**
 * 接缝①:AppProfile —— 每个 app/部署一份的装载声明(G1/G2)。
 * 工厂见 src/profiles/(aiStudio=云端多租户、tangu=本地/standalone);装配进 TanguDeps.profile。
 *   microserver:createAiStudioProfile()
 *   standalone/TUI:createTanguProfile({ sandboxMode, … })
 *   worker:createAiStudioProfile({ appId: cfg.appId, historian: false, … })
 */
import { deps } from './runtime.js';
import type { ToolProvider } from '../tools/toolRegistry.js';

export interface PromptSectionCtx {
  execMode: 'sandbox' | 'host';
  cwd?: string;
}

/**
 * 系统提示静态段(G4),按插入位置分组(保持与原内联文本相同的段落顺序):
 *   guidance    在「用户长期记忆」段之后、技能段之前(记忆与日志使用指引);
 *   environment 在技能段之后(host=本地执行环境;sandbox=文件输出位置 + 执行效率)。
 */
export interface PromptSections {
  guidance: string[];
  environment: string[];
}

export interface AppProfile {
  /** 取代硬编码的 'ai-studio'(会话/沙箱/资产作用域)。 */
  appId: string;
  displayName: string;
  defaultModelId?: string;
  /** 代码执行后端:docker 沙箱 / 无(禁 exec 类工具)。 */
  sandboxMode: 'docker' | 'none';
  features: {
    sandbox: boolean;
    webSearch: boolean;
    historian: boolean;
    customTools: boolean;
  };
  /** 能力门禁(红线④):未声明 hostExec 的 app,agent_config.execMode='host' 一律强制回 sandbox。 */
  capabilities: {
    hostExec: boolean;
    memory: boolean;
    log: boolean;
  };
  /** 'all'=全部内置工具(零行为变化基线);string[]=内置白名单。providers=app 自带工具(随 G3 生效)。 */
  toolLoadout: {
    builtins: 'all' | string[];
    providers?: ToolProvider[];
  };
  /** 系统提示静态段按 profile 装载(G4)。 */
  promptSections(ctx: PromptSectionCtx): PromptSections;
}

/**
 * 按 app_id 解析 profile。单 profile/进程:缺省或匹配当前装配的 profile → 返回之;
 * 未知 app_id → null(路由侧 400)。多 profile/进程留扩展位,本期不做。
 */
export function resolveProfile(appId?: string | null): AppProfile | null {
  const p = deps().profile;
  if (!appId || appId === p.appId) return p;
  return null;
}
