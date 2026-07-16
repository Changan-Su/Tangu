// Amadeus 编辑器「块级触发层」回归实测(slash 菜单 + #/-/1./>/[] 空格触发)。
// 这层 bug 纯靠肉眼/推演修了三轮都没修中,必须真浏览器驱动验证 —— 保留此脚本防复发。
//
// 用法:
//   1) desktop 仓:npm run web            (vite 起 http://localhost:5173,含 /harness.html)
//   2) 任意有 playwright-core 的目录:node <本文件路径>
//      chromium 路径默认取 ~/Library/Caches/ms-playwright 下最新版,可用 CHROMIUM_EXE 覆盖。
const fs = require('fs')
const os = require('os')
const path = require('path')
const { chromium } = require('playwright-core')

function findChromium() {
  if (process.env.CHROMIUM_EXE) return process.env.CHROMIUM_EXE
  const root = path.join(os.homedir(), 'Library/Caches/ms-playwright')
  const dirs = fs.readdirSync(root).filter((d) => d.startsWith('chromium-')).sort()
  for (const d of dirs.reverse()) {
    for (const app of ['Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', 'Chromium.app/Contents/MacOS/Chromium']) {
      const p = path.join(root, d, 'chrome-mac-arm64', app)
      if (fs.existsSync(p)) return p
    }
  }
  throw new Error('找不到 chromium,设 CHROMIUM_EXE 环境变量')
}

