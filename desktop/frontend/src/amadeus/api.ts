// Thin typed access to the preload bridge (window.amadeus).
import type { AmadeusApi } from '@amadeus-shared/ipc'

// 顶层不许裸读 window:聊天侧(Composer/气泡)静态引 pageStore 后,纯逻辑测试(node 环境)
// 会沿 import 链拉到本文件,module load 即炸。浏览器里行为不变。
export const amadeus: AmadeusApi = (typeof window === 'undefined' ? undefined : window.amadeus) as AmadeusApi
