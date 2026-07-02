// Amadeus Space 的壳级 UI 状态:全局浮层(快速切换/模板选择)+ 编辑器模式。
// 编辑器模式原是 AmadeusEditorView 的组件内 state,上提到 store 供命令面板切换。
import { create } from 'zustand'

/** 模板插入上下文:插到哪个块之后;光标块为空则首个模板块直接填入它。 */
export interface TemplateCtx { afterId: string; emptyBlock: boolean }

interface UiOverlayState {
  overlay: 'switcher' | 'template' | null
  templateCtx: TemplateCtx | null
  editorMode: 'wysiwyg' | 'source'
  open(o: 'switcher'): void
  openTemplate(ctx: TemplateCtx): void
  close(): void
  toggleEditorMode(): void
}

export const useUiOverlay = create<UiOverlayState>((set) => ({
  overlay: null,
  templateCtx: null,
  editorMode: 'wysiwyg',
  open: (o) => set({ overlay: o, templateCtx: null }),
  openTemplate: (ctx) => set({ overlay: 'template', templateCtx: ctx }),
  close: () => set({ overlay: null, templateCtx: null }),
  toggleEditorMode: () => set((s) => ({ editorMode: s.editorMode === 'source' ? 'wysiwyg' : 'source' })),
}))
