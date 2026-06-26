/**
 * 内置插件「表情包」。每个表情 = 一张图(blob)+ 含义/时机(catalog,存 image-list 字段 stickers)。
 * 作用域:全局 + 按 agent(该 agent 有自己的表情则用其,否则用全局)。host-only,且仅插件启用时工具可见。
 *  - send_sticker：发表情。微信远程会话→原生图片(复用 wechatRemote);其他会话→返回 markdown 由 agent 放进正文。
 *  - manage_sticker：list/add/update/remove,让 agent 聊天里辅助用户管理(写到当前 agent 作用域)。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { PluginMeta } from '../registry.js';
import type { ToolProvider } from '../../tools/toolRegistry.js';
import type { ToolContext } from '../../tools/toolTypes.js';
import type { AppProfile } from '../../seams/appProfile.js';
import { wechatRemote } from '../../services/wechatRemote.js';
import {
  isPluginEnabledSync, getScopeSettings, setScopeSettings, resolveImageListScope,
  readPluginFile, writePluginFile, deletePluginFile, type Scope,
} from '../settingsStore.js';

export const STICKERS_ID = 'stickers';
const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);
const extOf = (n: string): string => (n.split('.').pop() || '').toLowerCase();

interface StickerItem { file: string; meaning?: string; when?: string }

function gate(profile: AppProfile, _ctx: ToolContext): boolean {
  return !!profile.capabilities.hostExec && isPluginEnabledSync(STICKERS_ID);
}
/** 读当前作用域的表情清单(该 agent 有则其,否则全局)。 */
function readScopeAndList(agentSlug?: string): { scope: Scope; items: StickerItem[] } {
  const scope = resolveImageListScope(STICKERS_ID, 'stickers', agentSlug);
  const items = (getScopeSettings(STICKERS_ID, scope).stickers as StickerItem[]) || [];
  return { scope, items };
}
/** manage_sticker 写入作用域:有活跃 agent → 该 agent,否则全局。 */
function writeScope(agentSlug?: string): Scope {
  return agentSlug ? { agentSlug } : 'global';
}

