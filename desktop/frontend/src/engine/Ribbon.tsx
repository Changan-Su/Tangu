/** Ribbon 竖条(≈ Obsidian ribbon):固定在 Dockview 之外的最左侧,订阅 ribbonRegistry。 */
import { useRibbonStore } from './ribbonRegistry'
import { label } from './types'

export function Ribbon() {
  const items = useRibbonStore((s) => s.items)
  const top = items.filter((i) => (i.side ?? 'top') === 'top')
  const bottom = items.filter((i) => i.side === 'bottom')
  return (
    <div className="rb">
      <div className="rb-group rb-top">
        {top.map((i) => {
          const Icon = i.icon
          return (
            <button key={i.id} className="rb-btn" title={label(i.tooltip)} onClick={i.onClick}>
              <Icon size={18} />
            </button>
          )
        })}
      </div>
      <div className="rb-group rb-bottom">
        {bottom.map((i) => {
          const Icon = i.icon
          return (
            <button key={i.id} className="rb-btn" title={label(i.tooltip)} onClick={i.onClick}>
              <Icon size={18} />
            </button>
          )
        })}
      </div>
    </div>
  )
}
