/**
 * Tangu Mobile 入口:先装垫片(异步:native 读 Preferences token / web 读 localStorage),就绪后再
 * 动态 import 移动启动模块。动态 import 保证「垫片先于渲染层求值」。
 * 注意:不 import '@/main'(那是 desktop 的 Dockview 外壳启动);移动端走自己的 mobileEntry。
 *
 * Amadeus 桥按持久化模式二选一(本地 Capacitor vault / 云端 vault 直连,后者复用 web 的
 * cloudBridge 全管道:SSE 实时/回收站/白板合并/presence)。window.amadeus 必须在渲染层模块被
 * import 之前定型(amadeus/api.ts 模块求值即捕获)—— 故装配放在 shim 就绪后、mobileEntry 之前;
 * 切换 = 写模式键 + location.reload()(见 window.amadeusVaultMode,VaultSideSwitch 据此渲染胶囊)。
 */
import { installMobileShim } from './mobileShim'
import { createMobileAmadeusBridge } from './amadeus/mobileAmadeusBridge'
import { createCloudAmadeusBridge, setCloudNotify } from '@webamadeus/cloudBridge'
import { installCloudCollab } from '@webamadeus/cloudCollab'

const VAULT_MODE_KEY = 'amadeus_vault_mode' // 'cloud'(缺省,移动端主打云客户端) | 'local'(显式选过才本地)
const vaultMode = (): 'local' | 'cloud' => {
  try {
    return localStorage.getItem(VAULT_MODE_KEY) === 'local' ? 'local' : 'cloud'
  } catch {
    return 'cloud'
  }
}

void installMobileShim().then(async (ok) => {
  if (!ok) return // 未就绪:已发起登录(native 开系统浏览器 / web 跳 /auth),不挂载。
  const cfg = await (window as unknown as {
    tangu: { getConfig(): Promise<{ backendUrl: string; token: string }> }
  }).tangu.getConfig()
  const getToken = (): string => cfg.token
  const mode = vaultMode()
  if (mode === 'cloud') {
    ;(window as unknown as { amadeus: unknown }).amadeus = createCloudAmadeusBridge({
      apiBase: cfg.backendUrl,
      getToken,
      onAuthError: () => {
        void (window as unknown as { tangu?: { forsionLogout?: () => Promise<void> } }).tangu?.forsionLogout?.()
      },
    })
    installCloudCollab({ apiBase: cfg.backendUrl, getToken })
  } else {
    // 本地 Capacitor vault;cfg 供 fetchLinkMeta(书签卡 server 代理)/searchImages。
    ;(window as unknown as { amadeus: unknown }).amadeus = createMobileAmadeusBridge({
      apiBase: () => cfg.backendUrl,
      getToken,
    })
  }
  ;(window as unknown as { amadeusVaultMode?: unknown }).amadeusVaultMode = {
    side: mode,
    switch: (next: 'local' | 'cloud') => {
      if (next === mode) return
      try {
        localStorage.setItem(VAULT_MODE_KEY, next)
      } catch {
        /* private mode */
      }
      location.reload()
    },
  }
  await import('./mobileEntry')
  // 云端桥提示(保存冲突/仅桌面可用…)接应用 toast(web main 同款,appStore 到位后)。
  const { useApp } = await import('@/stores/appStore')
  setCloudNotify((text, isError) => useApp.getState().toast(text, isError))
})
