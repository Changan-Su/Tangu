import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles/base.css'
import { applyTheme, preloadAllThemes } from './theme/loader'
import { resolveInitialMode, resolveInitialPreset } from './theme/registry'
import { LocaleProvider, resolveInitialLocale } from './i18n'
import './i18n.generated' // 注册全量翻译字典(渲染前)

// 同 FOUC 主题:首屏即按持久化 locale 设 <html lang>。
try { document.documentElement.lang = resolveInitialLocale() === 'zh' ? 'zh-CN' : 'en' } catch { /* ignore */ }

// index.html 的 FOUC 脚本已设 data-theme/.dark;这里接管为 registry 校验过的 preset 并激活其 CSS。
applyTheme(resolveInitialPreset(), resolveInitialMode())
preloadAllThemes()
document.documentElement.style.removeProperty('background') // 交还给主题 CSS

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LocaleProvider>
      <App />
    </LocaleProvider>
  </React.StrictMode>,
)
