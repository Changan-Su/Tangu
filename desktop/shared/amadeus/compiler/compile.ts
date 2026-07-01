// compile(): in-memory manifest + per-block content -> the portable note file `abc.md`.
// Frontmatter carries the note id + the 2D layout (compact JSON). The body is plain,
// readable markdown: each block opens with a `<!-- a <id> -->` marker (invisible in
// Obsidian) followed by its content, in reading order. Content is written exactly once.

import { serializeLayout } from './manifest'
import { blockMarker } from './markers'
import type { BlockId, PageManifest } from './types'

function frontmatter(m: PageManifest): string {
  return [
    '---',
    `amadeus_page: ${m.id}`,
    `amadeus_schema: ${m.schema}`,
    `amadeus_layout: ${serializeLayout(m.root)}`,
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