export const stickerToolsProvider: ToolProvider = {
  id: 'plugin:stickers',
  tools: () => [
    {
      name: 'send_sticker',
      mode: 'host',
      isEnabledFor: gate,
      capabilities: { sideEffect: 'network', parallel: false, concurrencyKey: 'wechat-send', defaultTimeoutMs: 60_000 },
      definition: {
        type: 'function',
        function: {
          name: 'send_sticker',
          description:
            'Send a sticker/meme to the user. Pass the exact sticker filename as `name` (see the "Stickers" list in your system prompt). In a WeChat Remote session it is delivered as a native image bubble; in other chats this returns markdown you must include verbatim in your reply. Use sparingly — only when it genuinely fits the mood.',
          parameters: {
            type: 'object',
            properties: { name: { type: 'string', description: 'Exact sticker filename, e.g. "happy.png"' } },
            required: ['name'],
          },
        },
      },
      execute: async (args, ctx) => {
        const name = String(args.name ?? '').trim();
        if (!name) return 'Error: name is required';
        const { scope } = readScopeAndList(ctx.agentSlug);
        const f = await readPluginFile(STICKERS_ID, scope, name);
        if (!f) return `Error: 表情「${name}」不存在(用 manage_sticker action=list 查看)。`;
        const r = await wechatRemote.sendMediaForSession(ctx.userId, ctx.sessionId, f.buffer, { kind: 'image', fileName: name }, ctx.signal);
        if (r.ok) return `已把表情「${name}」发送给当前微信用户。`;
        // ponytail: 非微信会话回退 markdown(data URL,小图够用);要原生气泡再升级 assistant attachments(ChatArea 已能渲染)。
        return `(当前不是微信会话)请把下面这张表情的 markdown 原样放进你的回复正文:\n![${name}](data:${f.mimeType};base64,${f.buffer.toString('base64')})`;
      },
    },
    {
      name: 'manage_sticker',
      mode: 'host',
      isEnabledFor: gate,
      capabilities: { sideEffect: 'write', parallel: false, defaultTimeoutMs: 30_000 },
      definition: {
        type: 'function',
        function: {
          name: 'manage_sticker',
          description:
            'Manage the sticker library so you can help the user curate stickers during chat. Actions: "list" (show all stickers + meaning/timing); "add" (import an image already in the working directory — needs name + source_path, plus meaning/when); "update" (change meaning/when by name); "remove" (delete by name). Changes apply to the current agent.',
          parameters: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['list', 'add', 'update', 'remove'] },
              name: { type: 'string', description: 'Sticker filename (add/update/remove), e.g. "happy.png"' },
              source_path: { type: 'string', description: 'For add: path of the image to import (relative to working dir or absolute)' },
              meaning: { type: 'string', description: 'What this sticker conveys' },
              when: { type: 'string', description: 'When it is appropriate to send' },
            },
            required: ['action'],
          },
        },
      },
      execute: async (args, ctx) => {
        const action = String(args.action ?? '').trim();
        if (action === 'list') {
          const { items } = readScopeAndList(ctx.agentSlug);
          if (!items.length) return '当前没有表情包。可用 action=add 添加。';
          return items.map((s) => `- ${s.file}${s.meaning ? ` — ${s.meaning}` : ''}${s.when ? `（when: ${s.when}）` : ''}`).join('\n');
        }
        const scope = writeScope(ctx.agentSlug);
        const items = ((getScopeSettings(STICKERS_ID, scope).stickers as StickerItem[]) || []).slice();
        const name = String(args.name ?? '').trim();
        if (action === 'add') {
          const src = String(args.source_path ?? '').trim();
          if (!name || !src) return 'Error: add 需要 name 和 source_path';
          if (!IMG_EXT.has(extOf(name))) return 'Error: name 必须是图片(png/jpg/gif/webp/bmp)';
          const abs = path.resolve(ctx.cwd || process.cwd(), src);
          let buf: Buffer;
          try { buf = await fs.readFile(abs); } catch (e: any) { return `Error: 读不到图片 ${src}: ${e?.message || e}`; }
          await writePluginFile(STICKERS_ID, scope, name, buf);
          const next = items.filter((s) => s.file !== name);
          next.push({ file: name, meaning: String(args.meaning ?? ''), when: String(args.when ?? '') });
          await setScopeSettings(STICKERS_ID, scope, { stickers: next });
          return `已添加表情「${name}」(${(buf.length / 1024).toFixed(0)} KB)。`;
        }
        if (action === 'update') {
          if (!name) return 'Error: update 需要 name';
          const i = items.findIndex((s) => s.file === name);
          if (i < 0) return `Error: 表情「${name}」不存在`;
          if (args.meaning !== undefined) items[i].meaning = String(args.meaning);
          if (args.when !== undefined) items[i].when = String(args.when);
          await setScopeSettings(STICKERS_ID, scope, { stickers: items });
          return `已更新表情「${name}」。`;
        }
        if (action === 'remove') {
          if (!name) return 'Error: remove 需要 name';
          await deletePluginFile(STICKERS_ID, scope, name).catch(() => { /* ignore */ });
          await setScopeSettings(STICKERS_ID, scope, { stickers: items.filter((s) => s.file !== name) });
          return `已删除表情「${name}」。`;
        }
        return 'Error: 未知 action(支持 list/add/update/remove)';
      },
    },
  ],
};

export const stickerPlugin: PluginMeta = {
  id: STICKERS_ID,
  name: '表情包',
  nameEn: 'Stickers',
  description: '让 agent 在合适时机发表情包(微信远程发原生图片,其他聊天用 markdown)。导入图片并填写含义/时机。',
  descriptionEn: 'Let the agent send stickers at fitting moments (native image on WeChat, markdown elsewhere). Import images and describe meaning/timing.',
  scopes: ['global', 'agent'],
  toolProvider: stickerToolsProvider,
  settings: {
    fields: [
      {
        key: 'stickers', type: 'image-list', label: '表情', labelEn: 'Stickers',
        help: '导入图片,填写「含义」与「发送时机」,agent 会据此在合适时机发送。',
        helpEn: 'Import images and fill in meaning + when to send; the agent uses these to decide when to send.',
        itemFields: [
          { key: 'meaning', type: 'text', label: '含义', labelEn: 'Meaning', placeholder: '如:开心、赞同' },
          { key: 'when', type: 'text', label: '发送时机', labelEn: 'When to send', placeholder: '如:用户夸奖我时' },
        ],
      },
    ],
  },
  promptSection: ({ slug, execMode }) => {
    const { items } = readScopeAndList(slug);
    if (!items.length) return '';
    const lines = items.map((s) => `- \`${s.file}\`${s.meaning ? ` — ${s.meaning}` : ''}${s.when ? `（when: ${s.when}）` : ''}`);
    const how = execMode === 'host'
      ? 'To send one, call the `send_sticker` tool with its exact filename as `name`. In a WeChat Remote session it is a native image; in other chats the tool returns markdown you must include verbatim.'
      : 'To send one, include its markdown image in your reply.';
    return '## Stickers (表情包)\n' +
      'You have a sticker library. Send a sticker only when it genuinely fits the mood/timing — at most one per reply, never forced. Available stickers:\n' +
      lines.join('\n') + '\n\n' + how;
  },
};
