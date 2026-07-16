/**
 * Mini 悬浮卡片壳 = 移动单列壳的 mini 变体(顶部横向 Space ribbon 条 + 移动端顶栏[左右侧栏钮/tab 切换/⋯菜单]
 * + 内容 + 左右抽屉,去掉底部 Space 栏)。跑在 UI_MODE==='mobile' 的独立窗口(?window=mini&ui=mobile),
 * 3:4 竖比由主进程窗口 bounds 保证;边缘吸附折叠/展开全在主进程(轮询光标,见 electron/main.ts)。
 * 直接委托 SingleColumnHost variant='mini' —— 复用全部抽屉/tab/⋯,不重造(用户方向 B:尽量贴移动端)。
 */
import { SingleColumnHost } from './SingleColumnHost'

export const MiniColumnHost: React.FC<{ buildDefault?: () => void }> = ({ buildDefault }) => {
  return <SingleColumnHost variant="mini" buildDefault={buildDefault} />
}
