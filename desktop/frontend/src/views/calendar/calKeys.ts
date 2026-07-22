/** Calendar 视图键盘映射(纯函数,便于单测):
 *  - D/W/3/M 切模式(Notion Calendar 式,原有);
 *  - ←/→ 翻上/下一周期(任务3,复用工具条 prev/next);
 *  - Cmd/Ctrl+C/V 复制/粘贴选中事件、Delete/Backspace 删除(任务2)。
 *  输入控件劫持排除留在调用方(依赖 DOM,这里只认键)。 */
import type { CalMode } from '../../amadeus/store/calendarNavStore'

export const MODE_ITEMS: Array<{ id: CalMode; label: string; key: string }> = [
  { id: 'day', label: '日', key: 'd' },
  { id: 'week', label: '周', key: 'w' },
  { id: '3day', label: '3 日', key: '3' },
  { id: 'month', label: '月', key: 'm' },
]

export type CalKeyAction =
  | { kind: 'copy' }
  | { kind: 'paste' }
  | { kind: 'delete' }
  | { kind: 'prev' }
  | { kind: 'next' }
  | { kind: 'mode'; mode: CalMode }

/** 只看按键 + 修饰键定动作;不认识的返回 null(调用方不 preventDefault)。 */
export function classifyCalKey(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): CalKeyAction | null {
  const mod = (e.metaKey || e.ctrlKey) && !e.altKey
  if (mod && (e.key === 'c' || e.key === 'C')) return { kind: 'copy' }
  if (mod && (e.key === 'v' || e.key === 'V')) return { kind: 'paste' }
  if (e.metaKey || e.ctrlKey || e.altKey) return null // 其它修饰组合不劫持(留给浏览器/系统)
  if (e.key === 'Delete' || e.key === 'Backspace') return { kind: 'delete' }
  if (e.key === 'ArrowLeft') return { kind: 'prev' }
  if (e.key === 'ArrowRight') return { kind: 'next' }
  const hit = MODE_ITEMS.find((m) => m.key === e.key.toLowerCase())
  return hit ? { kind: 'mode', mode: hit.id } : null
}
