/**
 * 下载 python-build-standalone(可重定位的独立 CPython)到 desktop/build/python,
 * 供 electron-builder extraResources 打进安装包 → 用户免装 Python、且与系统 Python 隔离。
 *
 *  - 由 build/beforeBuild.cjs 在打包前按目标 (platform, arch) 调用;也可 `node build/fetch-python.cjs` 手动跑。
 *  - 版本不写死:查 astral-sh/python-build-standalone 最新 release,挑匹配三元组的 `install_only` 资产。
 *  - 解压用系统 tar(三平台 runner 均自带,含 Windows 的 bsdtar);tar 自动识别 gzip。
 *  - 失败**硬报错**(不静默降级):宁可构建失败,也不发一个「号称内置 Python 却没带」的包。
 *    逃生阀 TANGU_SKIP_FETCH_PYTHON=1(仅打包非 Python 形态时);跳过时建空目录避免 extraResources 缺 from 报错。
 */
const { existsSync, mkdirSync, rmSync, writeFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const REPO = 'astral-sh/python-build-standalone';
// 优先内置的 Python 小版本(wheel 覆盖广、稳定);逐级回退。
const PY_MINORS = ['3.12', '3.13', '3.11'];

/** (platform, arch) → python-build-standalone 的目标三元组。 */
function tripleFor(platformName, archName) {
  const key = `${platformName}:${archName}`;
  const map = {
    'darwin:arm64': 'aarch64-apple-darwin',
    'darwin:x64': 'x86_64-apple-darwin',
    'win32:x64': 'x86_64-pc-windows-msvc',
    'win32:arm64': 'aarch64-pc-windows-msvc',
    'linux:x64': 'x86_64-unknown-linux-gnu',
    'linux:arm64': 'aarch64-unknown-linux-gnu',
  };
  const t = map[key];
  if (!t) throw new Error(`[fetch-python] 不支持的目标: ${key}`);
  return t;
}

/** build/ 目录(本脚本所在目录)。 */
const buildDir = () => __dirname;
/** 最终落点:build/python(tar 顶层目录就叫 python)。 */
const pythonDir = () => path.join(buildDir(), 'python');

async function ghJson(url) {
  const headers = { 'User-Agent': 'tangu-build', Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`[fetch-python] GitHub API ${r.status} @ ${url}`);
  return r.json();
}

/** 在 assets 里挑匹配三元组的 install_only tar.gz(优先 PY_MINORS 顺序)。 */
function pickAsset(assets, triple) {
  for (const minor of PY_MINORS) {
    const re = new RegExp(`^cpython-${minor.replace('.', '\\.')}\\.\\d+\\+\\d+-${triple}-install_only\\.tar\\.gz$`);
    const hit = assets.find((a) => re.test(a.name));
    if (hit) return hit;
  }
  return null;
}

async function fetchPython({ platformName, archName }) {
  const dest = pythonDir();
  if (process.env.TANGU_SKIP_FETCH_PYTHON) {
    console.log('[fetch-python] TANGU_SKIP_FETCH_PYTHON set → 跳过下载(建空目录占位)');
    mkdirSync(dest, { recursive: true });
    writeFileSync(path.join(dest, '.skipped'), 'python bundle skipped\n');
    return dest;
  }
  const triple = tripleFor(platformName, archName);
  const release = await ghJson(`https://api.github.com/repos/${REPO}/releases/latest`);
  const asset = pickAsset(release.assets || [], triple);
  if (!asset) throw new Error(`[fetch-python] 最新 release 里找不到 ${triple} 的 install_only 资产(尝试 ${PY_MINORS.join('/')})`);

  console.log(`[fetch-python] ${asset.name}  (release ${release.tag_name})`);
  const r = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'tangu-build' } });
  if (!r.ok) throw new Error(`[fetch-python] 下载失败 HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const tmp = path.join(buildDir(), asset.name);
  writeFileSync(tmp, buf);

  rmSync(dest, { recursive: true, force: true }); // 换 arch 重跑:先清旧
  // tar 自动识别 gzip(GNU tar / Windows bsdtar 均可);顶层目录名为 python → 落到 build/python。
  execFileSync('tar', ['-xf', tmp, '-C', buildDir()], { stdio: 'inherit' });
  rmSync(tmp, { force: true });
  if (!existsSync(dest)) throw new Error(`[fetch-python] 解压后未见 ${dest}`);
  console.log(`[fetch-python] ✓ ${dest}`);
  return dest;
}

module.exports = { fetchPython, pythonDir };

// CLI:node build/fetch-python.cjs [platform] [arch](缺省=本机)
if (require.main === module) {
  fetchPython({ platformName: process.argv[2] || process.platform, archName: process.argv[3] || process.arch })
    .catch((e) => { console.error(e.message || e); process.exit(1); });
}
