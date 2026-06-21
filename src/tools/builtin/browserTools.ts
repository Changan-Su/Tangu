/**
 * Agent 专属轻量浏览器工具。实现取向参考 Hermes 的 browser_* 工具集，但保持 Tangu 的
 * TypeScript / provider 注册风格：本地调用 agent-browser CLI，按 session 隔离浏览器状态。
 */
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertPublicHttpUrl } from '../../core/util/urlSafety.js';
import { tanguHome } from '../../core/tanguHome.js';
import type { ToolProvider } from '../toolRegistry.js';
import type { ToolContext } from '../toolTypes.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const NAVIGATE_TIMEOUT_MS = 60_000;
const OUTPUT_CAP = 4 * 1024 * 1024;
const SNAPSHOT_MAX_CHARS = 40_000;

type BrowserEngine = 'auto' | 'chrome' | 'lightpanda';
type SearchEngine = 'duckduckgo' | 'bing' | 'google' | 'baidu';

interface BrowserCommandResult {
  success: boolean;
  data?: any;
  error?: string;
  raw?: string;
  stderr?: string;
}

function browserEnabled(): boolean {
  return process.env.TANGU_BROWSER_ENABLED !== '0';
}

function allowPrivateUrls(): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env.TANGU_BROWSER_ALLOW_PRIVATE_URLS || '').toLowerCase());
}

function browserEngine(): BrowserEngine {
  const v = String(process.env.TANGU_BROWSER_ENGINE || 'auto').toLowerCase();
  return v === 'chrome' || v === 'lightpanda' ? v : 'auto';
}

function searchEngine(): SearchEngine {
  const v = String(process.env.TANGU_BROWSER_SEARCH_ENGINE || 'duckduckgo').toLowerCase();
  return v === 'bing' || v === 'google' || v === 'baidu' ? v : 'duckduckgo';
}

function commandTimeout(): number {
  const v = Number(process.env.TANGU_BROWSER_COMMAND_TIMEOUT_MS);
  return Number.isFinite(v) && v >= 5_000 ? v : DEFAULT_TIMEOUT_MS;
}

function sessionName(ctx: ToolContext): string {
  const h = createHash('sha1').update(`${ctx.appId}:${ctx.sessionId}`).digest('hex').slice(0, 16);
  return `tangu_${h}`;
}

/**
 * agent-browser 的 unix domain socket 根目录。
 * macOS sun_path 上限 ~103B,而 agent-browser 会在此目录下用 session 名再拼 `<name>.sock`;
 * 若用 os.tmpdir()(macOS 是超长的 /var/folders/.../T)并再嵌一层 name,socket 路径会超限报
 * "Session name too long / Socket path would be N bytes (max 103)" → 浏览器工具全部失败。
 * 故根目录必须短且不嵌 name:非 Windows 用 /tmp 并按 uid 隔离;Windows 用命名管道不受此限。
 * 可用 TANGU_BROWSER_SOCKET_DIR 覆盖。
 */
function browserSocketDir(): string {
  const override = (process.env.TANGU_BROWSER_SOCKET_DIR || '').trim();
  if (override) return override;
  if (process.platform === 'win32') return path.join(tmpdir(), 'tangu-agent-browser');
  let uid = '';
  try { uid = String(process.getuid?.() ?? ''); } catch { /* ignore */ }
  return path.join('/tmp', uid ? `tangu-br-${uid}` : 'tangu-br');
}

function screenshotDir(): string {
  return path.join(tanguHome(), 'browser', 'screenshots');
}

async function validateUrl(raw: string): Promise<string> {
  if (allowPrivateUrls()) {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http and https URLs are allowed');
    return u.href;
  }
  return (await assertPublicHttpUrl(raw)).href;
}

export const __browserToolInternals = {
  validateUrl,
};

function searchUrl(engine: SearchEngine, query: string): string {
  const q = encodeURIComponent(query);
  switch (engine) {
    case 'bing': return `https://www.bing.com/search?q=${q}`;
    case 'google': return `https://www.google.com/search?q=${q}`;
    case 'baidu': return `https://www.baidu.com/s?wd=${q}`;
    case 'duckduckgo':
    default:
      return `https://duckduckgo.com/?q=${q}`;
  }
}

function clipSnapshot(s: string): string {
  return s.length > SNAPSHOT_MAX_CHARS ? `${s.slice(0, SNAPSHOT_MAX_CHARS)}\n...[snapshot truncated]` : s;
}

function parseJsonOrRaw(stdout: string, stderr: string): BrowserCommandResult {
  const text = stdout.trim();
  if (!text) return { success: false, error: stderr.trim() || 'agent-browser returned no output' };
  try {
    return JSON.parse(text) as BrowserCommandResult;
  } catch {
    return { success: true, raw: text, stderr: stderr.trim() || undefined };
  }
}

