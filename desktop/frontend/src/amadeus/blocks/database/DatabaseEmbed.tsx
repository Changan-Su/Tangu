/** Database 嵌入(![[xxx.db]]):Notion 式可编辑表格,数据存 vault 内独立 .db JSON 文件。
 *  数据经 dbStore 按 ref 共享 → 同一 db 的多处嵌入(同页多块/多标签)实时互通、写穿防抖落盘。
 *  排序仅视图态不写盘(文件 rows 顺序即规范顺序);列类型切换非破坏(coerceForDisplay 宽容显示)。
 *  弹层(选项/列菜单)用 fixed 定位:表格外层是 overflow 滚动层,absolute 会被裁剪。 */
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import {
  COLUMN_TYPES,
  coerceForDisplay,
  dbId,
  type CellValue,
  type ColumnType,
  type DbColumn,
  type DbFile,
  type DbRow,
} from '@amadeus-shared/db/schema'
import { linkTarget, resolvePageName } from '@amadeus-shared/links'
import { useDbStore } from '../../store/dbStore'
import { usePageStore } from '../../store/pageStore'
import { amadeus } from '../../api'

const TYPE_META: Record<ColumnType, { icon: string; label: string }> = {
  text: { icon: '¶', label: '文本' },
  number: { icon: '#', label: '数字' },
  checkbox: { icon: '☑', label: '勾选' },
  date: { icon: '📅', label: '日期' },
  select: { icon: '◉', label: '单选' },
  multiselect: { icon: '⊞', label: '多选' },
  url: { icon: '🔗', label: '链接' },
}

interface Pop {
  kind: 'options' | 'colmenu'
  colId: string
  rowId?: string
  x: number
  y: number
}

export function DatabaseEmbed({ target, pagePath }: { target: string; pagePath: string }) {
  const entry = useDbStore((s) => s.entries[target])
  useEffect(() => {
    void useDbStore.getState().load(pagePath, target)
  }, [pagePath, target])

  if (!entry || entry.status === 'loading') {
    return <div className="amx-db amx-db-state">读取数据库…</div>
  }
  if (entry.status === 'missing') {
    return (
      <div className="amx-db amx-db-state">
        数据库文件缺失:<code>{target}</code>
        <button className="amx-db-linkbtn" onClick={() => void useDbStore.getState().reload(pagePath, target)}>重试</button>
      </div>
    )
  }
  if (entry.status === 'corrupt' || !entry.data) {
    return (
      <div className="amx-db amx-db-state">
        数据库文件已损坏{entry.message ? `(${entry.message})` : ''},已进入只读保护。
        {entry.path && (
          <button className="amx-db-linkbtn" onClick={() => void amadeus.revealInFileManager(entry.path!)}>
            在文件管理器中显示
          </button>
        )}
        <button className="amx-db-linkbtn" onClick={() => void useDbStore.getState().reload(pagePath, target)}>重试</button>
      </div>
    )
  }
  return <DbTable dbRef={target} db={entry.data} pagePath={pagePath} />
}

