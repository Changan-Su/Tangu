/**
 * 技能工具:use_skill + 云端文档技能速查表(从 registry.ts 原样搬移)。
 * use_skill 的「无启用技能时不暴露给 LLM」过滤仍在 registry.getToolDefinitions(语义:
 * 不暴露但可执行,返回 session 级提示),不放 isEnabledFor(后者会让 executeTool 也查不到)。
 */
import { deps } from '../../seams/runtime.js';
import type { ToolProvider } from '../toolRegistry.js';

const getSkill = (id: string) => deps().brain.assets.getSkill(id);

const USE_SKILL_MAX_CHARS = 120_000;

// 云端纯 Python 沙箱的文档技能「精简速查表」：覆盖 docx/xlsx/pptx/pdf。
// 这些技能的官方正文是给 docx-js/pandoc/OOXML 写的（10万+字），会把模型带成生成超长 verbose 代码、
// 每步 8000+ token、几分钟。这里改喂极简 python 库用法，生成量降一个数量级。按技能 name 匹配。
const CLOUD_SKILL_CHEATSHEETS: Array<{ test: RegExp; title: string; body: string }> = [
  {
    test: /docx|word/i,
    title: 'docx（用 python-docx，云端 Python 沙箱）',
    body: [
      '直接用 python-docx 一步写出 .docx 并 save 到当前目录（会回流工作区）。',
      '不要手搓 OOXML/XML、不要 docx-js/pandoc、不要先写中间文件再转换。',
      '',
      'from docx import Document',
      'from docx.shared import Pt, Inches',
      'doc = Document()',
      "doc.add_heading('标题', level=0)",
      "doc.add_heading('一级标题', level=1)",
      "doc.add_paragraph('正文段落。')",
      "r = doc.add_paragraph().add_run('加粗'); r.bold = True",
      "doc.add_paragraph('项目一', style='List Bullet')",
      "t = doc.add_table(rows=2, cols=3); t.style = 'Table Grid'; t.cell(0,0).text = '表头'",
      "# doc.add_picture('img.png', width=Inches(4)); doc.add_page_break()",
      "doc.save('output.docx')",
      '',
      '按用户要求的篇幅产出，不要无谓加长；一个 run_python 写完整脚本。',
    ].join('\n'),
  },
  {
    test: /xlsx|excel|spreadsheet/i,
    title: 'xlsx（用 openpyxl，云端 Python 沙箱）',
    body: [
      '直接用 openpyxl 写 .xlsx（大数据可用 pandas df.to_excel）。',
      '',
      'from openpyxl import Workbook',
      'from openpyxl.styles import Font',
      "wb = Workbook(); ws = wb.active; ws.title = 'Sheet1'",
      "ws.append(['姓名', '分数']); ws['A1'].font = Font(bold=True)",
      "ws.append(['张三', 95]); ws.column_dimensions['A'].width = 20",
      "wb.save('output.xlsx')",
    ].join('\n'),
  },
  {
    test: /pptx|powerpoint|presentation|ppt/i,
    title: 'pptx（用 python-pptx，云端 Python 沙箱）',
    body: [
      '直接用 python-pptx 写 .pptx。',
      '',
      'from pptx import Presentation',
      'prs = Presentation()',
      's = prs.slides.add_slide(prs.slide_layouts[0])',
      "s.shapes.title.text = '标题'; s.placeholders[1].text = '副标题'",
      's2 = prs.slides.add_slide(prs.slide_layouts[1])',
      "s2.shapes.title.text = '要点'; s2.placeholders[1].text = '第一点\\n第二点'",
      "prs.save('output.pptx')",
    ].join('\n'),
  },
  {
    test: /\bpdf\b/i,
    title: 'pdf（用 reportlab，云端 Python 沙箱）',
    body: [
      '直接用 reportlab 写 .pdf（中文用自带 CID 字体 STSong-Light）。',
      '',
      'from reportlab.lib.pagesizes import A4',
      'from reportlab.lib.styles import getSampleStyleSheet',
      'from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer',
      'from reportlab.pdfbase import pdfmetrics',
      'from reportlab.pdfbase.cidfonts import UnicodeCIDFont',
      "pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))",
      'ss = getSampleStyleSheet()',
      "for n in ('Normal','Title','Heading1'): ss[n].fontName = 'STSong-Light'",
      "doc = SimpleDocTemplate('output.pdf', pagesize=A4)",
      "doc.build([Paragraph('标题', ss['Title']), Spacer(1, 12), Paragraph('正文内容。', ss['Normal'])])",
    ].join('\n'),
  },
];

export const skillsProvider: ToolProvider = {
  id: 'builtin:skills',
  tools: () => [
    {
      name: 'use_skill',
      definition: {
        type: 'function',
        function: {
          name: 'use_skill',
          description:
            '按需加载某个可用技能的完整说明书（SKILL.md）。当任务匹配 system prompt 列出的某技能时，' +
            '先用它的 id 调用本工具拿到完整指令，再据此执行。',
          parameters: {
            type: 'object',
            properties: { skill_id: { type: 'string', description: '技能 id（见 Available Skills 列表）' } },
            required: ['skill_id'],
          },
        },
      },
      execute: async (args, ctx) => {
        const id = String(args.skill_id ?? '').trim();
        if (!id) return 'Error: skill_id is required';
        if (!ctx.enabledSkillIds || !ctx.enabledSkillIds.includes(id)) {
          return `Skill "${id}" is not available in this session.`;
        }
        const s = await getSkill(id);
        if (!s) return `Skill "${id}" not found.`;
        // 文档类技能：云端 Python 沙箱用精简 python 库速查表替代官方 docx-js/OOXML 长正文（生成量降一个数量级）。
        const cheat = CLOUD_SKILL_CHEATSHEETS.find((c) => c.test.test(String(s.name || '')));
        if (cheat) return `# Skill: ${cheat.title}\n\n${cheat.body}`;
        const body = (s.content && String(s.content).trim()) || (s.description && String(s.description).trim()) || '';
        if (!body) return `Skill "${s.name}" has no instructions.`;
        const head = `# Skill: ${s.name}\n\n`;
        return head + body.slice(0, USE_SKILL_MAX_CHARS) + (body.length > USE_SKILL_MAX_CHARS ? '\n\n…(truncated)' : '');
      },
    },
  ],
};
