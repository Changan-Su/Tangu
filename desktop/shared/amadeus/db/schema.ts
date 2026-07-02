/** Database(Notion 式表格)的文件格式与纯逻辑:vault 内独立 `.db` JSON 文件,笔记里 `![[xxx.db]]` 嵌入。
 *  主进程(写前校验)与渲染层(表格操作)双端引用;显示名存文件内,文件名只作 ![[ ]] 解析用。 */
import { z } from 'zod'

export const DB_VERSION = 1

export type ColumnType = 'text' | 'number' | 'checkbox' | 'date' | 'select' | 'multiselect' | 'url'

/** cell 语义:text/url/select=string、number=有限数、checkbox=boolean(缺=false)、
 *  date='YYYY-MM-DD'(即 <input type=date> 的 value)、multiselect=string[];缺 key 一律视为空。 */
export type CellValue = string | number | boolean | string[] | null

export interface DbColumn {
  id: string
  name: string
  type: ColumnType
  /** select 与 multiselect 共用的选项池(标签字符串,顺序即菜单顺序);互切类型零迁移。 */
  options?: string[]
}

export interface DbRow {
  id: string
  cells: Record<string, CellValue> // key = column.id
}

export interface DbFile {
  version: number
  name: string // 显示名(文件名无关紧要,嵌入头部可改)
  columns: DbColumn[]
  rows: DbRow[] // 数组顺序 = 行的规范顺序
}

export const COLUMN_TYPES: ColumnType[] = ['text', 'number', 'checkbox', 'date', 'select', 'multiselect', 'url']

const cellValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()])
const dbColumnSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  type: z.enum(['text', 'number', 'checkbox', 'date', 'select', 'multiselect', 'url']),
  options: z.array(z.string()).optional(),
})
const dbRowSchema = z.object({
  id: z.string().min(1),
  cells: z.record(z.string(), cellValueSchema),
})
export const dbFileSchema = z.object({
  version: z.number().int().min(1),
  name: z.string(),
  columns: z.array(dbColumnSchema),
  rows: z.array(dbRowSchema),
})

/** 短随机 id(列/行):8 位 base36,表格规模下碰撞可忽略。 */
export const dbId = (): string => Math.random().toString(36).slice(2, 10)

/** 新数据库种子:1 个文本列 + 1 个空行(创建即可打字,不是空壳)。 */
export function emptyDb(name: string): DbFile {
  return {
    version: DB_VERSION,
    name,
    columns: [{ id: dbId(), name: '名称', type: 'text' }],
    rows: [{ id: dbId(), cells: {} }],
  }
}

export type DbParseResult = { ok: true; data: DbFile } | { ok: false; error: string }

/** 宽容读 + 严格拒:JSON 损坏 / 结构不符 / 版本过新(前向保护)都返回错误而非异常。 */
export function parseDb(text: string): DbParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'JSON 解析失败' }
  }
  const r = dbFileSchema.safeParse(raw)
  if (!r.success) return { ok: false, error: '不是有效的 Database 文件结构' }
  if (r.data.version > DB_VERSION) return { ok: false, error: `版本过新(v${r.data.version}),请升级应用` }
  return { ok: true, data: r.data }
}

/** 两空格缩进 + 尾换行:vault 常入 git,保持可 diff。 */
export function serializeDb(db: DbFile): string {
  return `${JSON.stringify(db, null, 2)}\n`
}

/** 列类型切换是非破坏式的(只改 column.type 不动 cells):渲染经此宽容折算,编辑时才写规范值。
 *  切错类型再切回来数据无损(Notion 同款行为)。 */
export function coerceForDisplay(v: CellValue | undefined, type: ColumnType): CellValue {
  switch (type) {
    case 'text':
    case 'url':
      if (typeof v === 'string') return v
      if (typeof v === 'number') return String(v)
      if (Array.isArray(v)) return v.join(', ')
      return ''
    case 'number': {
      if (typeof v === 'number' && Number.isFinite(v)) return v
      if (typeof v === 'string') {
        const n = Number.parseFloat(v)
        if (Number.isFinite(n)) return n
      }
      return null
    }
    case 'checkbox':
      return v === true
    case 'date':
      return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''
    case 'select':
      if (typeof v === 'string') return v
      if (Array.isArray(v)) return v[0] ?? ''
      return ''
    case 'multiselect':
      if (Array.isArray(v)) return v
      if (typeof v === 'string' && v !== '') return [v]
      return []
  }
}
