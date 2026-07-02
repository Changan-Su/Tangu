// compile(): in-memory manifest + per-block content -> the portable note file `abc.md`.
// Frontmatter carries the note id + the 2D layout (compact JSON). The body is plain,
// readable markdown: each block opens with a `<!-- a <id> -->` marker (invisible in
// Obsidian) followed by its content, in reading order. Content is written exactly once.

import { serializeLayout } from './manifest'
import { blockMarker } from './markers'
import { AMADEUS_FM_KEY } from './split'
import type { BlockId, PageManifest } from './types'

function frontmatter(m: PageManifest): string {
  // 外来 frontmatter(Obsidian properties 等)原文回写——丢弃即数据损失。
  // 在写盘咽喉过滤保留键与裸 '---' 行:属性面板原文模式等任何写入方都可能夹带,
  // 一旦落盘会劫持 amadeus_page/提早闭合 frontmatter,直接破坏文件结构。
  const extra = (m.fmExtra ?? '')
    .split('\n')
    .filter((l) => !AMADEUS_FM_KEY.test(l) && !/^---\s*$/.test(l))
    .join('\n')
    .replace(/^\n+|\n+$/g, '')
  return [
    '---',
    `amadeus_page: ${m.id}`,
    `amadeus_schema: ${m.schema}`,
    `amadeus_layout: ${serializeLayout(m.root)}`,
    ...(extra ? [extra] : []),
    '---',
  ].join('\n')
}

export function compile(manifest: PageManifest, contents: Record<BlockId, string>): string {
  const segments: string[] = [frontmatter(manifest)]
  for (const row of manifest.root.children) {
    for (const col of row.columns) {
      for (const ref of col.children) {
        const content = (contents[ref.ref] ?? '').trim()
        segments.push(content ? `${blockMarker(ref.ref)}\n\n${content}` : blockMarker(ref.ref))
      }
    }
  }
  return segments.join('\n\n') + '\n'
}
