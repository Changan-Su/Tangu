// 直连 provider「未登录 Forsion」离线链路实测(真 standalone 进程 + mock OpenAI 端点):
//   实报双 bug 的回归护栏 —— ① /agent/models 曾把与云端同名的直连模型去重吞掉(现暴露为
//   <providerId>/<模型> 前缀 id);② 未登录时 agentLoop 的云端用户探针 401 曾把纯本地对话打挂
//   ("brain /api/brain/users/me 401";现命中直连即降级放行)。
// 用法:npm run build && node scripts/direct-offline.e2e.mjs
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(root, 'dist', 'standalone', 'main.js');
if (!existsSync(entry)) {
  console.error('dist 缺失,先 npm run build');
  process.exit(1);
}

const TOKEN = 'e2e-token';
const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`);
};

// ── mock OpenAI 兼容端点:/chat/completions 固定回一段 SSE 文本 ──
const mock = createServer((req, res) => {
  if (req.method === 'POST' && req.url.endsWith('/chat/completions')) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'MOCK-REPLY' } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 3 } })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }
  res.writeHead(404).end();
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));
const mockPort = mock.address().port;

// ── 隔离 home + providers 文件;--cloud-url 指向必拒连端口 = 模拟未登录/云端不可达 ──
const home = mkdtempSync(join(tmpdir(), 'tangu-e2e-'));
const provFile = join(home, 'providers.json');
writeFileSync(provFile, JSON.stringify([{ providerId: 'mock', baseUrl: `http://127.0.0.1:${mockPort}/v1`, modelIds: ['test-model'] }]));

const port = 39000 + Math.floor(Math.random() * 1000);
const child = spawn(process.execPath, [
  entry, '--port', String(port), '--host', '127.0.0.1', '--data-dir', 'memory',
  '--sandbox', 'none', '--cloud-url', 'http://127.0.0.1:9', '--token', TOKEN,
  '--providers-file', provFile,
], { env: { ...process.env, TANGU_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
const logs = [];
child.stdout.on('data', (d) => logs.push(String(d)));
child.stderr.on('data', (d) => logs.push(String(d)));

const api = async (path, init = {}) => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`${path} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
};

const cleanup = () => {
  try { child.kill('SIGKILL'); } catch { /* noop */ }
  mock.close();
  rmSync(home, { recursive: true, force: true });
};

try {
  // 就绪
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    await new Promise((r) => setTimeout(r, 200));
    up = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.ok).catch(() => false);
    if (child.exitCode !== null) break;
  }
  if (!up) throw new Error(`引擎 20s 未就绪\n${logs.join('')}`);

  // ① 模型目录:直连模型以 <providerId>/<模型> 暴露,云端不可达也不炸
  const m = await api('/agent/models');
  const direct = (m.models || []).find((x) => x.source === 'direct');
  check('models: 直连模型 id 前缀化', direct?.id === 'mock/test-model', JSON.stringify(direct));
  check('models: name 保留裸名', direct?.name === 'test-model', direct?.name);
  check('models: forsion 探针降级为 error 不抛', m.forsion?.status === 'error', m.forsion?.status);

  // ② 未登录直连对话:run 须正常完成(旧行为:brain users/me 探针把 run 打挂)
  const sessionId = `e2e-${Date.now()}`;
  const run = await api('/agent/runs', {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId, model_id: 'mock/test-model', message: 'hi' }),
  });
  let reply = null;
  for (let i = 0; i < 100 && !reply; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const rows = await api(`/agent/sessions/${sessionId}/messages`).catch(() => []);
    const list = Array.isArray(rows) ? rows : rows.messages || [];
    reply = list.find((x) => String(x.content || '').includes('MOCK-REPLY')) || null;
    const failed = list.find((x) => /users\/me|401/.test(String(x.error || x.content || '')) && x.id === run.assistantMessageId && x.status === 'failed');
    if (failed) break;
  }
  check('run: 未登录直连对话正常回复', !!reply, reply ? undefined : `无回复;引擎日志尾:${logs.join('').slice(-400)}`);

  // ③ 裸 id 兼容:旧会话存的裸模型名仍可跑(registry 形式 2)
  const s2 = `e2e2-${Date.now()}`;
  await api('/agent/runs', { method: 'POST', body: JSON.stringify({ session_id: s2, model_id: 'test-model', message: 'hi' }) });
  let reply2 = null;
  for (let i = 0; i < 100 && !reply2; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const rows = await api(`/agent/sessions/${s2}/messages`).catch(() => []);
    const list = Array.isArray(rows) ? rows : rows.messages || [];
    reply2 = list.find((x) => String(x.content || '').includes('MOCK-REPLY')) || null;
  }
  check('run: 裸 id(旧会话)同样可跑', !!reply2);
} catch (e) {
  check('harness 异常', false, String(e?.message || e));
} finally {
  cleanup();
}

const fail = results.filter((x) => !x).length;
console.log(`\n${results.length - fail}/${results.length} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
