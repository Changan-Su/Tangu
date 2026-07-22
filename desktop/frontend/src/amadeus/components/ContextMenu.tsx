// A small right-click context menu positioned at the cursor. Closes on any outside
// click, another right-click, blur, or Escape.

import { useEffect } from 'react'
import { useClampedMenu } from '../lib/clampMenu'

export interface MenuItem {
  label: string
  onClick: () => void
  danger?: boolean
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}) {
  useEffect(() => {
    const close = (): void => onClose()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // 量真实尺寸后夹进视口(纵向溢出上移、横向溢出收进屏幕),取代硬编码宽高的估算。
  const { ref, style } = useClampedMenu(x, y, [items.length])

  return (
    <div
      ref={ref}
      className="ctx-menu"
      style={style}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      {items.map((it, i) => (
        <button
          key={i}
          className="ctx-item"
          data-danger={it.danger || undefined}
          onClick={() => {
            it.onClick()
            onClose()
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}
