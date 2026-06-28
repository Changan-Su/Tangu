import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { isValidThemeId, readThemesDir, seedDefaultThemes } from './themes'

describe('isValidThemeId', () => {
  it('accepts kebab/lowercase ids', () => {
    expect(isValidThemeId('soft')).toBe(true)
    expect(isValidThemeId('my-theme-2')).toBe(true)
  })
  it('rejects reserved lovable + illegal ids (防 data-theme/元素 id 注入)', () => {
    expect(isValidThemeId('lovable')).toBe(false)
    expect(isValidThemeId('Bad_Name')).toBe(false)
    expect(isValidThemeId('../evil')).toBe(false)
    expect(isValidThemeId('a b')).toBe(false)
    expect(isValidThemeId('')).toBe(false)
  })
})

describe('readThemesDir', () => {
  let dir: string
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'tangu-themes-')) })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

  const writeTheme = async (id: string, json: string, css = 'x{}'): Promise<void> => {
    const d = join(dir, id)
    await mkdir(d, { recursive: true })
    await writeFile(join(d, 'theme.json'), json)
    await writeFile(join(d, 'theme.css'), css)
  }

  it('returns valid themes and forces manifest.id to the folder name', async () => {
    await writeTheme('good', JSON.stringify({ id: 'whatever', name: 'Good' }), 'body{color:red}')
    const out = await readThemesDir(dir)
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('good')
    expect(out[0].manifest.id).toBe('good') // 目录名压过 json 里的 id
    expect(out[0].css).toBe('body{color:red}')
  })

  it('skips bad JSON, illegal ids, and the reserved lovable — without throwing', async () => {
    await writeTheme('good', JSON.stringify({ name: 'Good' }))
    await writeTheme('broken', '{ not json')                        // 坏 json
    await writeTheme('lovable', JSON.stringify({ name: 'Hijack' })) // 保留字
    await writeTheme('Bad_Name', JSON.stringify({ name: 'Nope' }))  // 非法 id
    const out = await readThemesDir(dir)
    expect(out.map((t) => t.id)).toEqual(['good'])
  })

  it('skips a theme missing theme.css', async () => {
    await mkdir(join(dir, 'nocss'), { recursive: true })
    await writeFile(join(dir, 'nocss', 'theme.json'), JSON.stringify({ name: 'NoCss' }))
    expect(await readThemesDir(dir)).toHaveLength(0)
  })

  it('returns empty for a missing directory (no throw)', async () => {
    expect(await readThemesDir(join(dir, 'does-not-exist'))).toEqual([])
  })
})

describe('seedDefaultThemes', () => {
  let base: string
  beforeEach(async () => { base = await mkdtemp(join(tmpdir(), 'tangu-seed-')) })
  afterEach(async () => { await rm(base, { recursive: true, force: true }) })

  it('seeds soft when themes dir is absent, then is a no-op when present', async () => {
    const themes = join(base, 'themes')
    await seedDefaultThemes(themes)
    const first = await readThemesDir(themes)
    expect(first.map((t) => t.id)).toContain('soft')
    expect(first.find((t) => t.id === 'soft')!.manifest.panelGap).toBe(8)

    // 用户删掉 soft 后再次启动:themes/ 目录已存在 → 不重种(文件夹归用户)
    await rm(join(themes, 'soft'), { recursive: true, force: true })
    await seedDefaultThemes(themes)
    expect(await readThemesDir(themes)).toHaveLength(0)
  })
})