function DbTable({ dbRef, db, pagePath }: { dbRef: string; db: DbFile; pagePath: string }) {
  const [sort, setSort] = useState<{ colId: string; dir: 'asc' | 'desc' } | null>(null)
  const [pop, setPop] = useState<Pop | null>(null)

  const m = (fn: (d: DbFile) => DbFile): void => useDbStore.getState().mutate(dbRef, fn)

  const setCell = (rowId: string, colId: string, v: CellValue | undefined): void =>
    m((d) => ({
      ...d,
      rows: d.rows.map((r) => {
        if (r.id !== rowId) return r
        const cells = { ...r.cells }
        if (v === undefined) delete cells[colId]
        else cells[colId] = v
        return { ...r, cells }
      }),
    }))
  const addRow = (): void => m((d) => ({ ...d, rows: [...d.rows, { id: dbId(), cells: {} }] }))
  const delRow = (rowId: string): void => m((d) => ({ ...d, rows: d.rows.filter((r) => r.id !== rowId) }))
  const addCol = (): void =>
    m((d) => ({ ...d, columns: [...d.columns, { id: dbId(), name: `列 ${d.columns.length + 1}`, type: 'text' }] }))
  const patchCol = (colId: string, patch: Partial<DbColumn>): void =>
    m((d) => ({ ...d, columns: d.columns.map((c) => (c.id === colId ? { ...c, ...patch } : c)) }))
  const delCol = (colId: string): void =>
    m((d) => ({
      ...d,
      columns: d.columns.filter((c) => c.id !== colId),
      rows: d.rows.map((r) => {
        if (!(colId in r.cells)) return r
        const cells = { ...r.cells }
        delete cells[colId]
        return { ...r, cells }
      }),
    }))
  const createOption = (colId: string, label: string): void =>
    m((d) => ({
      ...d,
      columns: d.columns.map((c) =>
        c.id === colId && !(c.options ?? []).includes(label) ? { ...c, options: [...(c.options ?? []), label] } : c,
      ),
    }))

  const setColSort = (colId: string, dir: 'asc' | 'desc' | null): void =>
    setSort(dir === null ? null : { colId, dir })

  // 仅视图态排序:不动文件里的 rows 顺序。
  const rows = useMemo(() => {
    if (!sort) return db.rows
    const col = db.columns.find((c) => c.id === sort.colId)
    if (!col) return db.rows
    const key = (r: DbRow): string | number => {
      const v = coerceForDisplay(r.cells[col.id], col.type)
      if (col.type === 'number') return typeof v === 'number' ? v : Number.NEGATIVE_INFINITY
      if (col.type === 'checkbox') return v === true ? 1 : 0
      return Array.isArray(v) ? v.join(', ') : String(v ?? '')
    }
    return [...db.rows].sort((a, b) => {
      const ka = key(a)
      const kb = key(b)
      const cmp = typeof ka === 'number' && typeof kb === 'number' ? ka - kb : String(ka).localeCompare(String(kb), 'zh')
      return sort.dir === 'asc' ? cmp : -cmp
    })
  }, [db, sort])

  const openPop = (e: ReactMouseEvent, p: Omit<Pop, 'x' | 'y'>): void => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setPop({ ...p, x: Math.min(r.left, window.innerWidth - 250), y: Math.min(r.bottom + 4, window.innerHeight - 260) })
  }

  const gridCols = `28px repeat(${db.columns.length}, minmax(140px, 1fr)) 36px`
  const popCol = pop ? db.columns.find((c) => c.id === pop.colId) : undefined
  const popRow = pop?.rowId ? db.rows.find((r) => r.id === pop.rowId) : undefined

  return (
    <div className="amx-db">
      <div className="amx-db-head">
        <span aria-hidden>𝄜</span>
        <input
          className="amx-db-name"
          value={db.name}
          placeholder="未命名数据库"
          onChange={(e) => m((d) => ({ ...d, name: e.target.value }))}
        />
        <span className="amx-db-count">{db.rows.length} 行</span>
      </div>

      {db.columns.length === 0 ? (
        <div className="amx-db-state">
          没有列。
          <button className="amx-db-linkbtn" onClick={addCol}>＋ 添加列</button>
        </div>
      ) : (
        <div className="amx-db-scroll">
          <div className="amx-db-row amx-db-hrow" style={{ gridTemplateColumns: gridCols }}>
            <div />
            {db.columns.map((col) => (
              <div className="amx-db-th" key={col.id}>
                <button className="amx-db-thbtn" onClick={(e) => openPop(e, { kind: 'colmenu', colId: col.id })} title={`${TYPE_META[col.type].label} · 点击打开列菜单`}>
                  <span className="amx-db-th-icon" aria-hidden>{TYPE_META[col.type].icon}</span>
                  <span className="amx-db-th-name">{col.name}</span>
                  {sort?.colId === col.id && <span className="amx-db-th-sort">{sort.dir === 'asc' ? '↑' : '↓'}</span>}
                </button>
              </div>
            ))}
            <button className="amx-db-addcol" onClick={addCol} title="添加列">＋</button>
          </div>

          {rows.map((row) => (
            <div className="amx-db-row" key={row.id} style={{ gridTemplateColumns: gridCols }}>
              <button className="amx-db-rowdel" onClick={() => delRow(row.id)} title="删除行" aria-label="delete row">✕</button>
              {db.columns.map((col) => (
                <div className="amx-db-cell" key={col.id}>
                  <Cell row={row} col={col} pagePath={pagePath} setCell={setCell} openOptions={(e) => openPop(e, { kind: 'options', colId: col.id, rowId: row.id })} />
                </div>
              ))}
              <div />
            </div>
          ))}

          <button className="amx-db-addrow" onClick={addRow}>＋ 新行</button>
        </div>
      )}

      {pop && popCol && pop.kind === 'colmenu' && (
        <PopShell x={pop.x} y={pop.y} onClose={() => setPop(null)}>
          <ColMenu
            col={popCol}
            sort={sort?.colId === popCol.id ? sort.dir : null}
            onSort={(dir) => { setColSort(popCol.id, dir); setPop(null) }}
            onRename={(name) => patchCol(popCol.id, { name })}
            onSetType={(type) => patchCol(popCol.id, { type })}
            onDelete={() => { delCol(popCol.id); setPop(null) }}
          />
        </PopShell>
      )}
      {pop && popCol && popRow && pop.kind === 'options' && (
        <PopShell x={pop.x} y={pop.y} onClose={() => setPop(null)}>
          <OptionPopover
            col={popCol}
            value={coerceForDisplay(popRow.cells[popCol.id], popCol.type)}
            multi={popCol.type === 'multiselect'}
            onPick={(label) => {
              setCell(popRow.id, popCol.id, label === '' ? undefined : label)
              setPop(null)
            }}
            onToggle={(label) => {
              const cur = coerceForDisplay(popRow.cells[popCol.id], 'multiselect') as string[]
              const next = cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label]
              setCell(popRow.id, popCol.id, next.length ? next : undefined)
            }}
            onCreate={(label) => {
              createOption(popCol.id, label)
              if (popCol.type === 'multiselect') {
                const cur = coerceForDisplay(popRow.cells[popCol.id], 'multiselect') as string[]
                if (!cur.includes(label)) setCell(popRow.id, popCol.id, [...cur, label])
              } else {
                setCell(popRow.id, popCol.id, label)
                setPop(null)
              }
            }}
          />
        </PopShell>
      )}
    </div>
  )
}

