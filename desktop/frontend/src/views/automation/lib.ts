/** 「自动化」Space 三个 view 共用的小工具(文案拼装;t 由调用方传入)。 */
import type { MuseTriggerInfo, NormalAgentDef } from '../../types'

type T = (key: string, vars?: Record<string, string>) => string

/** 触发条件的人话摘要。 */
export function condText(t: T, cond: MuseTriggerInfo['cond']): string {
  if (cond.type === 'daily_at') return t('automation.cond.daily', { time: cond.time })
  if (cond.type === 'event_seen') return t('automation.cond.event', { match: cond.match })
  return t('automation.cond.file', { path: shortPath(cond.path), n: String(cond.n) })
}

/** 路径尾部截断(列表摘要用)。 */
export function shortPath(p: string): string {
  return p.length > 36 ? `…${p.slice(-35)}` : p
}

/** 执行者显示名:agentSlug 缺省=Muse(品牌名不进 i18n);有 slug 找 defs 显示名,找不到回落 slug。 */
export function runnerName(defs: NormalAgentDef[], agentSlug?: string): string {
  if (!agentSlug) return 'Muse'
  return defs.find((d) => d.slug === agentSlug)?.name || agentSlug
}

/** ISO/epoch → 本地短时间。 */
export function fmtTime(v: string | number | null | undefined): string {
  if (!v) return '—'
  const d = new Date(v)
  if (isNaN(d.getTime())) return '—'
  const p = (x: number): string => String(x).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
}
