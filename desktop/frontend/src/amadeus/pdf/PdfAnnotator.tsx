/**
 * 可批注 PDF 阅读器(布局对标 PDF Expert / UPDF:左缩略图栏 + 顶部工具栏 + 底部悬浮缩放/页码胶囊)。
 * 所有批注写进 PDF 本身(原生注释对象)→ 任何阅读器可见。两条写入路径,单一串行队列防双写:
 *  - pdf.js 原生编辑器:高亮(HIGHLIGHT)/添加文字(FREETEXT)→ 防抖 saveDocument() 覆盖写回;
 *  - pdf-lib(pdfMarkup.ts):下划线/波浪线/删除线(选区 QuadPoints)、便签(/Text)、书签(Outline)、
 *    形状(/Square /Circle /Line + /AP)→ 先 flush pdf.js 待存内容,再改字节,写回后【必须】swapDoc 重载
 *    (否则 pdf.js 基线过期,下次 saveDocument 会把 pdf-lib 写的内容丢掉)。
 */
import { useEffect, useRef, useState, type ReactElement } from 'react'
// ⚠️必须用 legacy 构建:pdf.js 5.7 用了 TC39 `Map.prototype.getOrInsertComputed`(upsert 提案),
// Electron 40 的 V8 未提供 → 非 legacy 版运行时崩「getOrInsertComputed is not a function」(主线程 + worker 都用到)。
// legacy 版内置 core-js polyfill(主/worker 各自打)。故 core/viewer/worker/css 全部走 legacy 路径。
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import { AnnotationEditorType, AnnotationEditorParamsType } from 'pdfjs-dist/legacy/build/pdf.mjs'
// pdf_viewer.mjs = pdf.js 官方组件包(PDFViewer 全家桶);类型在同目录 .d.mts。
import { EventBus, PDFLinkService, PDFViewer } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs'
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
// ⚠️?inline + @scope:pdf_viewer.css 抢了 .dialog / .sidebar 等通用类名并**直接画背景色**,
// 全局注入会接管 Amadeus 全 App 共用的 Dialogs.tsx(className="dialog",23 处)——表现为「打开过 PDF 后
// 输入弹窗配色不对」。故不 import 副作用版,改注入 @scope 关进阅读器内。见 ensureScopedCss。
import pdfViewerCss from 'pdfjs-dist/legacy/web/pdf_viewer.css?inline'
import './pdfAnnotator.css'
import {
  BookmarkPlus, Circle, Highlighter, Minus, MousePointer2, MoveUpRight, PanelLeft, Square,
  StickyNote, Strikethrough, Type, Underline as UnderlineIcon, Waves,
} from 'lucide-react'
import { buildPdfLink } from '@amadeus-shared/pdfLink'
import { askString } from '../components/askString'
import { amadeus } from '../api'
import { addBookmark, addNote, addShape, addTextMarkup, type MarkupKind, type ShapeKind, type ShapeStyle } from './pdfMarkup'
import { pageAt, pointOnPage, selectionToQuads } from './selectionQuads'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

/** pdf.js 官方样式表关进 `.pdfa-root` 内(见 import 处注释)。两处改写缺一不可,改动前先跑
 *  `node scripts/pdf-css-scope.check.cjs`(真浏览器断言隔离生效 + 变量没丢 + 运行时高度能进来):
 *  ① `:root` → `:scope`:@scope 内 `:root` 永不匹配(html 不在作用域里)→ 其 CSS 变量全丢、渲染错乱。
 *  ② 剔掉 `--viewer-container-height:0`:pdf.js **运行时**把它写在 `document.documentElement` 上
 *     (viewer 里唯一这么干的变量),而 ① 之后 `:scope` 的同名声明会压过从 html 继承来的真值 →
 *     .dummyPage 高度恒为 0。`:root` 里那个 0 本就只是 JS 跑之前的兜底默认,删掉正好继承。 */
const CSS_ID = 'pdfjs-viewer-scoped'
export const scopePdfCss = (css: string): string =>
  `@scope (.pdfa-root) {\n${css.replace(/:root\b/g, ':scope').replace(/--viewer-container-height:\s*0;/g, '')}\n}`
function ensureScopedCss(): void {
  if (document.getElementById(CSS_ID)) return
  const el = document.createElement('style')
  el.id = CSS_ID
  el.textContent = scopePdfCss(pdfViewerCss)
  document.head.append(el)
}

