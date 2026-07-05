/**
 * electron-builder beforeBuild 钩子:打包前按目标 (platform, arch) 拉取内置 Python 到 build/python。
 * beforeBuild 早于 pack(extraResources 拷贝)执行,故此处下好后 extraResources 的 build/python 才有内容。
 * CI 每个 matrix 行只构建单一 arch(--mac --arm64 / --win / --linux),context.arch 即目标 arch。
 * 返回 undefined:保留 electron-builder 默认依赖处理(不 return false)。
 */
const { fetchPython } = require('./fetch-python.cjs');

exports.default = async function beforeBuild(context) {
  const productId = process.env.FORSION_PRODUCT || 'forsion';
  const product = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'products', `${productId}.json`), 'utf8'));
  if (!product.agentBackend) return; // 本变体不捆后端 → 不拉内置 Python
  const platformName = context.platform.nodeName; // 'darwin' | 'win32' | 'linux'
  const archName = context.arch;                   // 'x64' | 'arm64' | 'armv7l'
  await fetchPython({ platformName, archName });
};
