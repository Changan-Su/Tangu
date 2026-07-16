/** excalidraw 的字体默认从 CDN(esm.sh)现拉,而本 App 的 CSP 是 default-src 'self' 且桌面端得离线可用
 *  → 必须自托管。把 dist/prod/fonts 拷进 renderer 的 publicDir(vite 会原样带进 out/renderer),
 *  运行时 EXCALIDRAW_ASSET_PATH 指向它(见 ExcalidrawEmbed.tsx)。
 *  照 build/python 的先例:体积大、可从 node_modules 再生 → 不入库(仓根 .gitignore 已挡)。
 *  postinstall 跑;按版本号戳幂等,版本没变就跳过这 13M 的拷贝。 */
const fs = require('fs')
const path = require('path')

const pkgDir = path.join(__dirname, '..', 'node_modules', '@excalidraw', 'excalidraw')
const outDir = path.join(__dirname, '..', 'frontend', 'public', 'excalidraw')
const stamp = path.join(outDir, '.version')

let version
try {
  version = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version
} catch {
  console.warn('[excalidraw-assets] 未安装 @excalidraw/excalidraw,跳过')
  process.exit(0)
}

try {
  if (fs.readFileSync(stamp, 'utf8') === version) process.exit(0) // 已是当前版本
} catch {
  /* 无戳 / 读不动 → 重拷 */
}

fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })
fs.cpSync(path.join(pkgDir, 'dist', 'prod', 'fonts'), path.join(outDir, 'fonts'), { recursive: true })
fs.writeFileSync(stamp, version)
console.log('[excalidraw-assets] fonts', version, '->', outDir)