/** 调色板(名→色);annotationEditorHighlightColors 需 `k=#hex,` 串。高亮/标记/便签/形状共用。 */
const PALETTE: ReadonlyArray<readonly [string, string]> = [
  ['黄', '#ffe14d'], ['绿', '#8ce99a'], ['蓝', '#74c0fc'], ['粉', '#ffa8c5'], ['橙', '#ffc078'], ['红', '#ff6b6b'],
]
const HIGHLIGHT_COLORS = PALETTE.map(([, hex], i) => `c${i}=${hex}`).join(',')

type Tool = 'mouse' | 'highlight' | 'underline' | 'squiggly' | 'strikeout' | 'text' | 'note' | ShapeKind
const MARKUP_TOOLS: ReadonlySet<Tool> = new Set<Tool>(['underline', 'squiggly', 'strikeout'])
const SHAPE_TOOLS: ReadonlySet<Tool> = new Set<Tool>(['rect', 'circle', 'line', 'arrow'])
/** 工具 → pdf.js 编辑器模式(标记/便签/形状走自建管线,编辑器保持 NONE)。 */
const TOOL_MODE: Partial<Record<Tool, number>> = {
  highlight: AnnotationEditorType.HIGHLIGHT,
  text: AnnotationEditorType.FREETEXT,
}
const modeOf = (t: Tool): number => TOOL_MODE[t] ?? AnnotationEditorType.NONE

const TOOLS: ReadonlyArray<{ id: Tool; tip: string; Icon: typeof MousePointer2; gap?: boolean }> = [
  { id: 'mouse', tip: '鼠标(选择文字/滚动)', Icon: MousePointer2 },
  { id: 'highlight', tip: '高亮(选中文本;空白处拖拽=自由高亮)', Icon: Highlighter },
  { id: 'underline', tip: '下划线(选中文本即标)', Icon: UnderlineIcon },
  { id: 'squiggly', tip: '波浪线(选中文本即标)', Icon: Waves },
  { id: 'strikeout', tip: '删除线(选中文本即标)', Icon: Strikethrough },
  { id: 'text', tip: '添加文字(点击页面输入)', Icon: Type },
  { id: 'note', tip: '便签评论(点击页面放置)', Icon: StickyNote },
  { id: 'rect', tip: '矩形(在页面上拖拽)', Icon: Square, gap: true },
  { id: 'circle', tip: '圆形/椭圆(在页面上拖拽)', Icon: Circle },
  { id: 'line', tip: '直线(在页面上拖拽)', Icon: Minus },
  { id: 'arrow', tip: '箭头(在页面上拖拽)', Icon: MoveUpRight },
]
const ZOOMS: ReadonlyArray<{ v: string; label: string }> = [
  { v: 'page-width', label: '适宽' }, { v: 'page-fit', label: '适页' },
  { v: '0.5', label: '50%' }, { v: '0.75', label: '75%' }, { v: '1', label: '100%' },
  { v: '1.25', label: '125%' }, { v: '1.5', label: '150%' }, { v: '2', label: '200%' }, { v: '3', label: '300%' },
]
const fmtZoom = (v: string): string => (Number.isNaN(parseFloat(v)) ? v : `${Math.round(parseFloat(v) * 100)}%`)
const WIDTHS = [1, 2, 3, 5, 8]
const OPACITIES = [1, 0.75, 0.5, 0.25]

const baseName = (p: string): string => p.split(/[\\/]/).pop() || p

/** 拖拽中的形状预览(客户区坐标 → 相对 viewport 的定位盒)。 */
interface Drag { pageIndex: number; ax: number; ay: number; bx: number; by: number }

interface Engine {
  viewer: any
  linkService: any
  eventBus: any
  uiManager: any
  doc: any
  timer: ReturnType<typeof setTimeout> | null
  dirty: boolean
  chain: Promise<void>
}
type WriteOp = (bytes: Uint8Array) => Promise<Uint8Array>

