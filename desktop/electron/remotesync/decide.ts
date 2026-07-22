/**
 * 三方对账纯决策(Forsion 自研,与 electron/amadeus/sync/reconcile.ts 的 decide 同源思想,
 * 适配哑后端:远端无 seq,身份 = etag / mtime+size;见 NOTICE.md 合规边界)。
 *
 * 视角:local = 本地内容 hash;prev = 上次收敛基线 {本地 hash, 远端身份};remote = 远端身份。
 * 语义要点:
 *  - 无基线且两侧都有 → 'join'(首次合流,引擎按字节比对定 adopt / 冲突副本)
 *  - 删除必须有基线佐证;编辑赢过删除(一侧删一侧改 → 恢复改的那侧)
 *  - 双侧都改 → 'conflict'(引擎:本地版存冲突副本,远端版落原路径,多设备一轮收敛)
 */

export type LocalView = { h: string } | null
export type PrevView = { h: string; r: string } | null
export type RemoteView = { id: string } | null

export type Decision =
  | 'noop'
  | 'push'
  | 'pull'
  | 'pushDelete'
  | 'deleteLocal'
  | 'join'
  | 'conflict'
  | 'forget'

export function decide(local: LocalView, prev: PrevView, remote: RemoteView): Decision {
  if (!prev) {
    if (local && remote) return 'join'
    if (local) return 'push'
    if (remote) return 'pull'
    return 'noop'
  }
  const localChanged = !local || local.h !== prev.h
  const remoteChanged = !remote || remote.id !== prev.r
  if (!localChanged && !remoteChanged) return 'noop'
  if (localChanged && !remoteChanged) return local ? 'push' : 'pushDelete'
  if (!localChanged && remoteChanged) return remote ? 'pull' : 'deleteLocal'
  if (!local && !remote) return 'forget'
  if (!local) return 'pull' // 本地删 vs 远端改:编辑赢,拉回
  if (!remote) return 'push' // 远端删 vs 本地改:编辑赢,推回
  return 'conflict'
}