function installHint(): string {
  return 'agent-browser CLI not found. Install with: npm install -g agent-browser && agent-browser install';
}

async function spawnAgentBrowser(
  executable: string,
  argv: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<BrowserCommandResult & { enoent?: boolean }> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(executable, argv, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e: any) {
      resolve({ success: false, error: e?.code === 'ENOENT' ? installHint() : String(e?.message || e), enoent: e?.code === 'ENOENT' });
      return;
    }
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (r: BrowserCommandResult & { enoent?: boolean }): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(r);
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      finish({ success: false, error: `browser command timed out after ${timeoutMs}ms` });
    }, timeoutMs);
    const onAbort = (): void => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      finish({ success: false, error: 'aborted' });
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout?.on('data', (d) => { if (stdout.length < OUTPUT_CAP) stdout += d.toString(); });
    child.stderr?.on('data', (d) => { if (stderr.length < OUTPUT_CAP) stderr += d.toString(); });
    child.on('error', (e: any) => {
      finish({ success: false, error: e?.code === 'ENOENT' ? installHint() : String(e?.message || e), enoent: e?.code === 'ENOENT' });
    });
    child.on('close', (code) => {
      if (done) return;
      const parsed = parseJsonOrRaw(stdout, stderr);
      if (code && code !== 0 && parsed.success) {
        finish({ success: false, error: stderr.trim() || `agent-browser exited ${code}`, raw: stdout.trim() || undefined });
      } else {
        finish(parsed);
      }
    });
  });
}

async function runBrowserCommand(
  ctx: ToolContext,
  command: string,
  args: string[] = [],
  timeoutMs = commandTimeout(),
): Promise<BrowserCommandResult> {
  if (!browserEnabled()) return { success: false, error: 'Browser tools are disabled (TANGU_BROWSER_ENABLED=0)' };
  const name = sessionName(ctx);
  const socketDir = browserSocketDir();
  await fs.mkdir(socketDir, { recursive: true });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AGENT_BROWSER_SOCKET_DIR: socketDir,
    AGENT_BROWSER_IDLE_TIMEOUT_MS: process.env.AGENT_BROWSER_IDLE_TIMEOUT_MS || '600000',
  };
  const engine = browserEngine();
  const baseArgs = ['--session', name];
  if (engine !== 'auto') baseArgs.push('--engine', engine);
  baseArgs.push('--json', command, ...args);

  const explicit = process.env.TANGU_AGENT_BROWSER_BIN;
  const first = await spawnAgentBrowser(explicit || 'agent-browser', baseArgs, env, timeoutMs, ctx.signal);
  if (!first.enoent || explicit) return first;
  return spawnAgentBrowser('npx', ['agent-browser', ...baseArgs], env, timeoutMs, ctx.signal);
}

async function navigate(ctx: ToolContext, rawUrl: string): Promise<Record<string, any>> {
  const url = await validateUrl(rawUrl);
  const opened = await runBrowserCommand(ctx, 'open', [url], Math.max(commandTimeout(), NAVIGATE_TIMEOUT_MS));
  if (!opened.success) return { success: false, error: opened.error || 'navigation failed' };
  const data = opened.data || {};
  const out: Record<string, any> = {
    success: true,
    url: data.url || url,
    title: data.title || '',
  };
  const snap = await runBrowserCommand(ctx, 'snapshot', ['-c'], commandTimeout());
  if (snap.success) {
    out.snapshot = clipSnapshot(String(snap.data?.snapshot || snap.raw || ''));
    out.element_count = snap.data?.refs ? Object.keys(snap.data.refs).length : undefined;
  }
  return out;
}

function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function refArg(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s) return '';
  return s.startsWith('@') ? s : `@${s}`;
}

