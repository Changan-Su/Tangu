/**
 * Markdown 渲染(react-markdown + GFM + highlight.js;代码块带复制按钮)。
 * 高亮配色在 base.css 用主题 token 写(.hljs-*),不引第三方主题 CSS。
 */
import React, { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Copy, Check } from 'lucide-react'

const CodeBlock: React.FC<React.HTMLAttributes<HTMLPreElement>> = ({ children, ...props }) => {
  const [copied, setCopied] = useState(false)
  const preRef = React.useRef<HTMLPreElement>(null)
  const copy = () => {
    const text = preRef.current?.innerText ?? ''
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div style={{ position: 'relative' }}>
      <pre ref={preRef} {...props}>{children}</pre>
      <button
        className="icon-btn"
        onClick={copy}
        title="复制代码"
        style={{ position: 'absolute', top: 6, right: 6, width: 24, height: 24 }}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  )
}

export const Markdown: React.FC<{ content: string }> = React.memo(({ content }) => (
  <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    rehypePlugins={[[rehypeHighlight, { ignoreMissing: true, detect: false }]]}
    components={{ pre: CodeBlock }}
  >
    {content}
  </ReactMarkdown>
))
