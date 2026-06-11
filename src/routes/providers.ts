/**
 * 直连 provider(BYO-key)信息与连通性探测。
 *   GET  /agent/providers      → { providers: [{ providerId, baseUrl, modelIds }] }  // 后端实际加载的(不含 apiKey)
 *   POST /agent/providers/test → { success, message }  // 两段探测:GET /models → 1-token chat completion
 *
 * 配置写入不在此(desktop 经 IPC 直写 ~/.tangu/providers.json 后重启托管后端;CLI 用 --providers-file)。
 * test 探测移植 server 的 /admin/models/test-connection 策略,差异:apiKey 可空(Ollama 等本地端点)。
 */
import { Router } from 'express';
import { authMiddleware } from '../core/http.js';
import { deps } from '../seams/runtime.js';

const router = Router();

router.get('/agent/providers', authMiddleware, async (_req, res) => {
  try {
    res.json({ providers: deps().brain.models.listDirectProviders?.() ?? [] });
  } catch (e: any) {
    res.status(500).json({ detail: e?.message || 'list providers failed' });
  }
});

router.post('/agent/providers/test', authMiddleware, async (req, res) => {
  try {
    const baseUrl = String(req.body?.baseUrl ?? '').trim();
    const apiKey = String(req.body?.apiKey ?? '').trim();
    const modelId = String(req.body?.modelId ?? '').trim();
    if (!baseUrl) return res.status(400).json({ detail: 'baseUrl required' });

    const clean = baseUrl.replace(/\/+$/, '');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    // 策略 1:GET /models(多数 OpenAI 兼容端点支持)
    try {
      const r = await fetch(`${clean}/models`, { method: 'GET', headers, signal: AbortSignal.timeout(10_000) });
      if (r.ok) {
        const data: any = await r.json().catch(() => ({}));
        const n = data?.data?.length || data?.models?.length || 0;
        return res.json({ success: true, message: n > 0 ? `连接成功,发现 ${n} 个模型` : '连接成功,端点可达' });
      }
    } catch {
      /* /models 不可用 → 落到策略 2 */
    }

    // 策略 2:1-token chat completion(需要 modelId)
    if (modelId) {
      const r = await fetch(`${clean}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: modelId, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 1, stream: false }),
        signal: AbortSignal.timeout(20_000),
      });
      if (r.ok) return res.json({ success: true, message: '连接成功,模型可响应' });
      const err: any = await r.json().catch(() => ({}));
      return res.json({
        success: false,
        message: `端点返回 ${r.status}: ${err?.error?.message || err?.message || '未知错误'}`,
      });
    }

    return res.json({ success: false, message: '无法验证连接;填入模型 ID 可做更深探测' });
  } catch (e: any) {
    res.json({ success: false, message: `连接失败: ${e?.message || e}` });
  }
});

export default router;