// ── 单元格(七类型) ──────────────────────────────────────────────────────────

const CELL_WIKI_RE = /(\[\[[^\]\n]+\]\])/

function Cell({
  row,
  col,
  pagePath,
  setCell,
  openOptions,
}: {
  row: DbRow
  col: DbColumn
  pagePath: string
  setCell: (rowId: string, colId: string, v: CellValue | undefined) => void
  openOptions: (e: ReactMouseEvent) => void
}) {
  const [editing, setEditing] = useState(false) // text 含 [[ ]] 时的展示/编辑切换 + url 编辑态
  const cancelRef = useRef(false)
  const v = coerceForDisplay(row.cells[col.id], col.type)

  /** [[目标]] 点击:linkTarget 剥 |别名 与 #锚点(与 Markdown 块同语义);已存在页面优先
   *  (v2.1 这类带点号页名不被误判为附件),未命中且带非 .md 扩展名才当附件系统打开。 */
  const openLink = (raw: string): void => {
    const t = linkTarget(raw)
    const st = usePageStore.getState()
    if (resolvePageName(t, st.pages)) return void st.openWikiLink(t.replace(/\.md$/i, ''))
    if (/\.[a-z0-9]{1,8}$/i.test(t) && !/\.md$/i.test(t)) return void amadeus.openAttachment(pagePath, t)
    st.openWikiLink(t.replace(/\.md$/i, ''))
  }

  switch (col.type) {
    case 'text': {
      const s = v as string
      // 含 [[链接]] 且非编辑态 → 富文本展示(链接可点);点击其余区域 / ✎ 进入编辑。
      if (!editing && CELL_WIKI_RE.test(s)) {
        return (
          <div className="amx-db-urlcell" onClick={() => setEditing(true)}>
            <span className="amx-db-richtext">
              {s.split(CELL_WIKI_RE).map((seg, i) => {
                const m = /^\[\[([^\]\n]+)\]\]$/.exec(seg)
                if (!m) return <span key={i}>{seg}</span>
                const inner = m[1]
                const label = (inner.split('|')[1] ?? inner.split('|')[0]).trim()
                return (
                  <button key={i} className="amx-db-wikilink" onClick={(e) => { e.stopPropagation(); openLink(inner) }} title={inner}>
                    {label}
                  </button>
                )
              })}
            </span>
            <button className="amx-db-edit" onClick={(e) => { e.stopPropagation(); setEditing(true) }} title="编辑" aria-label="edit cell">✎</button>
          </div>
        )
      }
      return (
        <input
          className="amx-db-input"
          autoFocus={editing || undefined}
          value={s}
          onChange={(e) => setCell(row.id, col.id, e.target.value === '' ? undefined : e.target.value)}
          onFocus={() => setEditing(true)}
          onBlur={() => setEditing(false)}
        />
      )
    }
    case 'number': {
      const n = v as number | null
      return (
        <input
          className="amx-db-input"
          type="number"
          inputMode="decimal"
          value={n ?? ''}
          onChange={(e) => {
            const s = e.target.value
            if (s === '') return setCell(row.id, col.id, undefined)
            const num = Number(s)
            if (Number.isFinite(num)) setCell(row.id, col.id, num)
          }}
        />
      )
    }
    case 'checkbox':
      return (
        <input
          className="amx-db-checkbox"
          type="checkbox"
          checked={v === true}
          onChange={(e) => setCell(row.id, col.id, e.target.checked ? true : undefined)}
        />
      )
    case 'date':
      return (
        <input
          className="amx-db-input"
          type="date"
          value={v as string}
          onChange={(e) => setCell(row.id, col.id, e.target.value === '' ? undefined : e.target.value)}
        />
      )
    case 'select': {
      const s = v as string
      return (
        <button className="amx-db-cellbtn" onClick={openOptions}>
          {s ? <span className="amx-db-chip">{s}</span> : <span className="amx-db-blank">空</span>}
        </button>
      )
    }
    case 'multiselect': {
      const arr = v as string[]
      return (
        <button className="amx-db-cellbtn" onClick={openOptions}>
          {arr.length ? arr.map((t) => <span key={t} className="amx-db-chip">{t}</span>) : <span className="amx-db-blank">空</span>}
        </button>
      )
    }
    case 'url': {
      const s = v as string
      if (editing) {
        const commit = (raw: string): void => {
          setEditing(false)
          if (cancelRef.current) { cancelRef.current = false; return }
          let t = raw.trim()
          // 形如域名(a.b)且无 scheme → 便利补 https://
          if (t && !/^[a-z][a-z0-9+.-]*:/i.test(t) && /^[\w-]+(\.[\w-]+)+/.test(t)) t = `https://${t}`
          setCell(row.id, col.id, t === '' ? undefined : t)
        }
        return (
          <input
            className="amx-db-input"
            autoFocus
            defaultValue={s}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              else if (e.key === 'Escape') { cancelRef.current = true; (e.target as HTMLInputElement).blur() }
            }}
          />
        )
      }
      // 只 linkify http(s)(恶意 scheme 双保险:这里不放行 + 主进程 windowOpenHandler 只放 http/https)
      const href = /^https?:\/\//i.test(s) ? s : ''
      return (
        <div className="amx-db-urlcell">
          {href ? (
            <a className="amx-db-url" href={href} target="_blank" rel="noreferrer" title={s}>{s}</a>
          ) : (
            <span className="amx-db-urltext">{s}</span>
          )}
          <button className="amx-db-edit" onClick={() => setEditing(true)} title="编辑链接" aria-label="edit url">✎</button>
        </div>
      )
    }
  }
}

