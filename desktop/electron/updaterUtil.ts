/**
 * updater 的纯逻辑(无 electron / electron-updater 依赖,可在 node 下单测)。
 * updater.ts 引用这里;别在本文件 import electron,否则单测无法在非 Electron 环境加载。
 */

/** GitHub releaseNotes 可能是 string / Array<{ note }> / null → 归一为纯字符串(供 UI 展示)。 */
export function notesToString(notes: unknown): string | undefined {
  if (!notes) return undefined
  if (typeof notes === 'string') return notes || undefined
  if (Array.isArray(notes)) {
    const s = notes.map((n: any) => (n?.note ?? '')).filter(Boolean).join('\n\n')
    return s || undefined
  }
  return undefined
}

/**
 * "1.3.10" 比 "1.3.9" 新 → true(数字元组逐段比较,remote 比 current 新返回 true)。
 * ponytail: 纯 x.y.z 数字比对;出现 prerelease/build tag 再换 semver。
 */
export function isNewer(remote: string, current: string): boolean {
  const norm = (v: string): number[] => v.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0)
  const a = norm(remote)
  const b = norm(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0
    const y = b[i] || 0
    if (x !== y) return x > y
  }
  return false
}
