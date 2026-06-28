import React from 'react'
import { createRoot } from 'react-dom/client'
import { Root } from './Root'
import { ErrorBoundary } from './components/ErrorBoundary'
import './styles/base.css'
import { applyTheme, preloadAllThemes } from './theme/loader'
import { resolveInitialMode, resolveInitialLang, resolveInitialSkin } from './theme/registry'
import { useTheme } from './stores/themeStore'
import { LocaleProvider, resolveInitialLocale } from './i18n'
import './i18n.generated' // 注册全量翻译字典(渲染前)
import { installEngine } from './bootstrapEngine'
import { ChatPreview } from './views/chat2/ChatPreview'

// 仅设计预览:#preview 用样例数据渲染新视觉(无后端即可截图评审),正常 app 不受影响。
const isPreview = (() => { try { return location.hash === '#preview' } catch { return false } })()

// 首屏即按持久化 locale 设 <html lang>(同 FOUC 主题)。
try { document.documentElement.lang = resolveInitialLocale() === 'zh' ? 'zh-CN' : 'en' } catch { /* ignore */ }

// macOS hiddenInset 标题栏:交通灯浮在左上,ribbon 顶部已留白。
try { if (window.tangu?.platform === 'darwin') document.documentElement.dataset.platform = 'mac' } catch { /* ignore */ }

// index.html 的 FOUC 脚本已设 data-theme/data-skin/.dark;这里接管为 registry 校验过的 语言×配色 并激活其 CSS。
let initSeed: string | undefined
let persistedLang: string | null = null
try { initSeed = localStorage.getItem('forsion_theme_seed') || undefined } catch { /* private mode */ }
// 在 applyTheme 覆写 forsion_theme_lang 之前先抓住原始值:磁盘语言(soft/用户主题)首屏未加载会被回退到 lovable,
// initThemes 据此把它接回来。
try { persistedLang = localStorage.getItem('forsion_theme_lang') } catch { /* private mode */ }
applyTheme(resolveInitialLang(), resolveInitialSkin(), resolveInitialMode(), { customColor: initSeed })
try { document.documentElement.dataset.flat = localStorage.getItem('forsion_theme_flat') === '1' ? '1' : '0' } catch { /* private mode */ }
preloadAllThemes()
document.documentElement.style.removeProperty('background') // 交还给主题 CSS
// 合并 ~/.tangu/themes 的磁盘主题(soft 也在其中),并把首屏被回退的磁盘语言接回来。
void useTheme.getState().initThemes(persistedLang)

// 注册引擎贡献项(视图/命令/ribbon/状态项),须在 WorkspaceHost 挂载前。
installEngine()

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LocaleProvider>
      <ErrorBoundary>
        {isPreview ? <ChatPreview /> : <Root />}
      </ErrorBoundary>
    </LocaleProvider>
  </React.StrictMode>,
)
