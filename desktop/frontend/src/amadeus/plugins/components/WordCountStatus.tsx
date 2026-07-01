// Status-bar item contributed by the built-in "word-count" plugin: live character count
// of the active page.

import { useMemo } from 'react'
import { usePageStore } from '../../store/pageStore'

export function WordCountStatus() {
  const activePage = usePageStore((s) => s.activePage)
  const blocks = usePageStore((s) => s.blocks)

  const chars = useMemo(() => {
    const text = Object.values(blocks)
      .map((b) => b.content)
      .join(' ')
    return text.replace(/\s/g, '').length
  }, [blocks])

  if (!activePage) return null
  return <span className="status-item">{chars} 字</span>
}