export const browserToolsProvider: ToolProvider = {
  id: 'builtin:browser-tools',
  tools: () => [
    {
      name: 'browser_search',
      mode: 'host',
      isEnabledFor: (profile) => profile.features.webSearch && profile.capabilities.hostExec,
      capabilities: { sideEffect: 'browser', parallel: false, concurrencyKey: 'browser', defaultTimeoutMs: NAVIGATE_TIMEOUT_MS },
      definition: {
        type: 'function',
        function: {
          name: 'browser_search',
          description:
            '使用本地轻量浏览器打开搜索引擎并返回页面快照。优先用于实时网页搜索；结果里的 @eN 可继续用 browser_click/browser_type 交互。',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: '搜索关键词' },
              engine: { type: 'string', enum: ['duckduckgo', 'bing', 'google', 'baidu'], description: '可选搜索引擎，默认设置值' },
            },
            required: ['query'],
          },
        },
      },
      execute: async (args, ctx) => {
        const query = String(args.query ?? '').trim();
        if (!query) return 'Error: query is required';
        const primary = (['duckduckgo', 'bing', 'google', 'baidu'].includes(args.engine) ? args.engine : searchEngine()) as SearchEngine;
        const first = await navigate(ctx, searchUrl(primary, query));
        if (first.success) return toJson({ ...first, query, engine: primary });
        if (primary !== 'bing') {
          const fallback = await navigate(ctx, searchUrl('bing', query));
          return toJson({ ...fallback, query, engine: 'bing', fallbackFrom: primary, firstError: first.error });
        }
        return toJson({ ...first, query, engine: primary });
      },
    },
    {
      name: 'browser_navigate',
      mode: 'host',
      isEnabledFor: (profile) => profile.features.webSearch && profile.capabilities.hostExec,
      capabilities: { sideEffect: 'browser', parallel: false, concurrencyKey: 'browser', defaultTimeoutMs: NAVIGATE_TIMEOUT_MS },
      definition: {
        type: 'function',
        function: {
          name: 'browser_navigate',
          description: '在本地轻量浏览器中打开一个公网 http/https URL，并返回标题、最终 URL 与 compact snapshot。',
          parameters: { type: 'object', properties: { url: { type: 'string', description: '完整 URL' } }, required: ['url'] },
        },
      },
      execute: async (args, ctx) => toJson(await navigate(ctx, String(args.url ?? ''))),
    },
    {
      name: 'browser_snapshot',
      mode: 'host',
      isEnabledFor: (profile) => profile.features.webSearch && profile.capabilities.hostExec,
      capabilities: { sideEffect: 'browser', parallel: false, concurrencyKey: 'browser', defaultTimeoutMs: DEFAULT_TIMEOUT_MS },
      definition: {
        type: 'function',
        function: {
          name: 'browser_snapshot',
          description: '读取当前浏览器页的可访问性树快照。compact=true 返回更短的交互元素视图。',
          parameters: { type: 'object', properties: { compact: { type: 'boolean', description: '默认 true' } }, required: [] },
        },
      },
      execute: async (args, ctx) => {
        const compact = args.compact !== false;
        const r = await runBrowserCommand(ctx, 'snapshot', compact ? ['-c'] : [], commandTimeout());
        return toJson(r.success ? { success: true, snapshot: clipSnapshot(String(r.data?.snapshot || r.raw || '')), element_count: r.data?.refs ? Object.keys(r.data.refs).length : undefined } : r);
      },
    },
    {
      name: 'browser_click',
      mode: 'host',
      isEnabledFor: (profile) => profile.features.webSearch && profile.capabilities.hostExec,
      capabilities: { sideEffect: 'browser', parallel: false, concurrencyKey: 'browser', defaultTimeoutMs: DEFAULT_TIMEOUT_MS },
      definition: {
        type: 'function',
        function: {
          name: 'browser_click',
          description: '点击 snapshot 中的元素 ref，例如 @e5。点击后通常调用 browser_snapshot 刷新页面状态。',
          parameters: { type: 'object', properties: { ref: { type: 'string', description: '元素 ref，如 @e5' } }, required: ['ref'] },
        },
      },
      execute: async (args, ctx) => {
        const ref = refArg(args.ref);
        if (!ref) return 'Error: ref is required';
        return toJson(await runBrowserCommand(ctx, 'click', [ref], commandTimeout()));
      },
    },
    {
      name: 'browser_type',
      mode: 'host',
      isEnabledFor: (profile) => profile.features.webSearch && profile.capabilities.hostExec,
      capabilities: { sideEffect: 'browser', parallel: false, concurrencyKey: 'browser', defaultTimeoutMs: DEFAULT_TIMEOUT_MS },
      definition: {
        type: 'function',
        function: {
          name: 'browser_type',
          description: '向 snapshot 中的输入元素 ref 填入文本；会清空原值后输入。',
          parameters: { type: 'object', properties: { ref: { type: 'string' }, text: { type: 'string' } }, required: ['ref', 'text'] },
        },
      },
      execute: async (args, ctx) => {
        const ref = refArg(args.ref);
        if (!ref) return 'Error: ref is required';
        return toJson(await runBrowserCommand(ctx, 'fill', [ref, String(args.text ?? '')], commandTimeout()));
      },
    },
    {
      name: 'browser_scroll',
      mode: 'host',
      isEnabledFor: (profile) => profile.features.webSearch && profile.capabilities.hostExec,
      capabilities: { sideEffect: 'browser', parallel: false, concurrencyKey: 'browser', defaultTimeoutMs: DEFAULT_TIMEOUT_MS },
      definition: {
        type: 'function',
        function: {
          name: 'browser_scroll',
          description: '滚动当前页面。direction 为 up 或 down，pixels 默认 500。',
          parameters: { type: 'object', properties: { direction: { type: 'string', enum: ['up', 'down'] }, pixels: { type: 'number' } }, required: ['direction'] },
        },
      },
      execute: async (args, ctx) => {
        const direction = String(args.direction ?? '');
        if (direction !== 'up' && direction !== 'down') return 'Error: direction must be up or down';
        const pixels = Number.isFinite(Number(args.pixels)) && Number(args.pixels) > 0 ? String(Number(args.pixels)) : '500';
        return toJson(await runBrowserCommand(ctx, 'scroll', [direction, pixels], commandTimeout()));
      },
    },
    {
      name: 'browser_back',
      mode: 'host',
      isEnabledFor: (profile) => profile.features.webSearch && profile.capabilities.hostExec,
      capabilities: { sideEffect: 'browser', parallel: false, concurrencyKey: 'browser', defaultTimeoutMs: DEFAULT_TIMEOUT_MS },
      definition: {
        type: 'function',
        function: { name: 'browser_back', description: '浏览器后退到上一页。', parameters: { type: 'object', properties: {}, required: [] } },
      },
      execute: async (_args, ctx) => toJson(await runBrowserCommand(ctx, 'back', [], commandTimeout())),
    },
    {
      name: 'browser_press',
      mode: 'host',
      isEnabledFor: (profile) => profile.features.webSearch && profile.capabilities.hostExec,
      capabilities: { sideEffect: 'browser', parallel: false, concurrencyKey: 'browser', defaultTimeoutMs: DEFAULT_TIMEOUT_MS },
      definition: {
        type: 'function',
        function: {
          name: 'browser_press',
          description: '在当前页面按键，例如 Enter、Tab、Escape。',
          parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
        },
      },
      execute: async (args, ctx) => {
        const key = String(args.key ?? '').trim();
        if (!key) return 'Error: key is required';
        return toJson(await runBrowserCommand(ctx, 'press', [key], commandTimeout()));
      },
    },
    {
      name: 'browser_console',
      mode: 'host',
      isEnabledFor: (profile) => profile.features.webSearch && profile.capabilities.hostExec,
      capabilities: { sideEffect: 'browser', parallel: false, concurrencyKey: 'browser', defaultTimeoutMs: DEFAULT_TIMEOUT_MS },
      definition: {
        type: 'function',
        function: {
          name: 'browser_console',
          description: '读取 console/errors，或提供 expression 时在页面上下文执行 JS 表达式。',
          parameters: {
            type: 'object',
            properties: {
              expression: { type: 'string', description: '可选 JS 表达式；省略则读取 console/errors' },
              clear: { type: 'boolean', description: '读取后清空缓冲区' },
            },
            required: [],
          },
        },
      },
      execute: async (args, ctx) => {
        if (args.expression != null) return toJson(await runBrowserCommand(ctx, 'eval', [String(args.expression)], commandTimeout()));
        const flag = args.clear ? ['--clear'] : [];
        const consoleOut = await runBrowserCommand(ctx, 'console', flag, commandTimeout());
        const errors = await runBrowserCommand(ctx, 'errors', flag, commandTimeout());
        return toJson({ success: consoleOut.success || errors.success, console: consoleOut, errors });
      },
    },
    {
      name: 'browser_screenshot',
      mode: 'host',
      isEnabledFor: (profile) => profile.features.webSearch && profile.capabilities.hostExec,
      capabilities: { sideEffect: 'browser', parallel: false, concurrencyKey: 'browser', defaultTimeoutMs: DEFAULT_TIMEOUT_MS },
      definition: {
        type: 'function',
        function: {
          name: 'browser_screenshot',
          description: '保存当前页面截图到 ~/.tangu/browser/screenshots，并返回 screenshot_path。',
          parameters: {
            type: 'object',
            properties: { full_page: { type: 'boolean', description: '默认 true' }, annotate: { type: 'boolean', description: '为交互元素叠加编号' } },
            required: [],
          },
        },
      },
      execute: async (args, ctx) => {
        await fs.mkdir(screenshotDir(), { recursive: true });
        const file = path.join(screenshotDir(), `browser_screenshot_${randomUUID()}.png`);
        const cmdArgs: string[] = [];
        if (args.annotate) cmdArgs.push('--annotate');
        if (args.full_page !== false) cmdArgs.push('--full');
        cmdArgs.push(file);
        const r = await runBrowserCommand(ctx, 'screenshot', cmdArgs, commandTimeout());
        return toJson(r.success ? { success: true, screenshot_path: r.data?.path || file } : r);
      },
    },
  ],
};
