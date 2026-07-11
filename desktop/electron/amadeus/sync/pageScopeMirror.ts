/**
 * 页面级共享范围规则 —— server/microserver/amadeus/lib/pageScope.ts 的镜像拷贝
 * (桌面不 import server 代码;规则改动须两处同步:根页 + <stem>.fd/** + 同目录 .amadeus/** 二进制)。
 */

export interface PageScope {
  root: string
  fdPrefix: string
  assetPrefix: string
}

export function pageScopeOf(rootPath: string): PageScope {
  const stem = rootPath.replace(/\.md$/i, '')
  const i = rootPath.lastIndexOf('/')
  const dir = i < 0 ? '' : rootPath.slice(0, i)
  return {
    root: rootPath,
    fdPrefix: `${stem}.fd/`,
    assetPrefix: dir ? `${dir}/.amadeus/` : '.amadeus/',
  }
}

export function inPageScope(scope: PageScope, path: string, kind: string): boolean {
  if (path === scope.root) return true
  if (path.startsWith(scope.fdPrefix) || `${path}/` === scope.fdPrefix) return true
  if (kind === 'binary' && path.startsWith(scope.assetPrefix)) return true
  if (kind === 'folder' && (`${path}/` === scope.assetPrefix || path.startsWith(scope.assetPrefix))) return true
  return false
}
