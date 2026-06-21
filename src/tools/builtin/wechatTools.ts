/**
 * 微信远程发送工具:在「微信远程」会话里把工作区的文件/图片发回给连接的微信用户。
 * 仅 hostExec profile 暴露(本地形态);执行时经会话的活跃绑定解析微信联系人,
 * 非微信会话(无绑定)优雅报错。底层走 iLink getuploadurl + CDN 密文上传 + sendmessage。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ToolProvider } from '../toolRegistry.js';
import type { ToolContext } from '../toolTypes.js';
import { wechatRemote } from '../../services/wechatRemote.js';

const MAX_MEDIA_BYTES = 50 * 1024 * 1024; // 50MB;超过 iLink 普遍拒收

function resolveInCwd(ctx: ToolContext, p: string): string {
  return path.resolve(ctx.cwd || process.cwd(), String(p || ''));
}

async function sendMedia(ctx: ToolContext, rawPath: string, kind: 'image' | 'file'): Promise<string> {
  const rel = String(rawPath || '').trim();
  if (!rel) return 'Error: path is required';
  const abs = resolveInCwd(ctx, rel);
  let buf: Buffer;
  try {
    const st = await fs.stat(abs);
    if (!st.isFile()) return `Error: 不是文件:${rel}`;
    if (st.size === 0) return `Error: 文件为空:${rel}`;
    if (st.size > MAX_MEDIA_BYTES) return `Error: 文件过大(${(st.size / 1048576).toFixed(1)}MB),上限 ${MAX_MEDIA_BYTES / 1048576}MB`;
    buf = await fs.readFile(abs);
  } catch (e: any) {
    return `Error: 无法读取文件 ${rel}:${e?.message || e}`;
  }
  const fileName = path.basename(abs);
  const r = await wechatRemote.sendMediaForSession(ctx.userId, ctx.sessionId, buf, { kind, fileName }, ctx.signal);
  if (!r.ok) return `Error: 发送到微信失败:${r.error || 'unknown error'}`;
  return `已把${kind === 'image' ? '图片' : '文件'}「${fileName}」(${(buf.length / 1024).toFixed(0)} KB)发送到当前微信会话连接的用户。`;
}

export const wechatToolsProvider: ToolProvider = {
  id: 'builtin:wechat-tools',
  tools: () => [
    {
      name: 'wechat_send_file',
      mode: 'host',
      isEnabledFor: (profile) => profile.capabilities.hostExec,
      capabilities: { sideEffect: 'network', parallel: false, concurrencyKey: 'wechat-send', defaultTimeoutMs: 130_000 },
      definition: {
        type: 'function',
        function: {
          name: 'wechat_send_file',
          description:
            '把工作区里的一个文件以「文件」形式发送给当前微信会话连接的微信用户。仅在「微信远程」会话(已扫码连接微信)里有效;在普通会话调用会报「未连接微信」。path 相对工作目录或绝对路径;任意类型(文档/压缩包/音频等),上限 50MB。图片想内联显示请改用 wechat_send_image。',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '要发送的文件路径(相对工作目录或绝对路径)' },
            },
            required: ['path'],
          },
        },
      },
      execute: (args, ctx) => sendMedia(ctx, String(args.path ?? ''), 'file'),
    },
    {
      name: 'wechat_send_image',
      mode: 'host',
      isEnabledFor: (profile) => profile.capabilities.hostExec,
      capabilities: { sideEffect: 'network', parallel: false, concurrencyKey: 'wechat-send', defaultTimeoutMs: 130_000 },
      definition: {
        type: 'function',
        function: {
          name: 'wechat_send_image',
          description:
            '把工作区里的一张图片以「图片」气泡形式内联发送给当前微信会话连接的微信用户。仅在「微信远程」会话里有效。path 相对工作目录或绝对路径;适合截图/图表/生成的图片(png/jpg/gif 等),上限 50MB。非图片或想保留原文件名请用 wechat_send_file。',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '要发送的图片路径(png/jpg/gif 等)' },
            },
            required: ['path'],
          },
        },
      },
      execute: (args, ctx) => sendMedia(ctx, String(args.path ?? ''), 'image'),
    },
  ],
};
