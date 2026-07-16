import { beforeEach, describe, expect, it } from 'vitest'
import { useCalendarConfig, memberOf, isMigrated } from './calendarConfigStore'

const V = '/vault'
const st = () => useCalendarConfig.getState()
const bv = () => useCalendarConfig.getState().byVault

beforeEach(() => useCalendarConfig.setState({ byVault: {} }))

describe('calendarConfigStore 成员制 + 迁移', () => {
  it('addMember / memberOf round-trip(checkbox 可选)', () => {
    st().addMember(V, 'a.db', 'dcol', 'ccol')
    expect(memberOf(V, bv(), 'a.db')).toEqual({ dateCol: 'dcol', checkboxCol: 'ccol' })
    st().addMember(V, 'b.db', 'd2')
    expect(memberOf(V, bv(), 'b.db')).toEqual({ dateCol: 'd2' })
  })

  it('removeMember 撤成员(不动别的库)', () => {
    st().addMember(V, 'a.db', 'd')
    st().addMember(V, 'b.db', 'd')
    st().removeMember(V, 'a.db')
    expect(memberOf(V, bv(), 'a.db')).toBeUndefined()
    expect(memberOf(V, bv(), 'b.db')).toEqual({ dateCol: 'd' })
  })

  it('migrate:补缺失 + 不覆盖显式成员 + 幂等置 flag', () => {
    st().addMember(V, 'explicit.db', 'chosen') // 用户已显式配好
    st().migrate(V, [
      { dbPath: 'explicit.db', dateCol: 'auto', checkboxCol: 'x' }, // 不该覆盖用户选择
      { dbPath: 'legacy.db', dateCol: 'ld', checkboxCol: 'lc' },
    ])
    expect(memberOf(V, bv(), 'explicit.db')).toEqual({ dateCol: 'chosen' })
    expect(memberOf(V, bv(), 'legacy.db')).toEqual({ dateCol: 'ld', checkboxCol: 'lc' })
    expect(isMigrated(V, bv())).toBe(true)
    // 二次迁移 no-op:新库不再自动收编(之后全靠显式添加)
    st().migrate(V, [{ dbPath: 'late.db', dateCol: 'x' }])
    expect(memberOf(V, bv(), 'late.db')).toBeUndefined()
  })

  it('migratePath 迁移成员键(改名不丢配置)', () => {
    st().addMember(V, 'old.db', 'd', 'c')
    st().migratePath(V, 'old.db', 'new.db')
    expect(memberOf(V, bv(), 'old.db')).toBeUndefined()
    expect(memberOf(V, bv(), 'new.db')).toEqual({ dateCol: 'd', checkboxCol: 'c' })
  })

  it('旧持久数据无 members 键不崩', () => {
    useCalendarConfig.setState({ byVault: { [V]: { colors: {}, hidden: [], defaultDbPath: null } as never } })
    expect(memberOf(V, bv(), 'x.db')).toBeUndefined()
    st().addMember(V, 'x.db', 'd')
    expect(memberOf(V, bv(), 'x.db')).toEqual({ dateCol: 'd' })
  })
})
