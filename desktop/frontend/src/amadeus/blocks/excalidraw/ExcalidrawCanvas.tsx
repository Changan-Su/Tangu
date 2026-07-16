/** 真画布。这里是**唯一**静态 import @excalidraw/excalidraw 的地方(整包 ~1MB + 它的 CSS),
 *  由 ExcalidrawEmbed 经 React.lazy 隔成独立 chunk —— 不含画板的笔记一个字节都不加载。
 *  语言包是包内动态 import('./locales/*.js'),vite 自会分块,无需自托管(字体才需要,见 ExcalidrawEmbed)。
 *  远端合并(reconcile+restoreElements+updateScene)也必须留在本 chunk 内 —— drawingStore 在启动
 *  bundle 里,绝不能 import 这个包;它只经 registerApplier 拿到一个闭包。 */
import { Excalidraw, serializeAsJSON, restoreElements, CaptureUpdateAction } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import { useEffect, useState } from 'react'
import type { ExcalidrawInitialDataState, ExcalidrawImperativeAPI, BinaryFileData } from '@excalidraw/excalidraw/types'
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import { reconcileElements, sameElements, type SceneElement, type SceneLike } from '@amadeus-shared/excalidraw/reconcile'

export default function ExcalidrawCanvas({
  initialData,
  theme,
  langCode,
  onSceneChange,
  registerApplier,
}: {
  initialData: ExcalidrawInitialDataState
  theme: 'light' | 'dark'
  langCode: string
  onSceneChange: (sceneJson: string) => void
  /** drawingStore 的远端应用器挂钩:外部变更(watcher/SSE)到达时把远端场景元素级合并进活画布。 */
  registerApplier?: (fn: (remote: SceneLike) => void) => () => void
}): React.JSX.Element {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)
  useEffect(() => {
    if (!api || !registerApplier) return
    return registerApplier((remote) => {
      const live = api.getSceneElementsIncludingDeleted() as unknown as SceneElement[]
      const merged = reconcileElements(live, remote.elements ?? [])
      if (sameElements(merged, live)) return // 已收敛:零动作,斩断「合并→onChange→写盘→回声」链
      api.updateScene({
        elements: restoreElements(merged as unknown as OrderedExcalidrawElement[], null),
        captureUpdate: CaptureUpdateAction.NEVER, // 远端笔画不进本端 undo 栈
      })
      const files = Object.values(remote.files ?? {})
      if (files.length) api.addFiles(files as BinaryFileData[])
    })
  }, [api, registerApplier])
  return (
    <Excalidraw
      excalidrawAPI={setApi}
      initialData={initialData}
      theme={theme}
      langCode={langCode}
      // serializeAsJSON 出的正是 .excalidraw 的规范形状({type,version,source,elements,appState,files}),
      // 且自带 appState 裁剪(去掉 collaborators/选中态等瞬时字段)—— 别自己拼,拼不全也裁不干净。
      onChange={(elements, appState, files) => onSceneChange(serializeAsJSON(elements, appState, files, 'local'))}
    />
  )
}
