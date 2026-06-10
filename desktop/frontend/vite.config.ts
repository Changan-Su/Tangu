/**
 * 浏览器内调试用的独立 vite 配置(`npx vite frontend`):渲染层不依赖 Electron,
 * window.tangu 缺省时配置走内存/localStorage,便于无显示器环境冒烟与 UI 开发。
 * 打包仍走根目录 electron.vite.config.ts。
 */
import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  server: { port: 5173, strictPort: true },
})
