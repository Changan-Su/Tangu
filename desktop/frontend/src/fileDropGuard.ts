/**
 * 全局 OS 文件拖放守卫。
 *
 * 症结:把 Finder/资源管理器里的文件拖到任何没有 drop 处理的工作区表面(Space 视图、空白面板、
 * 侧栏背景、标签栏…),浏览器默认行为会把当前窗口导航到 `file:///…`,整个 SPA 被冲掉且不恢复
 * (Electron 主进程也没有 will-navigate 兜底)。
 *
 * 做法:在 document 根兜底拦截。真正想接文件的表面(编辑器、文件树、聊天框…)在更内层先
 * `preventDefault`——React 事件在根容器上派发、先于 document 冒泡,故这里看 `e.defaultPrevented`
 * 就能只兜底"没人要"的那些拖放,不抢内层已认领的。内部拖拽(Dockview 标签、文件树重排)用的是
 * 自定义 MIME,`types` 不含 'Files',天然被 hasFiles 排除。
 *
 * 附带:用 body[data-file-drag] 驱动全局拖拽高亮(纯 CSS,见 base.css)。
 */
function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files')
}

export function installFileDropGuard(): () => void {
  let depth = 0 // dragenter/dragleave 逐元素成对触发,用计数判断是否真的离开了窗口
  const setDrag = (on: boolean): void => {
    if (on) { document.body.setAttribute('data-file-drag', '1'); return }
    depth = 0
    document.body.removeAttribute('data-file-drag')
  }
  const onOver = (e: DragEvent): void => {
    if (!hasFiles(e) || e.defaultPrevented) return // 内层已认领 → 放行
    e.preventDefault() // 没人要 → 允许 drop 事件触发(下面吞掉),但禁止默认导航
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'
  }
  const onDropBubble = (e: DragEvent): void => {
    if (hasFiles(e) && !e.defaultPrevented) e.preventDefault() // 没人要 → 吞掉,别导航走
  }
  // 捕获阶段:任何 drop 都清高亮——含被内层 filesDrop 提前 stopPropagation 的文件树落点
  // (那些 drop 到不了冒泡阶段的 document,只有 setDrag(false) 会漏,高亮会残留)。
  const onDropClear = (): void => setDrag(false)
  const onEnter = (e: DragEvent): void => { if (hasFiles(e)) { depth++; setDrag(true) } }
  const onLeave = (e: DragEvent): void => { if (hasFiles(e)) { depth = Math.max(0, depth - 1); if (!depth) setDrag(false) } }
  const clear = (): void => setDrag(false)

  document.addEventListener('dragover', onOver)
  document.addEventListener('drop', onDropBubble)
  document.addEventListener('drop', onDropClear, true) // capture:先于内层 stopPropagation
  document.addEventListener('dragenter', onEnter)
  document.addEventListener('dragleave', onLeave)
  window.addEventListener('dragend', clear)
  window.addEventListener('blur', clear) // 拖出窗口外
  return () => {
    document.removeEventListener('dragover', onOver)
    document.removeEventListener('drop', onDropBubble)
    document.removeEventListener('drop', onDropClear, true)
    document.removeEventListener('dragenter', onEnter)
    document.removeEventListener('dragleave', onLeave)
    window.removeEventListener('dragend', clear)
    window.removeEventListener('blur', clear)
    document.body.removeAttribute('data-file-drag') // 卸载兜底,别留残影
  }
}
