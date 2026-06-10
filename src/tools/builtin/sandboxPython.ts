/**
 * 云端 Python 沙箱工具:pip_install / run_python(execute 体从 registry.ts 原样搬移)。
 * isEnabledFor:profile.features.sandbox —— 无 docker 的部署(standalone --sandbox none)不再
 * 暴露注定失败的工具(改造前会暴露并在调用时报错;此为有意的小改进,见 Log)。
 */
import { installPackages } from '../../sandbox/dockerProvider.js';
import { runPythonInSession } from '../../sandbox/sessionSandbox.js';
import { formatToolOutput } from '../outputPersist.js';
import type { ToolProvider } from '../toolRegistry.js';

export const sandboxPythonProvider: ToolProvider = {
  id: 'builtin:sandbox-python',
  tools: () => [
    {
      name: 'pip_install',
      mode: 'sandbox',
      isEnabledFor: (profile) => profile.features.sandbox,
      definition: {
        type: 'function',
        function: {
          name: 'pip_install',
          description:
            '为云端沙箱按需安装缺失的 Python 包（仅二进制 wheel）。装好后 run_python 即可 import；' +
            '常用库（python-docx/openpyxl/python-pptx/reportlab/pandas/numpy/matplotlib/Pillow 等）已预装，无需安装。' +
            '安装是全局缓存的，同一个包只需装一次。',
          parameters: {
            type: 'object',
            properties: {
              packages: {
                type: 'array',
                items: { type: 'string' },
                description: '包名列表，可带版本，如 ["openpyxl", "tqdm==4.66.5"]',
              },
            },
            required: ['packages'],
          },
        },
      },
      execute: async (args, ctx) => {
        const raw = args.packages;
        const pkgs = Array.isArray(raw) ? raw.map((p) => String(p)) : raw ? [String(raw)] : [];
        const res = await installPackages(pkgs, { signal: ctx.signal, runId: ctx.runId });
        let out = '';
        if (res.stdout) out += `${res.stdout}\n`;
        if (res.stderr) out += `${res.stderr}\n`;
        out += `exit_code: ${res.exitCode}${res.timedOut ? ' (timed out)' : ''}`;
        if (res.exitCode === 0) out = `安装成功，可在 run_python 中 import。\n` + out;
        return out.trim();
      },
    },
    {
      name: 'run_python',
      mode: 'sandbox',
      isEnabledFor: (profile) => profile.features.sandbox,
      definition: {
        type: 'function',
        function: {
          name: 'run_python',
          description:
            '在隔离的云端沙箱里执行 Python 3.12 代码（无网络），返回 stdout/stderr。' +
            '执行前把本会话工作区同步进 /workspace（当前目录），执行后新增/修改的文件自动回写工作区——可直接读写已有文件。' +
            '\n⚠️ 文件只有保存在工作区里才会被保留：用**相对路径**（即当前目录 /workspace，等价 /mnt/data）保存产物。' +
            '不要写到 /tmp、HOME(~/...) 或其他绝对路径——那些目录不会回流，文件会丢失。' +
            '\n沙箱是纯 Python（没有 node / pandoc / libreoffice），生成文档请直接用预装库：' +
            'Word→python-docx，Excel→openpyxl/XlsxWriter，PPT→python-pptx，PDF→reportlab/pypdf/pdfplumber，' +
            '数据→pandas/numpy，绘图→matplotlib，图片→Pillow。' +
            '若 import 报 ModuleNotFoundError，先调用 pip_install 安装缺失的包再重试。',
          parameters: {
            type: 'object',
            properties: { code: { type: 'string', description: '要执行的 Python 代码' } },
            required: ['code'],
          },
        },
      },
      execute: async (args, ctx) => {
        const code = String(args.code ?? '');
        // 会话级持久 kernel：import/变量跨调用保留；工作区已 hydrate 在本地，run 末统一 snapshot。
        const res = await runPythonInSession(ctx, code, { signal: ctx.signal, runId: ctx.runId });
        let out = '';
        if (res.stdout) out += `stdout:\n${res.stdout}\n`;
        if (res.stderr) out += `stderr:\n${res.stderr}\n`;
        out += `exit_code: ${res.exitCode}${res.timedOut ? ' (timed out)' : ''}${res.aborted ? ' (aborted)' : ''}`;
        out = out.trim() || '(no output)';
        // 超大输出（dump 大表/长日志）落盘到工作区，上下文只回预览+路径；exit_code 在末行→预览尾部必含。
        return formatToolOutput(ctx, 'run_python', out);
      },
    },
  ],
};
