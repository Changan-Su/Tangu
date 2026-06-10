#!/usr/bin/env node
/**
 * Tangu standalone 入口(**server 前端**:headless HTTP/SSE 服务)。
 *   parseConfig → setupHost(嵌入式 PGlite / 外部 PG)+ base schema + runMigration
 *   → 装配 deps(host/brain/noopBilling)→ createTanguModule → mount(/agent/*) → listen。
 * run 接口与 microserver 同契约:POST /agent/runs、SSE GET /agent/runs/:id/events。
 * 终端交互前端见 cli/main.ts(`tangu chat`);二者共用 standalone/assemble.ts 的装配。
 */
import express from 'express';
import { createTanguModule } from '../index.js';
import { createNoopBilling } from '../adapters/standalone/noopBilling.js';
import { createTanguProfile } from '../profiles/index.js';
import { parseConfig, validate, HELP } from './config.js';
import { loadCreds } from './credStore.js';
import { resolveSandboxMode, setupHost, buildBrain, fixLegacyAppIds } from './assemble.js';

async function main(): Promise<void> {
  const cfg = parseConfig(process.argv.slice(2));
  if (cfg.showHelp) { process.stdout.write(HELP); return; }
  // 未显式给 token / cloud-url → 复用 `tangu-chat login` 存的凭证。
  const creds = loadCreds();
  if (!cfg.token) cfg.token = creds.token || '';
  if (!cfg.cloudUrl) cfg.cloudUrl = creds.cloudUrl || '';
  const errs = validate(cfg);
  if (errs.length) {
    process.stderr.write('配置错误:\n  - ' + errs.join('\n  - ') + '\n\n' + HELP);
    process.exit(1);
  }

  const sandboxMode = await resolveSandboxMode(cfg);
  const { host, runBaseSchema, storage } = await setupHost(cfg);
  await runBaseSchema(); // base schema 先于 runMigration(后者对 chat_sessions 做 ALTER)
  const { brain, providers } = buildBrain(cfg);

  const mod = createTanguModule({
    host,
    brain,
    billing: createNoopBilling(),
    profile: createTanguProfile({ sandboxMode, defaultModelId: cfg.defaultModelId || undefined }),
  });

  await mod.runMigration();
  await fixLegacyAppIds(); // 修正 runs.ts 硬编码时期误标 'ai-studio' 的本地会话(仅 standalone 本地库)
  mod.startBackgroundTasks();

  const app = express();
  app.use(express.json({ limit: '25mb' }));
  // CORS:桌面 renderer(dev http://localhost:5173 / 打包 file://)跨源直连本服务。
  // 鉴权靠 Bearer token(无 cookie),放开 origin 无 CSRF 面。
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.get('/health', (_req, res) => res.json({ ok: true, mode: 'standalone', sandbox: sandboxMode }));
  app.use('/', mod.userRouter); // /agent/runs、/agent/runs/:id/events、/agent/workspace/*、审批
  app.use('/', mod.dataRouter); // /agent/sessions、/agent/models、/agent/memory、/agent/skills、/agent/tools

  app.listen(cfg.port, cfg.host, () => {
    console.log(`[tangu] standalone 已启动 http://${cfg.host}:${cfg.port}`);
    console.log(`[tangu] cloud=${cfg.cloudUrl} 存储=${storage} sandbox=${sandboxMode} model=${cfg.defaultModelId || '(run 指定)'}`);
    if (providers.length) {
      console.log(`[tangu] 直连 provider: ${providers.map((p) => p.providerId).join(', ')}(其余 LLM 走 Forsion 托管面)`);
    }
  });
}

main().catch((e) => {
  console.error('[tangu] 启动失败:', e?.message || e);
  process.exit(1);
});
