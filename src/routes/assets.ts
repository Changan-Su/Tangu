/**
 * 技能 / 工具目录(桌面技能·工具面板;handler 自带 authMiddleware)。
 *   GET /agent/skills → { skills: [{ id, name, description, icon?, category? }] }
 *       brain.assets.listSkills 未实现(旧版云端)/上游 404 → 空列表优雅降级。
 *   GET /agent/tools  → { builtins: [{ name, description, mode }], custom: [{ id, name, description, executor }] }
 *       builtins = 本 profile 在 sandbox/host 两种形态下可见工具的并集(mode 标注归属)。
 */
import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../core/http.js';
import { deps } from '../seams/runtime.js';
import { resolveTools } from '../tools/toolRegistry.js';
import type { ToolContext } from '../tools/toolTypes.js';

const router = Router();

router.get('/agent/skills', authMiddleware, async (_req: AuthRequest, res) => {
  try {
    const listSkills = deps().brain.assets.listSkills;
    let skills: any[] = [];
    if (listSkills) {
      skills = (await listSkills({ visibleOnly: true }).catch(() => [])) || [];
    }
    res.json({
      skills: skills.map((s: any) => ({
        id: s.id,
        name: s.name,
        description: s.description || '',
        icon: s.icon || null,
        category: s.category || null,
      })),
    });
  } catch (e: any) {
    res.status(500).json({ detail: e?.message || 'list skills failed' });
  }
});

router.get('/agent/tools', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const profile = deps().profile;
    const userId = req.user!.userId;

    // 内置:sandbox 与 host 两形态可见集的并集(host 集仅 hostExec profile 非空)。
    const seen = new Map<string, { name: string; description: string; mode: string }>();
    for (const execMode of ['sandbox', 'host'] as const) {
      const ctx: ToolContext = { userId, sessionId: '__list__', appId: profile.appId, execMode, profile };
      for (const [name, t] of resolveTools(profile, ctx)) {
        if (!seen.has(name)) {
          seen.set(name, { name, description: t.definition.function.description || '', mode: t.mode || 'both' });
        }
      }
    }

    let custom: any[] = [];
    try {
      custom = (await deps().brain.assets.listCustomTools({ appId: profile.appId, visibleOnly: true })) || [];
    } catch {
      custom = [];
    }

    res.json({
      builtins: [...seen.values()],
      custom: custom.map((t: any) => ({
        id: t.id,
        name: t.name,
        description: t.description || '',
        executor: t.executor || 'http',
      })),
    });
  } catch (e: any) {
    res.status(500).json({ detail: e?.message || 'list tools failed' });
  }
});

export default router;
