// 附件存放偏好(Tangu 设置 → 笔记):粘贴与拖入统一从这里取,别再各自读 config。
import type { AttachmentOpts } from '@amadeus-shared/ipc'

export async function getAttachmentPrefs(): Promise<{ opts: AttachmentOpts; preview: boolean }> {
  const cfg = await window.tangu?.getConfig?.().catch(() => null)
  return {
    opts: { mode: cfg?.notesAttachmentMode ?? 'attachments', folder: cfg?.notesAttachmentFolder ?? 'assets' },
    preview: cfg?.notesImportPreview !== false,
  }
}
