/** 命令式文本输入:`await askString('新建文件夹', '新文件夹')` → 弹 PromptDialog,
 *  确定回 trim 后的值、取消/Esc 回 null。Electron 不支持 window.prompt(调用即失败),
 *  所有原 prompt 调用点一律换用本入口;Host 挂在 AmadeusOverlays(三端共用)。 */
import { create } from 'zustand'
import { PromptDialog } from './Dialogs'

interface Req {
  title: string
  label?: string
  initial: string
  confirmLabel?: string
  resolve: (v: string | null) => void
}

const usePromptStore = create<{ req: Req | null; open(r: Req): void; clear(): void }>((set) => ({
  req: null,
  open: (req) => set({ req }),
  clear: () => set({ req: null }),
}))

export function askString(title: string, initial = '', opts?: { label?: string; confirmLabel?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    // 已有弹窗未决:先取消旧的(单例;嵌套询问不是我们的形态)
    usePromptStore.getState().req?.resolve(null)
    usePromptStore.getState().open({ title, initial, label: opts?.label, confirmLabel: opts?.confirmLabel, resolve })
  })
}

/** 挂载一次(AmadeusOverlays);.am-app 载体让 .dialog-* 样式命中。 */
export function AskStringHost() {
  const req = usePromptStore((s) => s.req)
  if (!req) return null
  const settle = (v: string | null): void => {
    if (usePromptStore.getState().req !== req) return // 已决(confirm 先到,close 随后)不再二次 resolve
    usePromptStore.getState().clear()
    req.resolve(v)
  }
  return (
    <div className="am-app" style={{ display: 'contents' }}>
      <PromptDialog
        title={req.title}
        label={req.label}
        initial={req.initial}
        confirmLabel={req.confirmLabel}
        onConfirm={(v) => settle(v)}
        onClose={() => settle(null)}
      />
    </div>
  )
}
