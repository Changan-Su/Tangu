// Tiny persisted config in the app's userData dir — remembers the last vault & page
// so Amadeus reopens where you left off.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { isDevMode } from '../forsionHome'

export interface AmadeusCloudSyncConfig {
  /** 缺省视为启用(登录即同步);仅显式 false 停用。 */
  enabled?: boolean
  /** 云端 vault id(首次启用时解析并固定)。 */
  vaultId?: string
  /** 回声抑制用设备标识(X-Amadeus-Client)。 */
  deviceId?: string
}

export interface AmadeusConfig {
  /** 当前活动 vault 根(= 渲染端所见;agent 的 amadeus_* 工具实时跟随它)。 */
  lastVault?: string
  /** 最近一次的「本地侧」vault 根;活动侧切到云镜像时靠它切回来。 */
  localVault?: string
  lastPage?: string
  cloudSync?: AmadeusCloudSyncConfig
}

let cache: AmadeusConfig | null = null

function configFile(): string {
  // dev(未打包)与正式版分用不同配置文件:dev 永不继承正式版历史写入的 lastVault,
  // 两边 Amadeus vault 彻底隔离(dev→~/Forsion-Dev/Amadeus,正式版→~/Forsion/Amadeus)。
  return path.join(app.getPath('userData'), isDevMode() ? 'amadeus-config.dev.json' : 'amadeus-config.json')
}

/** Absolute path of the persisted Amadeus config (lastVault/lastPage). The agent's
 *  amadeus_* tools read `lastVault` from here live, so they follow the desktop's
 *  actual current vault (custom paths + runtime vault switching). */
export function amadeusConfigPath(): string {
  return configFile()
}

export async function readConfig(): Promise<AmadeusConfig> {
  if (cache) return cache
  try {
    cache = JSON.parse(await fs.readFile(configFile(), 'utf8')) as AmadeusConfig
  } catch {
    cache = {}
  }
  return cache
}

export async function writeConfig(patch: Partial<AmadeusConfig>): Promise<void> {
  const next = { ...(await readConfig()), ...patch }
  cache = next
  try {
    await fs.writeFile(configFile(), JSON.stringify(next, null, 2), 'utf8')
  } catch {
    /* best-effort */
  }
}
