/**
 * 内置插件「微信分段消息」。设置型插件:仅声明 meta + schema(在「设置 → 插件」露出面板),
 * 行为在核心 wechatRemote(读本插件 enabled + segmentDelayMs,调 splitMessage 分段)。
 */
import type { PluginMeta } from '../registry.js';

export const WECHAT_SEGMENT_ID = 'wechat-segment';

export const wechatSegmentPlugin: PluginMeta = {
  id: WECHAT_SEGMENT_ID,
  name: '微信分段消息',
  nameEn: 'WeChat Segmented Messages',
  description: '微信远程会话里,把 AI 回复拆成多条、带打字停顿依次发出,更像真人聊天。',
  descriptionEn: 'In WeChat Remote chats, split the AI reply into several messages sent one after another with typing pauses — more human-like.',
  scopes: ['global'],
  settings: {
    fields: [
      { key: 'segmentDelayMs', type: 'number', label: '段间基础延迟(毫秒)', labelEn: 'Base delay between segments (ms)', default: 450, min: 0, max: 3000 },
    ],
  },
};
