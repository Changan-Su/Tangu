// 聊天气泡里的单个 [[双链]]:解析(vault 绝对路径→相对;resolvePageName 全库匹配)→ 可点链接打开笔记。
// class/data-wiki 与编辑器同款 → 全局挂载的 WikiHoverPreview 悬停浮卡直接吃到,零接线。
import { useMemo } from 'react'
import { linkTarget, resolvePageName } from '@amadeus-shared/links'
import { usePageStore } from '../amadeus/store/pageStore'
import { splitWiki, wikiLabel } from './wikiChat'

export function ChatWikiLink({ inner }: { inner: string }) {
  const pages = usePageStore((s) => s.pages)
  const root = usePageStore((s) => s.vaultRoot)
  const label = wikiLabel(inner)
  const path = useMemo(() => {
    const target = linkTarget(inner)
    const rel = root && target.startsWith(root + '/') ? target.slice(root.length + 1) : target
    return resolvePageName(rel, pages)
  }, [inner, root, pages])
  if (!path) return <span className="wikilink wikilink-unresolved">{label}</span>
  return (
    <a
      className="wikilink"
      data-wiki={path}
      onClick={() => {
        void import('../amadeusNav').then((m) => m.openNote(path)) // 懒加载防 barrel 循环,web 侧同样可用
      }}
    >
      {label}
    </a>
  )
}

/** 用户气泡纯文本:[[..]] → 双链,其余原样(pre-wrap 换行不受影响)。 */
export function WikiText({ text }: { text: string }) {
  const pieces = splitWiki(text)
  if (pieces.length === 1 && !pieces[0].wiki) return <>{text}</>
  return <>{pieces.map((p, i) => (p.wiki ? <ChatWikiLink key={i} inner={p.wiki.inner} /> : p.text))}</>
}
