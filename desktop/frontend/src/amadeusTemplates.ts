/** 模板与日记:vault 的 templates/ 文件夹即模板库;插入时替换 {{date}}/{{time}}/{{title}} 变量。
 *  模板经只读 readPage 读取(不污染「上次打开」),块按布局顺序摊平插入(多列模板 v1 摊平)。 */
import { amadeus } from '@amadeus/api'
import { usePageStore } from '@amadeus/store/pageStore'

const ps = () => usePageStore.getState()
const pad = (n: number): string => String(n).padStart(2, '0')

export const todayStr = (d = new Date()): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export function listTemplates(): string[] {
  return ps().pages.filter((p) => /^templates\//i.test(p))
}

function substitute(content: string): string {
  const d = new Date()
  const title = (ps().activePage ?? '').split('/').pop()!.replace(/\.md$/, '')
  return content
    .replaceAll('{{date}}', todayStr(d))
    .replaceAll('{{time}}', `${pad(d.getHours())}:${pad(d.getMinutes())}`)
    .replaceAll('{{title}}', title)
}

/** 把模板的块依序插到 afterId 之后;emptyBlock=光标块为空 → 首块直接填入它。 */
export async function insertTemplate(templatePath: string, afterId: string | null, emptyBlock: boolean): Promise<void> {
  const page = await amadeus.readPage(templatePath)
  const contents: string[] = []
  for (const row of page.manifest.root.children)
    for (const col of row.columns)
      for (const ref of col.children) {
        const c = page.blocks[ref.ref]?.content ?? ''
        if (c.trim()) contents.push(substitute(c))
      }
  if (!contents.length) return
  const st = ps()
  let rest = contents
  if (emptyBlock && afterId) {
    st.setBlockContent(afterId, contents[0])
    rest = contents.slice(1)
  }
  if (rest.length) st.insertBlocksAfter(afterId, rest)
}

/** 打开(或创建)今天的日记;新建时若存在 templates/daily.md 自动套用。文件夹取 设置→笔记→日记文件夹。 */
export async function openDailyNote(): Promise<void> {
  if (!ps().vaultRoot) return
  const cfg = await window.tangu?.getConfig?.().catch(() => null)
  const folder = (cfg?.notesDailyFolder ?? '').trim().replace(/^\/+|\/+$/g, '')
  const name = `${todayStr()}.md`
  const path = folder ? `${folder}/${name}` : name
  const existed = ps().pages.includes(path)
  await ps().openOrCreate(path)
  if (existed) return
  const daily = ps().pages.find((p) => /^templates\/daily\.md$/i.test(p))
  if (!daily) return
  // 新日记只有一个空块:模板首块填进去,其余排在后面。模板读取失败(被删等)不影响日记本体。
  const first = ps().manifest?.root.children[0]?.columns[0]?.children[0]?.ref ?? null
  await insertTemplate(daily, first, true).catch(() => { /* ignore */ })
}
