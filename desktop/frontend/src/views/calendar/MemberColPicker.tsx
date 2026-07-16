/** 选日期列(必)+ 完成勾选列(可选);「加入日历 / 改列映射」共用(右栏 + DB 视图设置)。 */
import { useState } from 'react'
import type { DbColumn } from '@amadeus-shared/db/schema'
import { isDateCol, isCheckboxCol } from '../../amadeus/store/dbAggregateStore'
import type { CalMember } from '../../amadeus/store/calendarConfigStore'

export function MemberColPicker({ dbName, columns, initial, onConfirm, onCancel }: {
  dbName: string
  columns: DbColumn[]
  initial?: CalMember
  onConfirm: (dateCol: string, checkboxCol?: string) => void
  onCancel: () => void
}) {
  const dateCols = columns.filter(isDateCol)
  const checkCols = columns.filter(isCheckboxCol)
  const [dateCol, setDateCol] = useState(initial?.dateCol ?? dateCols[0]?.id ?? '')
  const [checkCol, setCheckCol] = useState(initial?.checkboxCol ?? '')
  return (
    <div className="amx-calpick">
      <div className="amx-calpick-title">{dbName}</div>
      <label className="amx-calpick-row">
        <span>日期属性 *</span>
        <select value={dateCol} onChange={(e) => setDateCol(e.target.value)}>
          {dateCols.length === 0 && <option value="">该库没有日期列</option>}
          {dateCols.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label className="amx-calpick-row">
        <span>完成勾选</span>
        <select value={checkCol} onChange={(e) => setCheckCol(e.target.value)}>
          <option value="">不设(纯日历)</option>
          {checkCols.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <div className="amx-calpick-actions">
        <button className="amx-db-opt" onClick={onCancel}>取消</button>
        <button className="amx-calpick-ok" disabled={!dateCol} onClick={() => onConfirm(dateCol, checkCol || undefined)}>确定</button>
      </div>
    </div>
  )
}
