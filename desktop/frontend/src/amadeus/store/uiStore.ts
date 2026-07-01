// Cross-cutting UI state that several components (and plugins) need to drive: which
// overlay palette is open, and a transient toast. Kept separate from pageStore so
// plugin commands can open palettes / show toasts without reaching into page state.

import { create } from 'zustand'

export type Palette = 'switch' | 'search' | 'command' | 'settings' | null

interface UiState {
  palette: Palette
  setPalette(p: Palette): void
  toast: string | null
  notify(message: string): void
}

let toastTimer: ReturnType<typeof setTimeout> | null = null

export const useUiStore = create<UiState>((set) => ({
  palette: null,
  setPalette: (palette) => set({ palette }),
  toast: null,
  notify: (message) => {
    set({ toast: message })
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => set({ toast: null }), 2600)
  },
}))
