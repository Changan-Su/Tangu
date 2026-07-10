/**
 * Resize divider 的 tick 刻度:鼠标悬停/拖拽 dockview sash 时,在鼠标位置显示一段
 * 垂直于分界线的短把手(单例 fixed DOM + document 委托,不侵入 dockview)。
 * 线本体的渐显样式在 engine.css「Resize divider」段;此处只负责 tick 跟随。
 */
export function installSashAffordance(): () => void {
  const tick = document.createElement('div')
  tick.className = 'lcl-sash-tick'
  document.body.appendChild(tick)

  // 拖拽期间鼠标常在 sash rect 之外(view 尺寸有 min/max 钳制),记住按下的 sash 保持跟随。
  let activeSash: Element | null = null
  let raf = 0

  const place = (sash: Element, e: PointerEvent): void => {
    const horizontal = !!sash.closest('.dv-split-view-container.dv-horizontal') // 竖分界线(左右拖)
    const r = sash.getBoundingClientRect() // 拖拽中 sash 实时移动,rect 不能缓存
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => {
      tick.classList.add('show')
      tick.classList.toggle('h', !horizontal)
      if (horizontal) {
        tick.style.left = `${r.left + r.width / 2}px`
        tick.style.top = `${Math.min(Math.max(e.clientY, r.top), r.bottom)}px`
      } else {
        tick.style.left = `${Math.min(Math.max(e.clientX, r.left), r.right)}px`
        tick.style.top = `${r.top + r.height / 2}px`
      }
    })
  }

  const sashOf = (t: EventTarget | null): Element | null =>
    t instanceof Element ? t.closest('.dv-sash') : null

  const onMove = (e: PointerEvent): void => {
    const sash = activeSash || sashOf(e.target)
    if (sash) place(sash, e)
    else if (tick.classList.contains('show')) {
      cancelAnimationFrame(raf)
      tick.classList.remove('show')
    }
  }
  const onDown = (e: PointerEvent): void => {
    activeSash = sashOf(e.target)
  }
  const onUp = (e: PointerEvent): void => {
    if (!activeSash) return
    activeSash = null
    if (!sashOf(e.target)) {
      cancelAnimationFrame(raf)
      tick.classList.remove('show')
    }
  }

  document.addEventListener('pointermove', onMove, { passive: true })
  document.addEventListener('pointerdown', onDown, { passive: true })
  document.addEventListener('pointerup', onUp, { passive: true })
  return () => {
    cancelAnimationFrame(raf)
    document.removeEventListener('pointermove', onMove)
    document.removeEventListener('pointerdown', onDown)
    document.removeEventListener('pointerup', onUp)
    tick.remove()
  }
}
