/** 内置「核心插件」登记入口。由 tools/registry.ts 在注册完核心工具后调一次(保 append 顺序)。 */
import { registerPlugin } from '../registry.js';
import { stickerPlugin } from './stickers.js';
import { wechatSegmentPlugin } from './wechatSegment.js';

let done = false;
export function registerBuiltinPlugins(): void {
  if (done) return;
  done = true;
  registerPlugin(stickerPlugin); // 带 toolProvider → 顺带注册 send_sticker/manage_sticker(默认禁用,门禁隐藏)
  registerPlugin(wechatSegmentPlugin); // 设置型,无工具
}
