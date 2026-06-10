import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles/base.css'
import { applyTheme, preloadAllThemes } from './theme/loader'
import { resolveInitialMode, resolveInitialPreset } from './theme/registry'

// index.html 的 FOUC 脚本已设 data-theme/.dark;这里接管为 registry 校验过的 preset 并激活其 CSS。
applyTheme(resolveInitialPreset(), resolveInitialMode())
preloadAllThemes()
document.documentElement.style.removeProperty('background') // 交还给主题 CSS

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