// ── 弹层(fixed;点外关闭) ────────────────────────────────────────────────────

function PopShell({ x, y, onClose, children }: { x: number; y: number; onClose: () => void; children: ReactNode }) {
  // 关闭前先 blur 聚焦元素:React 同步卸载会赶在浏览器焦点转移前,被卸载的 input 不派发 blur,
  // ColMenu 重命名这类「onBlur 提交」的草稿会静默丢失——手动 blur 让 focusout 在卸载前发出。
  const close = (): void => {
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    onClose()
  }
  return (
    <div className="amx-db-popwrap" onMouseDown={close}>
      <div className="amx-db-pop" style={{ left: x, top: y }} onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

/** select / multiselect 共用:共享 column.options 选项池,底部输入回车就地新增。 */
function OptionPopover({
  col,
  value,
  multi,
  onPick,
  onToggle,
  onCreate,
}: {
  col: DbColumn
  value: CellValue
  multi: boolean
  onPick: (label: string) => void
  onToggle: (label: string) => void
  onCreate: (label: string) => void
}) {
  const [draft, setDraft] = useState('')
  const opts = col.options ?? []
  const selected = multi ? (value as string[]) : []
  return (
    <>
      <div className="amx-db-pop-sec">{multi ? '多选(点击切换)' : '选择一项'}</div>
      <div className="amx-db-pop-list">
        {opts.map((o) =>
          multi ? (
            <label key={o} className="amx-db-opt">
              <input type="checkbox" checked={selected.includes(o)} onChange={() => onToggle(o)} />
              <span className="amx-db-chip">{o}</span>
            </label>
          ) : (
            <button key={o} className="amx-db-opt" onClick={() => onPick(o)}>
              <span className="amx-db-chip">{o}</span>
              {value === o && <span className="amx-db-opt-check">✓</span>}
            </button>
          ),
        )}
        {opts.length === 0 && <div className="amx-db-blank">还没有选项,在下面输入并回车创建。</div>}
        {!multi && typeof value === 'string' && value !== '' && (
          <button className="amx-db-opt amx-db-opt-clear" onClick={() => onPick('')}>清空</button>
        )}
      </div>
      <input
        className="amx-db-pop-input"
        autoFocus
        placeholder="回车新增选项…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && draft.trim()) {
            onCreate(draft.trim())
            setDraft('')
          }
        }}
      />
    </>
  )
}