export function PdfAnnotator({ pdfPath, initialPage }: { pdfPath: string; initialPage?: number }) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const eng = useRef<Engine | null>(null)
  const enqueueRef = useRef<((op?: WriteOp) => Promise<void>) | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [info, setInfo] = useState({ page: initialPage || 1, total: 0 })
  const [color, setColor] = useState(PALETTE[0][1])
  const colorRef = useRef(PALETTE[0][1])
  const [tool, setTool] = useState<Tool>('mouse')
  const toolRef = useRef<Tool>('mouse')
  const [shape, setShape] = useState<{ fill: boolean; width: number; opacity: number }>({ fill: false, width: 2, opacity: 1 })
  const shapeRef = useRef(shape)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [side, setSide] = useState<'thumbs' | 'outline' | null>('thumbs')
  const [zoomSel, setZoomSel] = useState('page-width')
  const [docVersion, setDocVersion] = useState(0)
  const [copied, setCopied] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0) // 重试:重建 viewer 重新读字节(自愈瞬时失败)

  useEffect(() => {
    ensureScopedCss()
    const container = containerRef.current
    if (!container) return
    let dead = false
    setStatus('loading')

    const eventBus = new EventBus()
    const linkService = new PDFLinkService({ eventBus })
    const viewer = new PDFViewer({
      container,
      eventBus,
      linkService,
      annotationEditorMode: AnnotationEditorType.NONE, // 默认鼠标模式,工具栏切换
      annotationEditorHighlightColors: HIGHLIGHT_COLORS,
      enableHighlightFloatingButton: true, // 选中文本 → 浮动「高亮」按钮
      imageResourcesPath: 'pdfjs-annot/', // /Text 便签图标(public/pdfjs-annot/annotation-*.svg)
      // 以上几项在 v5.7 运行时被读取(pdf_viewer.mjs),.d.mts 类型未收录 → 断言。
    } as any)
    linkService.setViewer(viewer)
    const state: Engine = { viewer, linkService, eventBus, uiManager: null, doc: null, timer: null, dirty: false, chain: Promise.resolve() }
    eng.current = state

    const flash = (msg: string): void => {
      setNotice(msg)
      window.setTimeout(() => setNotice(null), 2600)
    }

    /** 串行写队列:pdf.js 存档与 pdf-lib 写入互斥排队。op 缺省 = 纯 flush(防抖保存)。 */
    const enqueue = (op?: WriteOp): Promise<void> => {
      const run = state.chain.then(async () => {
        if (dead || !state.doc) return
        if (!op && !state.dirty) return
        if (state.timer) { clearTimeout(state.timer); state.timer = null }
        state.dirty = false // 编辑器待存内容随本次 flush 一并落盘
        const base: Uint8Array = await state.doc.saveDocument()
        const next = op ? await op(base) : base
        await amadeus.saveVaultBytes(pdfPath, next)
        if (op && !dead) await swapDoc(next)
      }).catch((e: unknown) => {
        state.dirty = true // 失败留脏,下次编辑再试
        console.error('[pdf] 写入失败', e)
        if (!dead) flash('写入失败:此 PDF 可能受保护或已损坏')
      })
      state.chain = run
      return run
    }
    enqueueRef.current = enqueue

    const scheduleSave = (): void => {
      if (state.timer) clearTimeout(state.timer)
      state.timer = setTimeout(() => void enqueue(), 1500)
    }
    const markDirty = (): void => { state.dirty = true; scheduleSave() }

    // 组件包不监听 switchannotationeditorparams(那是 Firefox 完整版 app.js 的活),
    // 必须自己抓住 uiManager 直接 updateParams,否则高亮调色板点了没反应。
    eventBus.on('annotationeditoruimanager', (e: { uiManager: any }) => { state.uiManager = e.uiManager })
    const applyHighlightColor = (): void => {
      try { state.uiManager?.updateParams(AnnotationEditorParamsType.HIGHLIGHT_COLOR, colorRef.current) } catch { /* ignore */ }
    }

    /** 挂载文档 + 恢复视图(初载与 pdf-lib 写后重载共用)。 */
    const attach = (doc: any, keep: { page: number; scale: string; top: number; left: number }): void => {
      viewer.setDocument(doc)
      linkService.setDocument(doc, null)
      ;(doc.annotationStorage as any).onSetModified = markDirty
      const restore = (): void => {
        if (dead) return
        viewer.currentPageNumber = Math.min(doc.numPages, Math.max(1, keep.page))
        if (keep.top || keep.left) { container.scrollTop = keep.top; container.scrollLeft = keep.left }
      }
      eventBus.on('pagesinit', () => {
        if (dead) return
        viewer.currentScaleValue = keep.scale
        try { viewer.annotationEditorMode = { mode: modeOf(toolRef.current) } } catch { /* ignore */ }
        applyHighlightColor()
        if (keep.page > 1 || keep.top) restore()
      }, { once: true })
      // pagesinit 时页面高度还是占位值,pagesloaded 后再校正一次页码/滚动。
      eventBus.on('pagesloaded', restore, { once: true })
      setInfo({ page: Math.min(doc.numPages, Math.max(1, keep.page)), total: doc.numPages })
      setDocVersion((v) => v + 1)
    }

    /** pdf-lib 写后重载:保留页码/缩放/滚动,换新字节的文档(旧 doc 销毁)。 */
    const swapDoc = async (bytes: Uint8Array): Promise<void> => {
      const old = state.doc
      const keep = {
        page: viewer.currentPageNumber || 1,
        scale: String(viewer.currentScaleValue || 'page-width'),
        top: container.scrollTop,
        left: container.scrollLeft,
      }
      const doc = await pdfjsLib.getDocument({ data: bytes }).promise
      if (dead) { void doc.destroy(); return }
      state.doc = doc
      attach(doc, keep)
      try { void old?.destroy() } catch { /* ignore */ }
    }

    eventBus.on('pagechanging', (e: { pageNumber: number }) => setInfo((p) => ({ ...p, page: e.pageNumber })))
    eventBus.on('scalechanging', (e: { scale: number; presetValue?: string }) => setZoomSel(e.presetValue || String(e.scale)))
    // 两路脏信号取并集(表单存储 + 编辑器状态),防某一路在高亮场景不触发。
    eventBus.on('annotationeditorstateschanged', markDirty)

    // 下划线/波浪线/删除线:标记工具激活时,松开鼠标即把选区写成对应注释。
    const onPointerUp = (): void => {
      const t = toolRef.current
      if (!MARKUP_TOOLS.has(t)) return
      setTimeout(() => {
        if (dead) return
        const marks = selectionToQuads(state.viewer)
        if (!marks.length) return
        window.getSelection()?.removeAllRanges()
        void enqueue((b) => addTextMarkup(b, t as MarkupKind, colorRef.current, marks))
      }, 10) // 等浏览器把选区定稿
    }
    // 便签评论:点击页面 → 输入文字 → /Text 注释(悬停图标可看内容)。
    const onNoteClick = (ev: MouseEvent): void => {
      if (toolRef.current !== 'note') return
      if ((ev.target as HTMLElement).closest?.('.annotationLayer section')) return // 点在已有注释上=看弹窗,不新建
      const hit = pageAt(state.viewer, ev.clientX, ev.clientY)
      if (!hit) return
      void askString('便签评论', '', { confirmLabel: '添加' }).then((text) => {
        if (dead || !text?.trim()) return
        void enqueue((b) => addNote(b, hit.pageIndex, hit.x, hit.y, text.trim(), colorRef.current))
      })
    }

    // 形状:在页面上拖拽 → 实时预览 → 松手写 /Square /Circle /Line(带 /AP)。
    let live: Drag | null = null
    const onShapeDown = (ev: PointerEvent): void => {
      const t = toolRef.current
      if (!SHAPE_TOOLS.has(t) || ev.button !== 0) return
      const hit = pageAt(state.viewer, ev.clientX, ev.clientY)
      if (!hit) return
      ev.preventDefault() // 防止拖出文字选区
      live = { pageIndex: hit.pageIndex, ax: ev.clientX, ay: ev.clientY, bx: ev.clientX, by: ev.clientY }
      setDrag(live)
      container.setPointerCapture(ev.pointerId)
    }
    const onShapeMove = (ev: PointerEvent): void => {
      if (!live) return
      live = { ...live, bx: ev.clientX, by: ev.clientY }
      setDrag(live)
    }
    const onShapeUp = (ev: PointerEvent): void => {
      const d = live
      if (!d) return
      live = null
      setDrag(null)
      try { container.releasePointerCapture(ev.pointerId) } catch { /* ignore */ }
      const t = toolRef.current as ShapeKind
      if (Math.hypot(d.bx - d.ax, d.by - d.ay) < 4) return // 误点(非拖拽)不建形状
      const a = pointOnPage(state.viewer, d.pageIndex, d.ax, d.ay)
      const b = pointOnPage(state.viewer, d.pageIndex, d.bx, d.by)
      if (!a || !b) return
      const s = shapeRef.current
      const style: ShapeStyle = {
        stroke: colorRef.current,
        fill: s.fill ? colorRef.current : null,
        width: s.width,
        opacity: s.opacity,
      }
      void enqueue((by) => addShape(by, d.pageIndex, t, a, b, style))
    }

    // ⌘/Ctrl+滚轮 与 触控板捏合(macOS 捏合 = ctrlKey 的 wheel 事件)缩放:
    // pdf.js **组件包不含**滚轮缩放(那是 Firefox 完整 viewer 的 webViewerWheel)→ 必须自己接。
    const onWheel = (ev: WheelEvent): void => {
      if (!ev.ctrlKey && !ev.metaKey) return
      ev.preventDefault() // 否则整个界面被浏览器缩放
      if (!state.doc) return
      const delta = -ev.deltaY
      if (!delta) return
      // 以光标为中心缩放(pdf.js updateScale 的 origin 语义:客户区坐标)。
      viewer.updateScale({
        scaleFactor: Math.max(0.8, Math.min(1.25, Math.exp(delta / 200))),
        origin: [ev.clientX, ev.clientY],
        drawingDelay: 0,
      })
    }

    container.addEventListener('pointerup', onPointerUp)
    container.addEventListener('click', onNoteClick)
    container.addEventListener('pointerdown', onShapeDown)
    container.addEventListener('pointermove', onShapeMove)
    container.addEventListener('pointerup', onShapeUp)
    container.addEventListener('wheel', onWheel, { passive: false })

    // 容器尺寸变化(侧栏开合/分栏拖动)时,预设缩放(适宽/适页)重排。
    const ro = new ResizeObserver(() => {
      if (dead || !state.doc) return
      const cur = viewer.currentScaleValue
      if (cur === 'page-width' || cur === 'page-fit' || cur === 'auto') viewer.currentScaleValue = cur
    })
    ro.observe(container)

    void (async () => {
      try {
        // 读字节走 IPC 再 getDocument({data}):不能用 {url:'amadeus-asset://…'} —— dev 渲染器是
        // http://localhost 源,XHR 到自定义 scheme 被 Chromium 跨源拦(内联 iframe 走导航才不受限)。
        const bytes = await amadeus.readVaultBytes(pdfPath)
        if (dead) return
        const doc = await pdfjsLib.getDocument({ data: bytes }).promise
        if (dead) { void doc.destroy(); return }
        state.doc = doc
        attach(doc, { page: initialPage || 1, scale: 'page-width', top: 0, left: 0 })
        setStatus('ready')
      } catch (e) {
        if (!dead) { console.error('[pdf] 加载失败', e); setStatus('error') }
      }
    })()

    return () => {
      dead = true
      enqueueRef.current = null
      if (state.timer) clearTimeout(state.timer)
      ro.disconnect()
      container.removeEventListener('pointerup', onPointerUp)
      container.removeEventListener('click', onNoteClick)
      container.removeEventListener('pointerdown', onShapeDown)
      container.removeEventListener('pointermove', onShapeMove)
      container.removeEventListener('pointerup', onShapeUp)
      container.removeEventListener('wheel', onWheel)
      try { viewer.setDocument(null as any); linkService.setDocument(null as any) } catch { /* ignore */ }
      // 尾部落盘:排在既有写队列后(串行),完成后统一销毁当前 doc——
      // destroy 必须等 save 完成,否则 saveDocument() 读到一半 doc 被销毁 → 快速关 tab 丢最后一次批注。
      void state.chain.then(async () => {
        const doc = state.doc
        if (doc && state.dirty) {
          try {
            const b: Uint8Array = await doc.saveDocument()
            await amadeus.saveVaultBytes(pdfPath, b)
          } catch { /* ignore */ }
        }
      }).finally(() => {
        try { state.doc?.destroy() } catch { /* ignore */ }
        state.doc = null
        if (eng.current === state) eng.current = null
      })
    }
  }, [pdfPath, reloadNonce]) // eslint-disable-line react-hooks/exhaustive-deps

  // 已开着的 tab 被要求跳页:openPdf 激活既有 tab 后广播 amadeus:pdf-goto(避免 remount 重下 PDF)。
  useEffect(() => {
    const onGoto = (e: Event): void => {
      const d = (e as CustomEvent<{ pdfPath?: string; page?: number }>).detail
      if (d?.pdfPath === pdfPath && d.page && d.page >= 1 && eng.current) {
        eng.current.viewer.currentPageNumber = d.page
      }
    }
    window.addEventListener('amadeus:pdf-goto', onGoto)
    return () => window.removeEventListener('amadeus:pdf-goto', onGoto)
  }, [pdfPath])

  const selectTool = (t: Tool): void => {
    setTool(t)
    toolRef.current = t
    const e = eng.current
    if (e?.doc) {
      try { e.viewer.annotationEditorMode = { mode: modeOf(t) } } catch { /* ignore */ }
      if (t === 'highlight') {
        try { e.uiManager?.updateParams(AnnotationEditorParamsType.HIGHLIGHT_COLOR, colorRef.current) } catch { /* ignore */ }
      }
    }
  }
  const pickColor = (hex: string): void => {
    setColor(hex)
    colorRef.current = hex
    // 直接打 uiManager:组件包没有 switchannotationeditorparams 的监听(那是 Firefox 完整版的)。
    try { eng.current?.uiManager?.updateParams(AnnotationEditorParamsType.HIGHLIGHT_COLOR, hex) } catch { /* ignore */ }
  }
  const setShapeOpt = (patch: Partial<typeof shape>): void => {
    const next = { ...shapeRef.current, ...patch }
    shapeRef.current = next
    setShape(next)
  }
  const zoom = (dir: 1 | -1): void => {
    const v = eng.current?.viewer
    if (v) dir > 0 ? v.increaseScale() : v.decreaseScale()
  }
  const setZoomPreset = (val: string): void => {
    const v = eng.current?.viewer
    if (v) v.currentScaleValue = val
  }
  const go = (delta: number): void => {
    const v = eng.current?.viewer
    if (v) v.currentPageNumber = Math.min(info.total, Math.max(1, info.page + delta))
  }
  const goTo = (n: number): void => {
    const v = eng.current?.viewer
    if (v && n >= 1 && n <= info.total) v.currentPageNumber = n
  }
  const copyLink = async (): Promise<void> => {
    await navigator.clipboard?.writeText(buildPdfLink(baseName(pdfPath), { page: info.page }))
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }
  const addBm = async (): Promise<void> => {
    const e = eng.current
    if (!e?.doc || !enqueueRef.current) return
    const pg = e.viewer.currentPageNumber || 1
    const title = await askString('添加书签(写进 PDF 目录)', `第 ${pg} 页`, { confirmLabel: '添加' })
    if (title === null) return
    void enqueueRef.current((b) => addBookmark(b, pg - 1, title.trim() || `第 ${pg} 页`))
  }

  const ready = status === 'ready'
  const doc = eng.current?.doc
  const isShape = SHAPE_TOOLS.has(tool)

  return (
    <div className="pdfa-root">
      <div className="pdfa-toolbar">
        <button
          className={`pdfa-btn pdfa-tool${side ? ' on' : ''}`}
          onClick={() => setSide((s) => (s ? null : 'thumbs'))}
          title="侧栏(缩略图/目录)"
        ><PanelLeft size={15} /></button>
        <span className="pdfa-sep" />
        {TOOLS.map(({ id, tip, Icon, gap }) => (
          <span key={id} style={gap ? { display: 'contents' } : undefined}>
            {gap && <span className="pdfa-sep" />}
            <button
              className={`pdfa-btn pdfa-tool${tool === id ? ' on' : ''}`}
              title={tip}
              onClick={() => selectTool(id)}
            ><Icon size={15} /></button>
          </span>
        ))}
        <span className="pdfa-sep" />
        <span className="pdfa-swatches" title="批注颜色">
          {PALETTE.map(([name, hex]) => (
            <button
              key={hex}
              className={`pdfa-swatch${color === hex ? ' on' : ''}`}
              style={{ background: hex }}
              title={`颜色:${name}`}
              onClick={() => pickColor(hex)}
            />
          ))}
        </span>
        {isShape && (
          <>
            <span className="pdfa-sep" />
            <button
              className={`pdfa-btn pdfa-tool${shape.fill ? ' on' : ''}`}
              title={shape.fill ? '实心(点击改为空心)' : '空心(点击改为实心)'}
              onClick={() => setShapeOpt({ fill: !shape.fill })}
              disabled={tool === 'line' || tool === 'arrow'}
            >{shape.fill ? '实心' : '空心'}</button>
            <select className="pdfa-mini" value={shape.width} onChange={(e) => setShapeOpt({ width: Number(e.target.value) })} title="线宽">
              {WIDTHS.map((w) => <option key={w} value={w}>{w} pt</option>)}
            </select>
            <select className="pdfa-mini" value={shape.opacity} onChange={(e) => setShapeOpt({ opacity: Number(e.target.value) })} title="不透明度">
              {OPACITIES.map((o) => <option key={o} value={o}>{Math.round(o * 100)}%</option>)}
            </select>
          </>
        )}
        <span className="pdfa-sep" />
        <button className="pdfa-btn pdfa-tool" title="添加书签(写进 PDF 目录,任何阅读器可见)" onClick={() => void addBm()}>
          <BookmarkPlus size={15} />
        </button>
        <span className="pdfa-flex" />
        <button className="pdfa-btn pdfa-copy" onClick={() => void copyLink()} title="复制指向本页的笔记链接">
          {copied ? '已复制' : '复制本页链接'}
        </button>
      </div>
      <div className="pdfa-body">
        {side && (
          <div className="pdfa-side">
            <div className="pdfa-sidetabs">
              <button className={side === 'thumbs' ? 'on' : ''} onClick={() => setSide('thumbs')}>缩略图</button>
              <button className={side === 'outline' ? 'on' : ''} onClick={() => setSide('outline')}>目录</button>
            </div>
            <div className="pdfa-sidebody">
              {ready && doc ? (
                side === 'thumbs'
                  ? <Thumbs key={`t${docVersion}`} doc={doc} current={info.page} onPick={goTo} />
                  : <Outline key={`o${docVersion}`} doc={doc} onGo={(dest) => void eng.current?.linkService.goToDestination(dest)} />
              ) : null}
            </div>
          </div>
        )}
        <div className="pdfa-viewport" ref={viewportRef}>
          <div ref={containerRef} className="pdfa-container" data-tool={tool}>
            <div className="pdfViewer" />
          </div>
          {drag && viewportRef.current && (
            <ShapePreview drag={drag} kind={tool as ShapeKind} color={color} shape={shape} host={viewportRef.current} />
          )}
          {ready && (
            <div className="pdfa-bottombar">
              <button className="pdfa-btn" onClick={() => zoom(-1)} title="缩小">−</button>
              <select
                className="pdfa-zoomsel"
                value={zoomSel}
                onChange={(e) => setZoomPreset(e.target.value)}
                title="缩放(⌘/Ctrl+滚轮 或 触控板捏合)"
              >
                {!ZOOMS.some((z) => z.v === zoomSel) && <option value={zoomSel}>{fmtZoom(zoomSel)}</option>}
                {ZOOMS.map((z) => <option key={z.v} value={z.v}>{z.label}</option>)}
              </select>
              <button className="pdfa-btn" onClick={() => zoom(1)} title="放大">＋</button>
              <span className="pdfa-sep" />
              <button className="pdfa-btn" onClick={() => go(-1)} disabled={info.page <= 1} title="上一页">‹</button>
              <input
                key={info.page}
                className="pdfa-pageinput"
                defaultValue={info.page}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') goTo(parseInt((e.target as HTMLInputElement).value, 10) || 0)
                }}
                title="页码(回车跳转)"
              />
              <span className="pdfa-pagetotal">/ {info.total || '…'}</span>
              <button className="pdfa-btn" onClick={() => go(1)} disabled={!info.total || info.page >= info.total} title="下一页">›</button>
            </div>
          )}
          {notice && <div className="pdfa-notice">{notice}</div>}
          {status === 'loading' && <div className="pdfa-state">加载中…</div>}
          {status === 'error' && (
            <div className="pdfa-state pdfa-state-err">
              <span>无法加载此 PDF</span>
              <button className="pdfa-btn" onClick={() => setReloadNonce((n) => n + 1)}>重试</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** 拖拽中的形状预览(纯 SVG 覆盖层,不进 PDF)。坐标换算到 viewport 局部。 */
function ShapePreview({ drag, kind, color, shape, host }: {
  drag: Drag; kind: ShapeKind; color: string; shape: { fill: boolean; width: number; opacity: number }; host: HTMLElement
}) {
  const r = host.getBoundingClientRect()
  const ax = drag.ax - r.left, ay = drag.ay - r.top, bx = drag.bx - r.left, by = drag.by - r.top
  const fill = shape.fill && kind !== 'line' && kind !== 'arrow' ? color : 'none'
  const common = { stroke: color, strokeWidth: shape.width, fill, opacity: shape.opacity }
  return (
    <svg className="pdfa-preview" width={r.width} height={r.height}>
      {kind === 'rect' && <rect x={Math.min(ax, bx)} y={Math.min(ay, by)} width={Math.abs(bx - ax)} height={Math.abs(by - ay)} {...common} />}
      {kind === 'circle' && (
        <ellipse cx={(ax + bx) / 2} cy={(ay + by) / 2} rx={Math.abs(bx - ax) / 2} ry={Math.abs(by - ay) / 2} {...common} />
      )}
      {(kind === 'line' || kind === 'arrow') && (
        <line x1={ax} y1={ay} x2={bx} y2={by} {...common} fill="none" markerEnd={kind === 'arrow' ? 'url(#pdfa-arrow)' : undefined} />
      )}
      {kind === 'arrow' && (
        <defs>
          <marker id="pdfa-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
          </marker>
        </defs>
      )}
    </svg>
  )
}

const THUMB_W = 128

/** 页面缩略图栏:懒渲染(进入视口才画),点击跳页,当前页高亮。 */
function Thumbs({ doc, current, onPick }: { doc: any; current: number; onPick: (p: number) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    let alive = true
    const tasks = new Set<any>()
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue
        const el = en.target as HTMLCanvasElement
        io.unobserve(el)
        const n = Number(el.dataset.p)
        doc.getPage(n).then((page: any) => {
          if (!alive) return
          const base = page.getViewport({ scale: 1 })
          const vp = page.getViewport({ scale: (THUMB_W / base.width) * 2 }) // 2x 清晰度
          el.width = vp.width
          el.height = vp.height
          const task = page.render({ canvasContext: el.getContext('2d'), viewport: vp })
          tasks.add(task)
          task.promise.catch(() => { /* cancelled */ }).finally(() => tasks.delete(task))
        }).catch(() => { /* doc destroyed */ })
      }
    }, { root: wrap.parentElement, rootMargin: '400px' })
    wrap.querySelectorAll('canvas').forEach((c) => io.observe(c))
    return () => {
      alive = false
      io.disconnect()
      tasks.forEach((t) => { try { t.cancel() } catch { /* ignore */ } })
    }
  }, [doc])
  useEffect(() => {
    wrapRef.current?.querySelector(`[data-t="${current}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [current])
  return (
    <div ref={wrapRef} className="pdfa-thumbs">
      {Array.from({ length: doc.numPages as number }, (_, i) => (
        <div
          key={i}
          data-t={i + 1}
          className={`pdfa-thumb${current === i + 1 ? ' on' : ''}`}
          onClick={() => onPick(i + 1)}
        >
          <canvas data-p={i + 1} width={THUMB_W * 2} height={Math.round(THUMB_W * 2 * 1.414)} />
          <div className="no">{i + 1}</div>
        </div>
      ))}
    </div>
  )
}

/** PDF 大纲(目录/书签):点击跳转;「添加书签」写进这里。 */
function Outline({ doc, onGo }: { doc: any; onGo: (dest: unknown) => void }) {
  const [items, setItems] = useState<any[] | null>(null)
  useEffect(() => {
    let alive = true
    doc.getOutline()
      .then((o: any[]) => { if (alive) setItems(o || []) })
      .catch(() => { if (alive) setItems([]) })
    return () => { alive = false }
  }, [doc])
  if (!items) return <div className="pdfa-side-empty">加载中…</div>
  if (!items.length) return <div className="pdfa-side-empty">无目录/书签<br />工具栏「+书签」可添加</div>
  const render = (list: any[], depth: number): ReactElement[] => list.flatMap((it, i) => [
    <button
      key={`${depth}-${i}`}
      style={{ paddingLeft: 8 + depth * 12 }}
      onClick={() => { if (it.dest) onGo(it.dest) }}
    >{it.title || '(无标题)'}</button>,
    ...(it.items?.length ? render(it.items, depth + 1) : []),
  ])
  return <div className="pdfa-outline">{render(items, 0)}</div>
}
