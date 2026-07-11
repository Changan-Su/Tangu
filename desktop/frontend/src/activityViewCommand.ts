/**
 * 「打开活动日志」命令的注册/注销 + 开关持久化键(照 mobileUiCommand 同款模式)。
 * - bootstrapEngine 启动时按开关(ACTIVITY_VIEW_KEY)注册;
 * - SettingsModal 开发者选项切换时即时增删(免 reload 就能在命令面板看到);
 * - 视图本体 activity-log 恒注册(注册无害),开关只控制 ⌘K 入口。
 */
import { addCommand, removeCommand, useWorkspace } from '@lcl/engine'
import { useApp } from './stores/appStore'

export const ACTIVITY_VIEW_KEY = 'forsion_tangu_activity_view'

export function setActivityViewCommand(enabled: boolean): void {
  if (enabled) {
    addCommand({
      id: 'open-activity-log',
      title: () => useApp.getState().tr('command.openActivityLog'),
      keywords: 'activity log tail 活动 日志 实时 调试 debug',
      run: () => { useWorkspace.getState().openView('activity-log', {}, 'main') },
    })
  } else {
    removeCommand('open-activity-log')
  }
}
