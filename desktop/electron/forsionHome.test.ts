/** ~/.tangu → ~/.forsion 迁移:改名/兼容软链/并存保守/幂等。 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, lstatSync, realpathSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migratePair } from './forsionHome'

const noop = (): void => {}
const setup = (): { old: string; nu: string } => {
  const root = mkdtempSync(join(tmpdir(), 'fh-'))
  return { old: join(root, '.tangu'), nu: join(root, '.forsion') }
}

describe('migratePair', () => {
  it('真目录改名 + 旧位留软链,内容无损', () => {
    const { old, nu } = setup()
    mkdirSync(join(old, 'skills'), { recursive: true })
    writeFileSync(join(old, 'config.json'), '{"a":1}')
    migratePair(old, nu, { log: noop })
    expect(readFileSync(join(nu, 'config.json'), 'utf8')).toBe('{"a":1}')
    expect(lstatSync(old).isSymbolicLink()).toBe(true)
    expect(realpathSync(join(old, 'skills'))).toBe(realpathSync(join(nu, 'skills'))) // 旧路径经链可达
  })

  it('全新用户(两处皆无):ensureNew 建新目录并补链;不 ensureNew 则不动', () => {
    const a = setup()
    migratePair(a.old, a.nu, { ensureNew: true, log: noop })
    expect(existsSync(a.nu)).toBe(true)
    expect(lstatSync(a.old).isSymbolicLink()).toBe(true)
    const b = setup()
    migratePair(b.old, b.nu, { log: noop })
    expect(existsSync(b.nu)).toBe(false)
    expect(existsSync(b.old)).toBe(false)
  })

  it('并存(两边都是真目录):保守不动、不建链', () => {
    const { old, nu } = setup()
    mkdirSync(old, { recursive: true }); writeFileSync(join(old, 'x'), '1')
    mkdirSync(nu, { recursive: true }); writeFileSync(join(nu, 'y'), '2')
    migratePair(old, nu, { log: noop })
    expect(lstatSync(old).isDirectory() && !lstatSync(old).isSymbolicLink()).toBe(true)
    expect(existsSync(join(old, 'x')) && existsSync(join(nu, 'y'))).toBe(true)
  })

  it('幂等:迁移后再跑不变形', () => {
    const { old, nu } = setup()
    mkdirSync(old, { recursive: true }); writeFileSync(join(old, 'z'), '3')
    migratePair(old, nu, { ensureNew: true, log: noop })
    migratePair(old, nu, { ensureNew: true, log: noop })
    expect(lstatSync(old).isSymbolicLink()).toBe(true)
    expect(readFileSync(join(nu, 'z'), 'utf8')).toBe('3')
  })
})
