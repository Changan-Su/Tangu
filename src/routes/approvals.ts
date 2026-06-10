/**
 * host-exec 审批的 HTTP 兑现端点(桌面端审批卡;handler 自带 authMiddleware)。
 * TUI 同进程直调 resolveApproval;桌面端经 SSE 收 approval_request 事件后,POST 到这里兑现。
 * 审批登记表是进程内的(approvals.ts),与 loop 同进程——fleet 模式下本路由按 session 亲和
 * 代理到对应 worker(见 fleetDispatch)。
 *
 *   POST /agent/runs/:runId/approvals/:approvalId { action: 'approve'|'approve_always'|'reject', argsOverride? }
 *     → 200 { ok: true } | 400 非法 action | 404 run 不存在/非本人 | 410 该审批已不在等待(过期/重复/已被 TUI 处理)
 *
 * 安全边界:approval_request 事件只在 execMode==='host' 产生(gateToolCall 守卫 + profile.hostExec
 * 能力闸门),云端形态下 pending 恒空 → 本路由只会回 410,无新攻击面。
 */
import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../core/http.js';
import { getRunForUser } from '../services/runStore.js';
import { resolveApproval, type ApprovalAction } from '../services/approvals.js';

const router = Router();

const ACTIONS: ApprovalAction[] = ['approve', 'approve_always', 'reject'];

router.post('/agent/runs/:runId/approvals/:approvalId', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const action = req.body?.action as ApprovalAction;
    if (!ACTIONS.includes(action)) {
      return res.status(400).json({ detail: `action must be one of ${ACTIONS.join('/')}` });
    }
    const run = await getRunForUser(req.params.runId, userId);
    if (!run) return res.status(404).json({ detail: 'Run not found' });

    const argsOverride =
      req.body?.argsOverride && typeof req.body.argsOverride === 'object' ? req.body.argsOverride : undefined;
    const ok = resolveApproval(req.params.approvalId, { action, argsOverride });
    if (!ok) return res.status(410).json({ detail: 'approval is no longer pending' });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ detail: e?.message || 'approval failed' });
  }
});

export default router;
