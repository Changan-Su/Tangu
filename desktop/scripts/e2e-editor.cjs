// 一键跑编辑器触发层 e2e:自起 vite(frontend web 模式)→ 等 harness 就绪 → 跑断言 → 收尾。
// 5173 已有人服务 harness 时直接复用(不杀别人的进程)。用法:npm run e2e:editor
const http = require('http')
const path = require('path')
const { spawn } = require('child_process')

const URL = 'http://localhost:5173/harness.html'

function ping() {
  return new Promise((res) => {
    const req = http.get(URL, (r) => {
      res(r.statusCode === 200)
      r.resume()
    })
    req.on('error', () => res(false))
    req.setTimeout(1500, () => {
      req.destroy()
      res(false)
    })
  })
}

async function main() {
  let vite = null
  if (!(await ping())) {
    vite = spawn('npx', ['vite', 'frontend'], {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'ignore',
    })
    let up = false
    for (let i = 0; i < 40 && !up; i++) {
      await new Promise((r) => setTimeout(r, 500))
      up = await ping()
    }
    if (!up) {
      console.error('vite 没起来(5173 被非 harness 进程占用,或 frontend/vite.config.ts 有问题)')
      vite.kill()
      process.exit(1)
    }
  }
  const e2e = spawn('node', [path.join(__dirname, 'editor-triggers.e2e.cjs')], { stdio: 'inherit' })
  e2e.on('exit', (code) => {
    if (vite) vite.kill()
    process.exit(code ?? 1)
  })
}

main()
