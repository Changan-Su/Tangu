/** 「最近打开的页面」提供者接缝:vendored 代码(@ 提及排序)不 import 宿主层,
 *  由宿主(桌面 amadeusPrefs / 独立版自己的实现)注入;未注入时优雅退化为空。 */
let provider: (() => string[]) | null = null

export function setRecentsProvider(fn: () => string[]): void {
  provider = fn
}

/** 最近打开的页面路径,最新在前;无提供者时为 []。 */
export function getRecentPages(): string[] {
  try {
    return provider?.() ?? []
  } catch {
    return []
  }
}
