/** Obsidian Excalidraw 插件(zsviczian)的 `.excalidraw.md` 磁盘格式。
 *
 *  一个 `.excalidraw.md` = frontmatter + 若干可选数据段(`# Excalidraw Data` / `## Text Elements` /
 *  `## Element Links` / `## Embedded Files`)+ `## Drawing` 段里的场景 JSON,整块用 `%%` 注释掉。
 *  本模块**只认、只换 Drawing 段**,其余字节原样保留 —— 那些是插件侧的载荷(元素链接、嵌入文件映射),
 *  我们没建模,更不能抹掉:抹了 = 在 Obsidian 那边毁档。
 *
 *  纯字符串进出,不引 @excalidraw/excalidraw(场景的序列化由渲染端的 serializeAsJSON 负责)
 *  → 主进程与 node 单测都能直接用。
 *  常量/正则照插件 v2.25.3 源码转写:src/shared/ExcalidrawData.ts、src/utils/sceneDataUtils.ts、
 *  src/constants/constants.ts。 */
import { compressToBase64, decompressFromBase64 } from 'lz-string'

/** 插件认画板靠的是 **frontmatter 的 `excalidraw-plugin` 键**,文件名里的 `.excalidraw` 只是默认惯例
 *  (设置项 useExcalidrawExtension,默认开)。
 *  ponytail: 这里按文件名判 —— listPages 必须在「不读文件内容」的前提下把画板挡在笔记之外,按 frontmatter
 *  判就得把全库每个 .md 都读一遍。上限:关掉那个设置后存成的 `Foo.md` 画板会被当普通笔记;
 *  真有人这么用,再改成读 frontmatter(届时 listPages 需要一层缓存)。 */
export function isDrawingPath(p: string): boolean {
  return /\.excalidraw(\.md)?$/i.test(p)
}

// 定位正则照抄插件(ExcalidrawData.ts:197-208),连它踩过的坑一起继承:
// - `##? Drawing`:读侧一级/二级标题都认,写侧恒二级。
// - 标题前必须有 `\n` → 画板段不能落在文件第 0 字节。
// - 闭合围栏后的 `\n` 是必需的:少了它,插件会掉进自己的 fallback 正则(`(.*)` 无 s 标志)把 JSON 截断
//   —— 那正是它 issue #357。我们照要求写,也照要求认。
// 三段捕获 = 前缀 / 载荷 / 闭合围栏,换载荷时前后原样拼回。
// 刻意不带 g:带 g 的正则有 lastIndex 状态,模块级复用即错。
const DRAWING_RE = /(\n##? Drawing\n[^`]*```json\n)([\s\S]*?)(```\n)/
const DRAWING_COMPRESSED_RE = /(\n##? Drawing\n[^`]*```compressed-json\n)([\s\S]*?)(```\n)/
/** 与插件 isCompressedMD 同款:全文扫这个字面量(它的误判风险 —— 正文里出现这串即全文按压缩解 —— 一并继承)。 */
const COMPRESSED_MARK = /```compressed-json\n/

export interface ParsedDrawing {
  /** `## Drawing` 段里的场景 JSON 原文(压缩态已解开)。 */
  sceneJson: string
  /** 读到的是压缩态。写回时跟随它:插件默认 compress:true,会把未压缩文件在首次打开时转成压缩,
   *  跟随 = 同一个文件在两边来回编辑不会互相改写形态、不产生无谓 diff。 */
  compressed: boolean
}

/** 解出场景 JSON;不是画板 / Drawing 段缺失 / 解压失败 → null(拿不准就不认,绝不猜)。 */
export function parseDrawing(source: string): ParsedDrawing | null {
  const compressed = COMPRESSED_MARK.test(source)
  const m = (compressed ? DRAWING_COMPRESSED_RE : DRAWING_RE).exec(source)
  if (!m) return null
  const raw = compressed ? decompressFromBase64(stripNewlines(m[2])) : m[2]
  if (!raw) return null // lz-string 对坏载荷回 null/''
  // 照插件:截到最后一个 '}' —— 围栏尾部的换行/解压残余都不进 JSON.parse。
  const end = raw.lastIndexOf('}')
  return end === -1 ? null : { sceneJson: raw.slice(0, end + 1), compressed }
}

/** 用新场景 JSON 换掉 Drawing 段的载荷,其余字节原样。
 *  源里定位不到 Drawing 段 → null:调用方据此拒写,绝不把一个不认识的文件覆盖成画板。 */
export function withSceneJson(source: string, sceneJson: string): string | null {
  const compressed = COMPRESSED_MARK.test(source)
  const m = (compressed ? DRAWING_COMPRESSED_RE : DRAWING_RE).exec(source)
  if (!m) return null
  const payload = compressed ? compress(sceneJson) : sceneJson
  // m[2] 含围栏前的那个换行(`([\s\S]*?)` 吃到 '```\n' 之前),故写回要补回来。
  return source.slice(0, m.index) + m[1] + payload + '\n' + m[3] + source.slice(m.index + m[0].length)
}

/** 新建模板,逐字节照搬插件(constants.ts:463-473 的 FRONTMATTER + FileManager.ts:186 的拼装)。
 *  `excalidraw-plugin: parsed` 是插件认画板的唯一依据,不能省;警告行是给「在 Obsidian 里按纯文本
 *  打开」的人看的,照留(改了只会让两边的文件长得不一样)。 */
const FRONTMATTER = [
  '---',
  '',
  'excalidraw-plugin: parsed',
  'tags: [excalidraw]',
  '',
  '---',
  "==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠== You can decompress Drawing data with the command palette: 'Decompress current Excalidraw file'. For more info check in plugin settings under 'Saving'",
  '',
  '',
].join('\n')

/** 新画板文件。写未压缩:纯 JSON 可 diff/可 grep,新文件没有「既有形态」可跟随。
 *  插件默认 compress:true → 首次在 Obsidian 里打开会被它转成 compressed-json;无所谓,读侧两种都认,
 *  之后 parseDrawing 会把 compressed 标志带出来,写回就跟着走了。 */
export function blankDrawing(sceneJson: string): string {
  return `${FRONTMATTER}\n## Drawing\n\`\`\`json\n${sceneJson}\n\`\`\`\n%%`
}

/** 空场景,照插件的 BLANK_DRAWING(constants.ts:460)。
 *  刻意手写而不引 @excalidraw/excalidraw:新建画板走的是 slash 菜单那条路,那条路径不该把 1MB 的
 *  画布包拽进主 chunk。白底是插件同款缺省,暗色由 <Excalidraw theme="dark"> 自己反相。 */
export const BLANK_SCENE_JSON =
  '{"type":"excalidraw","version":2,"source":"Forsion Amadeus","elements":[],"appState":{"gridSize":null,"viewBackgroundColor":"#ffffff"}}'

/** 与插件 sceneDataUtils.ts:117-127 同款。分块纯属美观(免得 Obsidian 编辑器里出现一行几十 KB),
 *  解压侧本就先剥换行、不分块也能读 —— 但按它的 256 + 空行分,同一文件在两边来回存才不产生假 diff。 */
function compress(data: string): string {
  const b64 = compressToBase64(data)
  let out = ''
  for (let i = 0; i < b64.length; i += 256) out += `${b64.slice(i, i + 256)}\n\n`
  return out.trim()
}

const stripNewlines = (s: string): string => s.replace(/[\n\r]/g, '')
