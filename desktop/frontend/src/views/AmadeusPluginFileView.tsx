/** 通用「插件文件类型」视图:树上点某个插件声明的文件(如 `.mindmap.md`)在应用内打开。
 *  一个引擎视图类型(amadeus-plugin-file)服务所有插件文件类型 —— 挂载时按 params.filePath 反查已
 *  注册的 FileTypeContribution,调它的 mount(el, { filePath }) 把编辑器画进容器。插件晚于 boot 加载
 *  也没关系(挂载/重渲即查表;fileTypes 变化会触发重挂)。与 AmadeusDrawingView 同一套契约域包裹。 */
import { useEffect, useRef } from 'react'
import type { ViewProps } from '@lcl/engine'
import { useTheme } from '../stores/themeStore'
import { usePageStore } from '../amadeus/store/pageStore'
import { usePluginStore, findFileType, fileTypeBaseName } from '../amadeus/plugins/pluginStore'

export function AmadeusPluginFileView({ leaf }: ViewProps) {
  const filePath = typeof leaf.params.filePath === 'string' ? leaf.params.filePath : ''
  const mode = useTheme((s) => s.mode)
  const flat = useTheme((s) => s.flat)
  // 订阅 fileTypes:插件加载后新注册的类型会触发重渲染 → 从「无人能开」变为正常挂载。
  const fileTypes = usePluginStore((s) => s.fileTypes)
  const ft = findFileType(fileTypes, filePath) // 引用稳定(=注册时存入的同一对象),effect 不会空转
  // 订阅 vaultRoot:切库(filePath 是 vault 相对路径,换库后同名会指向另一个库)或库首次就绪时重挂 →
  // 插件按新库重读(不存在则显示错误态,不会用旧内容写坏新库);也自愈「库未就绪时先挂 → 读到 null」的启动态(Codex #1)。
  const vaultRoot = usePageStore((s) => s.vaultRoot)
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (filePath && ft) leaf.setTitle(fileTypeBaseName(filePath, ft.extensions) || ft.title || filePath)
  }, [filePath, ft]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = hostRef.current
    if (!el || !filePath || !ft) return
    el.textContent = ''
    let cleanup: (() => void) | void
    try {
      cleanup = ft.mount(el, { filePath })
    } catch (e) {
      console.error('[amadeus] 插件文件视图挂载失败', e)
    }
    return () => {
      try {
        cleanup?.()
      } catch {
        /* ignore */
      }
    }
  }, [filePath, ft, vaultRoot])

  if (!filePath) return <div className="amx-draw-state">未指定文件。</div>
  if (!ft) return <div className="amx-draw-state">没有已启用的插件能打开「{filePath}」。</div>
  return (
    <div
      className="am-app tangu-lovable amx-pane amx-pluginfile"
      data-mode={mode}
      data-flat={flat ? '1' : '0'}
      ref={hostRef}
    />
  )
}
