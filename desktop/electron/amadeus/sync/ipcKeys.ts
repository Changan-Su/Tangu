/** 云同步 IPC 通道(桌面专属,不进 @amadeus-shared/ipc 的三端契约)。 */
export const SYNC_IPC = {
  get: 'amadeus:sync:get',
  setEnabled: 'amadeus:sync:set-enabled',
  syncNow: 'amadeus:sync:now',
  status: 'amadeus:sync:status', // main → renderer 推送
  switchSide: 'amadeus:sync:switch-side', // 胶囊滑块 Local↔Cloud 全局切活动 vault
  collabCall: 'amadeus:collab:call', // 页面级共享/发布/presence 的主进程 HTTP 面(token 不下发)
  presence: 'amadeus:collab:presence', // main → renderer 在线名册推送
  // 按条目云同步(本地 vault 子集 ↔ 云端 <Vault名>/ 前缀)
  entryGet: 'amadeus:entry-sync:get',
  entryEnable: 'amadeus:entry-sync:enable',
  entryDisable: 'amadeus:entry-sync:disable',
  entryClosure: 'amadeus:entry-sync:closure',
  entryChange: 'amadeus:entry-sync:change', // main → renderer 注册表变更推送
} as const
