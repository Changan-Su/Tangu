/**
 * 每个 run 的执行上下文(当前用户 + runId)—— 多租户 / thin-worker 的接缝。
 *
 * 背景:run loop 与 HTTP 连接解耦、后台异步跑,只从 DB/状态拿到 run.user_id;而 LLM 接缝
 * (resolveModelAndKey/buildProviderPayload/streamProviderCompletion)签名里没有 userId。
 * 分离式云 worker 一个进程服务多用户,brain-api 调用必须按**当前 run 的用户**鉴权/计费;
 * thin worker 还要按 **当前 runId** 取该 run 的 per-dispatch token(见 HttpStateStore / httpBrain)。
 *
 * 用 AsyncLocalStorage 在 runLoop 顶部把 {userId, runId} 注入本 run 的整个异步子树。
 * 对 microserver/standalone **无害**:它们的 brain/state 不读此上下文(固定身份、本地库)。
 */
import { AsyncLocalStorage } from 'node:async_hooks';

interface RunCtx {
  userId: string;
  runId?: string;
}

const als = new AsyncLocalStorage<RunCtx>();

/** 在当前 run 的异步子树建立上下文(runLoop 顶部调用一次)。 */
export function enterRunContext(userId: string, runId?: string): void {
  als.enterWith({ userId, runId });
}

/** 当前 run 的 userId(不在 run 上下文内时 undefined)。 */
export function currentRunUserId(): string | undefined {
  return als.getStore()?.userId;
}

/** 当前 run 的 runId(thin worker 据此取该 run 的 per-dispatch token)。 */
export function currentRunId(): string | undefined {
  return als.getStore()?.runId;
}