function ColMenu({
  col,
  sort,
  onSort,
  onRename,
  onSetType,
  onDelete,
}: {
  col: DbColumn
  sort: 'asc' | 'desc' | null
  onSort: (dir: 'asc' | 'desc' | null) => void
  onRename: (name: string) => void
  onSetType: (t: ColumnType) => void
  onDelete: () => void
}) {
  return (
    <>
      <input
        className="amx-db-pop-input"
        autoFocus
        defaultValue={col.name}
        onBlur={(e) => { const n = e.target.value.trim(); if (n && n !== col.name) onRename(n) }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      />
      <div className="amx-db-pop-sec">排序(仅视图,不改文件顺序)</div>
      <div className="amx-db-pop-list">
        <button className="amx-db-opt" onClick={() => onSort('asc')}>
          ↑ 升序{sort === 'asc' && <span className="amx-db-opt-check">✓</span>}
        </button>
        <button className="amx-db-opt" onClick={() => onSort('desc')}>
          ↓ 降序{sort === 'desc' && <span className="amx-db-opt-check">✓</span>}
        </button>
        {sort !== null && (
          <button className="amx-db-opt amx-db-opt-clear" onClick={() => onSort(null)}>清除排序</button>
        )}
      </div>
      <div className="amx-db-pop-sec">类型</div>
      <div className="amx-db-pop-list">
        {COLUMN_TYPES.map((t) => (
          <button key={t} className="amx-db-opt" onClick={() => onSetType(t)}>
            <span className="amx-db-th-icon" aria-hidden>{TYPE_META[t].icon}</span>
            {TYPE_META[t].label}
            {col.type === t && <span className="amx-db-opt-check">✓</span>}
          </button>
        ))}
      </div>
      <button className="amx-db-opt amx-db-opt-danger" onClick={onDelete}>删除列</button>
    </>
  )
}
