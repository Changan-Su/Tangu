import { describe, expect, it } from 'vitest'
import { compressToBase64 } from 'lz-string'
import { blankDrawing, isDrawingPath, parseDrawing, withSceneJson } from './format'

const SCENE = '{"type":"excalidraw","version":2,"source":"x","elements":[],"appState":{}}'
const SCENE2 = '{"type":"excalidraw","version":2,"source":"x","elements":[{"id":"a"}],"appState":{}}'

/** 插件存过一轮之后的完整形态:数据段俱全 + %% 注释包住。反斜杠围栏写成单引号串,免去转义。 */
const FULL = [
  '---',
  '',
  'excalidraw-plugin: parsed',
  'tags: [excalidraw]',
  '',
  '---',
  '==⚠  Switch to EXCALIDRAW VIEW ⚠==',
  '',
  '# Excalidraw Data',
  '',
  '## Text Elements',
  '你好 ^abc123',
  '',
  '## Element Links',
  'def456: [[某笔记]]',
  '',
  '%%',
  '## Drawing',
  '```json',
  SCENE,
  '```',
  '%%',
].join('\n')

describe('isDrawingPath', () => {
  it('认 .excalidraw.md 与裸 .excalidraw,不认普通笔记', () => {
    expect(isDrawingPath('画板.excalidraw.md')).toBe(true)
    expect(isDrawingPath('a/b/Drawing 2026.excalidraw')).toBe(true)
    expect(isDrawingPath('笔记.md')).toBe(false)
    expect(isDrawingPath('excalidraw.md')).toBe(false) // 「excalidraw」当笔记名,不是中缀
  })
})

describe('parseDrawing', () => {
  it('新建模板可被自己解回来(往返)', () => {
    const p = parseDrawing(blankDrawing(SCENE))
    expect(p).toEqual({ sceneJson: SCENE, compressed: false })
  })

  it('解完整形态(数据段/%% 都在)', () => {
    expect(parseDrawing(FULL)?.sceneJson).toBe(SCENE)
  })

  it('解压缩态,并带出 compressed 标志', () => {
    const src = FULL.replace('```json', '```compressed-json').replace(SCENE, compressToBase64(SCENE))
    expect(parseDrawing(src)).toEqual({ sceneJson: SCENE, compressed: true })
  })

  it('压缩载荷分块(插件按 256 字符 + 空行折行)也要能解', () => {
    const b64 = compressToBase64(SCENE)
    const chunked = `${b64.slice(0, 10)}\n\n${b64.slice(10)}`
    const src = FULL.replace('```json', '```compressed-json').replace(SCENE, chunked)
    expect(parseDrawing(src)?.sceneJson).toBe(SCENE)
  })

  it('一级标题 `# Drawing` 也认(插件读侧 ##? 都收)', () => {
    expect(parseDrawing(FULL.replace('## Drawing', '# Drawing'))?.sceneJson).toBe(SCENE)
  })

  it('不是画板 / 无 Drawing 段 → null', () => {
    expect(parseDrawing('# 普通笔记\n\n正文')).toBeNull()
  })

  it('闭合围栏后无换行 → 不认(插件同款硬要求,少了它那边会把 JSON 截断)', () => {
    expect(parseDrawing(FULL.replace('```\n%%', '```%%'))).toBeNull()
  })
})

describe('withSceneJson', () => {
  it('只换载荷:frontmatter/文本段/元素链接/%% 全部逐字节保留', () => {
    const out = withSceneJson(FULL, SCENE2)
    expect(out).toBe(FULL.replace(SCENE, SCENE2))
    // 插件侧的载荷必须原样活着 —— 抹了就是在 Obsidian 那边毁档
    expect(out).toContain('你好 ^abc123')
    expect(out).toContain('def456: [[某笔记]]')
  })

  it('压缩态写回仍是压缩态(跟随文件既有形态,不来回改写)', () => {
    const src = FULL.replace('```json', '```compressed-json').replace(SCENE, compressToBase64(SCENE))
    const out = withSceneJson(src, SCENE2)
    expect(out).toContain('```compressed-json')
    expect(out).not.toContain(SCENE2) // 落盘的是压缩后的,不是明文
    expect(parseDrawing(out!)).toEqual({ sceneJson: SCENE2, compressed: true })
  })

  it('换完还能解回来(往返),且新模板同样可换', () => {
    expect(parseDrawing(withSceneJson(blankDrawing(SCENE), SCENE2)!)?.sceneJson).toBe(SCENE2)
  })

  it('定位不到 Drawing 段 → null(拒写,绝不把陌生文件覆盖成画板)', () => {
    expect(withSceneJson('# 普通笔记\n\n正文', SCENE)).toBeNull()
  })
})
