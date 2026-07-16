/**
 * 侧栏分区的折叠态记忆(用户拍板:除「树所在的那个分区」外一律默认折叠,并记住之后的手动开合)。
 *
 * 存 localStorage —— 折叠态是纯本地观感偏好,不该进 vault 文件、更不该跟着云同步跑到别的设备。
 */
import { useState } from 'react'

const KEY = 'amx.sec.'

/**
 * 存的值 → 是否展开。
 * ⚠️ **「没存过」必须回落到 defaultOpen,不能当 false** —— 否则首次打开时 Vault 分区也会被折叠,
 * 侧栏一片空白(用户要的恰恰是「除 Vault 外都折叠」)。坏值同样回落,不当 false。
 */
export function sectionOpenFrom(stored: string | null, defaultOpen: boolean): boolean {
  return stored === '1' ? true : stored === '0' ? false : defaultOpen
}

/** 分区折叠态 + 持久化。id 要稳定(vault 分区用库名 → 每库各记各的)。 */
export function useSectionOpen(id: string, defaultOpen = false): [boolean, () => void] {
  const [open, setOpen] = useState(() => {
    try { return sectionOpenFrom(localStorage.getItem(KEY + id), defaultOpen) } catch { return defaultOpen }
  })
  const toggle = (): void => setOpen((o) => {
    const next = !o
    try { localStorage.setItem(KEY + id, next ? '1' : '0') } catch { /* 隐私模式/配额满:记不住也别崩 */ }
    return next
  })
  return [open, toggle]
}
