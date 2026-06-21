/**
 * 系统提示静态段(G4):从 agentLoop 内联文本**逐字节**搬移,按 AppProfile.promptSections 装载。
 * ⚠️ 改动这些文本会改变所有 app 的 prompt——per-app 定制请在各自 profile 工厂里覆盖,勿改默认段。
 */
import type { PromptSectionCtx, PromptSections } from '../seams/appProfile.js';

/** 「记忆与日志」使用指引(用户记忆段之后、技能段之前)。 */
export const MEMORY_LOG_GUIDANCE =
  '## 记忆与日志\n' +
  '- 遇到值得长期保留的用户事实/偏好，用 `remember` 工具记入长期记忆（跨会话保留，勿记一次性细节）。\n' +
  '- 完成的事/结论/产出可用 `log_event` 记入当天日志；需回顾历史用 `read_log` 查看某天。';

/** host 模式(本地直连):真实文件系统 + shell 的执行环境说明。 */
export function hostEnvSection(cwd?: string): string {
  return (
    '## 本地执行环境（重要）\n' +
    `你运行在**用户本机**，当前工作目录是 \`${cwd || process.cwd()}\`。\n` +
    '- 用 `run_bash` 执行 shell 命令；`list_dir`/`read_file` 查看；`edit_file` 做精确局部修改、`write_file` 写新文件——全部作用于真实文件系统（相对路径相对当前工作目录解析）。\n' +
    '- 查实时网页信息优先用 `browser_search`；需要打开网页、点击、输入或截图时使用 `browser_navigate` / `browser_snapshot` / `browser_click` / `browser_type` / `browser_screenshot`。\n' +
    '- 优先用 `edit_file`（唯一匹配的 old_string→new_string）做小改，不要整文件重写。\n' +
    '- 破坏性操作（写文件 / 跑命令）可能需要用户审批；被拒绝时换方案或询问用户，不要反复重试同一操作。'
  );
}

/** sandbox 模式:文件输出位置(最常见的「产物丢失」原因:模型把文件写到工作区之外)。 */
export const SANDBOX_OUTPUT_SECTION =
  '## 文件输出位置（重要）\n' +
  '本会话有一个**工作区**，是唯一会被保留并回流给用户的地方。' +
  '用 `write_file` 或在 `run_python` 里写文件时，一律用**相对路径**（如 `report.docx`、`out/data.csv`）——' +
  '它就落在工作区里（run_python 的当前目录 /workspace，等价 /mnt/data）。\n' +
  '**不要**把要交付的产物写到 `/tmp`、`~/`(HOME) 或其他绝对路径——那些不在工作区、不会保留，文件会丢失。';

/** sandbox 模式:执行效率约束(最影响耗时的是模型「生成量」:慢模型 ~50 tok/s,写 8000 token 要 ~160s)。 */
export const EFFICIENCY_SECTION =
  '## 执行效率（重要）\n' +
  '- 生成文档直接用 python-docx / openpyxl / python-pptx **一步写出目标文件**；' +
  '不要先写中间 md/txt 再转换、不要把同一份内容生成两遍、不要手搓 OOXML/XML、不用 docx-js/pandoc/node。\n' +
  '- 严格按用户要求的篇幅产出，不要无谓加长（生成越多越慢）。\n' +
  '- run_python 尽量一次写完整脚本，减少往返轮次。';

/** 默认段落装载(AI Studio 与 Tangu 当前文本一致;per-app 差异化在各自工厂覆盖)。 */
export function defaultPromptSections(ctx: PromptSectionCtx): PromptSections {
  return {
    guidance: [MEMORY_LOG_GUIDANCE],
    environment:
      ctx.execMode === 'host'
        ? [hostEnvSection(ctx.cwd)]
        : [SANDBOX_OUTPUT_SECTION, EFFICIENCY_SECTION],
  };
}
