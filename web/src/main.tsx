/**
 * Tangu Web 入口:先装垫片(设 window.tangu),再复用 desktop 的启动(主题/i18n/引擎/Root)。
 * 用动态 import 保证「垫片先于 desktop 主模块求值」——静态 import 会被提升到 body 之前执行。
 */
import { installWebShim } from './webShim'

if (installWebShim()) {
  // 已登录:window.tangu 就位后再加载桌面端启动模块(@ → ../desktop/frontend/src)。
  void import('@/main')
}
// 未登录:installWebShim 已 location.replace 跳登录,不挂载。
