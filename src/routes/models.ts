/**
 * 模型目录(桌面/客户端模型选择器;handler 自带 authMiddleware)。
 *   GET /agent/models →
 *     {
 *       models: [{ id, name, provider, source: 'forsion'|'direct' }],   // 可直接选用的模型
 *       directProviders: [{ providerId, modelIds? }],                   // 直连 provider(支持 <providerId>/<model> 自由填)
 *       defaultModelId
 *     }
 * forsion 部分经 deps().brain.models(microserver 进程内直连 / standalone 走 brain-api);
 * direct 部分仅 standalone 的 multiBrain 实现(listDirectProviders 可选方法),云端自动跳过。
 */
import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../core/http.js';
import { deps } from '../seams/runtime.js';

const router = Router();

router.get('/agent/models', authMiddleware, async (_req: AuthRequest, res) => {
  try {
    const profile = deps().profile;
    const models: Array<{ id: string; name: string; provider: string; source: 'forsion' | 'direct' }> = [];

    const cloud = await deps().brain.models.listGlobalModels().catch(() => [] as any[]);
    for (const m of cloud || []) {
      if (!m?.id) continue;
      models.push({ id: m.id, name: m.name || m.id, provider: m.provider || 'forsion', source: 'forsion' });
    }

    const directProviders = deps().brain.models.listDirectProviders?.() ?? [];
    for (const p of directProviders) {
      for (const mid of p.modelIds ?? []) {
        models.push({ id: mid, name: mid, provider: p.providerId, source: 'direct' });
      }
    }

    res.json({ models, directProviders, defaultModelId: profile.defaultModelId || null });
  } catch (e: any) {
    res.status(500).json({ detail: e?.message || 'list models failed' });
  }
});

export default router;
