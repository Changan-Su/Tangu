/** 待办清单时间窗:以今天为中心、前后对称的闭区间(用户拍板方向)。纯函数,便于单测。 */
import { addDays, startOfDay } from './dateUtils'

export type TodoWindow = 'day' | '3day' | 'week' | 'month' | 'custom'
export const WINDOW_DAYS: Record<Exclude<TodoWindow, 'custom'>, number> = { day: 1, '3day': 3, week: 7, month: 31 }

/** 该窗口总天数(自定义取输入,至少 1)。 */
export function windowTotal(win: TodoWindow, customDays: number): number {
  return win === 'custom' ? Math.max(1, Math.floor(customDays)) : WINDOW_DAYS[win]
}

/** 以 today 为中心、共 totalDays 天的闭区间(前后对称;偶数时后侧多一天)。 */
export function centeredRange(totalDays: number, today: Date): { start: Date; end: Date } {
  const n = Math.max(1, Math.floor(totalDays))
  const before = Math.floor((n - 1) / 2)
  return { start: startOfDay(addDays(today, -before)), end: startOfDay(addDays(today, n - 1 - before)) }
}