const URL = process.env.HARNESS_URL || 'http://localhost:5173/harness.html'
const results = []
function check(name, ok, detail) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`)
}

async function main() {
  const browser = await chromium.launch({ executablePath: findChromium(), headless: true })
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.md-block .ProseMirror', { timeout: 20000 })
  await page.waitForTimeout(400)

  const kinds = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.md-block')].map((b) => {
        const pm = b.querySelector('.ProseMirror')
        if (!pm) return null
        const el = pm.firstElementChild
        if (!el) return 'EMPTY'
        const t = el.tagName
        if (t === 'UL' || t === 'OL') {
          const li = el.querySelector('li')
          return t + (li && li.getAttribute('data-item-type') === 'task' ? ':task' : '')
        }
        return t
      })
    )
  const texts = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.md-block')].map((b) => {
        const pm = b.querySelector('.ProseMirror')
        return pm ? pm.textContent : null
      })
    )

  await page.locator('.md-block .ProseMirror').last().click()

  // T1: 空块 slash → 标题2
  await page.keyboard.type('/', { delay: 50 })
  await page.waitForTimeout(250)
  check('T1 slash 菜单打开', (await page.locator('.slash-menu').count()) === 1)
  await page.keyboard.type('h2', { delay: 60 })
  await page.waitForTimeout(150)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(700)
  let k = await kinds(), t = await texts()
  check('T1 空块 /h2 → H2', k[0] === 'H2', `kind=${k[0]}`)
  check('T1 无 "/" 残留', !(t[0] || '').includes('/'), `text=${JSON.stringify(t[0])}`)
  check('T1 不新建多余块', k.length === 1, `blocks=${k.length}`)

  // T2: 标题重设级别(设级非叠加)
  await page.keyboard.type('Hello', { delay: 30 })
  await page.waitForTimeout(500)
  await page.keyboard.press('Meta+ArrowLeft')
  await page.keyboard.type('# ', { delay: 60 })
  await page.waitForTimeout(500)
  k = await kinds(); t = await texts()
  check('T2 h2 上 "# " → H1', k[0] === 'H1', `kind=${k[0]}`)
  check('T2 文本不带 #', t[0] === 'Hello', `text=${JSON.stringify(t[0])}`)
  await page.keyboard.press('Meta+ArrowLeft')
  await page.keyboard.type('### ', { delay: 60 })
  await page.waitForTimeout(500)
  k = await kinds(); t = await texts()
  check('T2 h1 上 "### " → H3', k[0] === 'H3', `kind=${k[0]}`)
  check('T2 文本仍是 Hello', t[0] === 'Hello', `text=${JSON.stringify(t[0])}`)

  // T2b: 标题行上 "- " → 列表(先降段落再转,Notion 语义)
  await page.keyboard.press('Meta+ArrowLeft')
  await page.keyboard.type('- ', { delay: 60 })
  await page.waitForTimeout(400)
  k = await kinds(); t = await texts()
  check('T2b h3 上 "- " → UL', k[0] === 'UL', `kind=${k[0]}`)
  check('T2b 文本仍是 Hello', (t[0] || '').trim() === 'Hello', `text=${JSON.stringify(t[0])}`)

  // T3-T6: 段落上四种前缀
  await page.keyboard.press('Meta+ArrowRight')
  await page.keyboard.press('Shift+Enter')
  await page.waitForTimeout(400)
  await page.keyboard.type('- ', { delay: 60 })
  await page.waitForTimeout(400)
  await page.keyboard.type('item', { delay: 30 })
  await page.waitForTimeout(500)
  k = await kinds(); t = await texts()
  check('T3 "- " → UL', k[1] === 'UL', `kind=${k[1]}`)
  check('T3 文本干净', t[1] === 'item', `text=${JSON.stringify(t[1])}`)

  await page.keyboard.press('Shift+Enter')
  await page.waitForTimeout(400)
  await page.keyboard.type('1. ', { delay: 60 })
  await page.waitForTimeout(400)
  await page.keyboard.type('one', { delay: 30 })
  await page.waitForTimeout(500)
  k = await kinds()
  check('T4 "1. " → OL', k[2] === 'OL', `kind=${k[2]}`)

  await page.keyboard.press('Shift+Enter')
  await page.waitForTimeout(400)
  await page.keyboard.type('> ', { delay: 60 })
  await page.waitForTimeout(400)
  await page.keyboard.type('quote', { delay: 30 })
  await page.waitForTimeout(500)
  k = await kinds()
  check('T5 "> " → BLOCKQUOTE', k[3] === 'BLOCKQUOTE', `kind=${k[3]}`)

  await page.keyboard.press('Shift+Enter')
  await page.waitForTimeout(400)
  await page.keyboard.type('[] ', { delay: 60 })
  await page.waitForTimeout(400)
  await page.keyboard.type('todo', { delay: 30 })
  await page.waitForTimeout(500)
  k = await kinds(); t = await texts()
  check('T6 "[] " → 待办', k[4] === 'UL:task', `kind=${k[4]}, text=${JSON.stringify(t[4])}`)

  // T7: 非空块快速 slash(120ms < 200ms debounce,压竞态;'/' 需行首或空格后)
  await page.keyboard.press('Shift+Enter')
  await page.waitForTimeout(400)
  await page.keyboard.type('abc ', { delay: 10 })
  await page.keyboard.type('/', { delay: 10 })
  await page.waitForTimeout(120)
  await page.keyboard.type('h1', { delay: 10 })
  await page.keyboard.press('Enter')
  await page.waitForTimeout(800)
  k = await kinds(); t = await texts()
  check('T7 快速 /h1 → H1 且文本保住', k[5] === 'H1' && (t[5] || '').trim() === 'abc', `kind=${k[5]}, text=${JSON.stringify(t[5])}`)
  check('T7 无 "/" 残留', !(t[5] || '').includes('/'), `text=${JSON.stringify(t[5])}`)

  // T8: 嵌入类(数据库,无 bridge 创建必失败)也必须消费 '/'
  await page.keyboard.press('Meta+ArrowRight')
  await page.keyboard.press('Shift+Enter')
  await page.waitForTimeout(400)
  await page.keyboard.type('x /', { delay: 40 })
  await page.waitForTimeout(250)
  await page.locator('.slash-item').filter({ hasText: '数据库' }).filter({ hasNotText: '链接' }).first().click()
  await page.waitForTimeout(800)
  t = await texts()
  check('T8 选嵌入类后 "/" 被消费', (t[6] || '').trim() === 'x', `text=${JSON.stringify(t[6])}`)

  const fails = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - fails}/${results.length} passed, ${fails} failed`)
  await browser.close()
  process.exit(fails ? 1 : 0)
}

main().catch((e) => {
  console.error('SCRIPT ERROR:', e)
  process.exit(1)
})
