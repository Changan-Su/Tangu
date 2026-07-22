// 拖入 / 粘贴 / 上传的统一文件导入。三端多态:直接调 window.amadeus.saveAttachment/saveAsset
// (本地磁盘 / 云端 HTTP / 移动 FS 各自实现),调用方不分本地云端。云端直写才预检 5MB 上限。
import { amadeus } from '@amadeus/api'
import { usePageStore } from '@amadeus/store/pageStore'
import { getAttachmentPrefs } from '@amadeus/lib/attachments'
import { useUiStore } from '@amadeus/store/uiStore'

// 云 vault 单文件上限(server vaultService MAX_BINARY_BYTES = 5MiB);本地磁盘库无此限,不预检。
const CLOUD_MAX_BYTES = 5 * 1024 * 1024

const ps = () => usePageStore.getState()
// amadeus 语境吐司走 uiStore(AmadeusOverlays 在主窗与独立窗都渲染;单条即时替换,多文件不刷屏)。
const notify = (text: string): void => useUiStore.getState().notify(text)

/** 当前 saveAttachment/saveAsset 是否直接写云端 HTTP(服务端 5MB 闸即时生效)。
 *  桌面(有 amadeusSync):仅云侧——本地侧先落盘、由同步引擎稍后推,不在此刻受限;
 *  web / 移动云端(cloudBridge 设了 amadeusCloudVaults):直连受限;移动本地(无该对象):不受限。 */
function isCloudDirectWrite(): boolean {
  // amadeusCloudVaults 由 cloudBridge 经 cast 挂到 window(未在 Window 类型上声明),同 amadeusViews 取法。
  return window.amadeusSync ? ps().vaultSide === 'cloud' : !!(window as { amadeusCloudVaults?: unknown }).amadeusCloudVaults
}

/** 关预览的附件链接;含空格/括号的路径包 `<>`(名字里的 `[]` 去掉)。 */
function mdLink(name: string, rel: string): string {
  const dest = /[ ()<>]/.test(rel) ? `<${rel}>` : rel
  return `[${name.replace(/[[\]]/g, '')}](${dest})`
}

/** 预览嵌入 ![[base]] 会被 `]` / `|`(宽度分隔)/ `#` 破坏 → 这类文件名回落到 [名](相对路径)。 */
function embedOrLink(base: string, name: string, pageRel: string, preview: boolean): string {
  return preview && !/[[\]|#]/.test(base) ? `![[${base}]]` : mdLink(name, pageRel)
}

/** 把服务端/本地错误折成用户能懂的一句话。 */
function explain(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e)
  if (/TOO_LARGE|\b413\b/.test(s)) return '超过云端单文件上限 5MB'
  if (/VAULT_FULL/.test(s)) return '云端库容量已满'
  return s || '未知错误'
}

/** 云端直写才卡 5MB(本地/移动本地无限)。返回被跳过的原因串,或 null=放行。 */
function overLimit(f: File): string | null {
  return isCloudDirectWrite() && f.size > CLOUD_MAX_BYTES ? '超 5MB' : null
}

async function refreshTree(): Promise<void> {
  try { await ps().refreshStructure?.() } catch { /* 刷新失败不致命 */ }
}

/** 拖入 / 上传到当前笔记:存到配置的附件位置 + 插入 ![[嵌入]] 或 [名](相对路径)。 */
export async function importToPage(files: File[], page: string): Promise<void> {
  if (!files.length || !page) return
  const { opts, preview } = await getAttachmentPrefs()
  let ok = 0
  let movedAway = 0 // 上传期间用户切了笔记:文件已存入原页,但不误插到当前别的笔记
  const fails: string[] = []
  for (const f of files) {
    const over = overLimit(f)
    if (over) { fails.push(`${f.name}(${over})`); continue }
    try {
      const bytes = new Uint8Array(await f.arrayBuffer())
      const { pageRel, base } = await amadeus.saveAttachment(page, f.name, bytes, opts)
      // insertBlockAfter 隐式落在 activePage:仅当仍是原页才插入(check→insert 同步无缝隙,不会插错笔记)。
      if (ps().activePage === page) { ps().insertBlockAfter(null, undefined, embedOrLink(base, f.name, pageRel, preview)); ok++ }
      else movedAway++
    } catch (e) { fails.push(`${f.name}(${explain(e)})`) }
  }
  await refreshTree()
  if (fails.length) notify(`${fails.length} 个文件未导入:${fails[0]}`)
  else if (movedAway) notify(`文件已存入原笔记(已切换页,未自动插入)`)
  else if (files.length > 1) notify(`已导入 ${ok} 个文件`)
}

/** 拖到文件树 / 库侧栏:把文件写进库里的目标文件夹(空串=库根,不插入嵌入),类似文件管理器导入。 */
export async function importToFolder(files: File[], folder: string): Promise<void> {
  if (!files.length) return
  let ok = 0
  const fails: string[] = []
  for (const f of files) {
    const over = overLimit(f)
    if (over) { fails.push(`${f.name}(${over})`); continue }
    try {
      const bytes = new Uint8Array(await f.arrayBuffer())
      await amadeus.saveAttachment('', f.name, bytes, { mode: 'vault', folder })
      ok++
    } catch (e) { fails.push(`${f.name}(${explain(e)})`) }
  }
  await refreshTree()
  const where = folder ? (folder.split('/').pop() || folder) : '库根目录'
  if (fails.length) notify(`${fails.length} 个文件未导入:${fails[0]}`)
  else notify(`已导入 ${ok} 个文件到「${where}」`)
}

/** 粘贴图片:存 .amadeus/ 并以规范 markdown 图片形式插入。用 ![](.amadeus/x.png) 而非 ![[…]]:
 *  这是磁盘规范形式,assets.ts joinRel/toDisplayMarkdown 必解析;名字空格会破坏 IMG_RE,入库前清洗。 */
export async function pasteImagesToPage(imgs: File[], page: string): Promise<void> {
  if (!imgs.length || !page) return
  let movedAway = 0
  const fails: string[] = []
  for (const f of imgs) {
    if (overLimit(f)) { fails.push('图片超 5MB'); continue }
    try {
      const bytes = new Uint8Array(await f.arrayBuffer())
      const name = (f.name || 'pasted.png').replace(/\s+/g, '_')
      const rel = await amadeus.saveAsset(page, name, bytes) // → ".amadeus/<unique>"(页相对)
      // 同 importToPage:切了页就不误插到别的笔记(图片已存原页 .amadeus/,提示用户避免默认丢失)。
      if (ps().activePage === page) ps().insertBlockAfter(null, undefined, `![](${rel})`)
      else movedAway++
    } catch (e) { fails.push(explain(e)) }
  }
  await refreshTree()
  if (fails.length) notify(`粘贴图片:${fails[0]}`)
  else if (movedAway) notify('图片已存入原笔记(已切换页,未自动插入)')
}
