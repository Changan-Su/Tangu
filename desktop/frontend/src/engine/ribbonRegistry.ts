/** Ribbon 注册表(≈ Obsidian addRibbonIcon)。zustand store,Ribbon 组件订阅。 */
import { create } from 'zustand'
import type { RibbonItem } from './types'

interface RibbonState {
  items: RibbonItem[]
  addRibbonIcon(item: RibbonItem): void
  removeRibbonIcon(id: string): void
}

export const useRibbonStore = create<RibbonState>((set) => ({
  items: [],
  addRibbonIcon: (item) =>
    set((s) => ({ items: [...s.items.filter((i) => i.id !== item.id), item] })),
  removeRibbonIcon: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}))

export const addRibbonIcon = (item: RibbonItem): void => useRibbonStore.getState().addRibbonIcon(item)
export const removeRibbonIcon = (id: string): void => useRibbonStore.getState().removeRibbonIcon(id)
