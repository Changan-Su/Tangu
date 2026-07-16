import { describe, it, expect } from 'vitest';
import { tuneOpenAiDirectPayload, PROTOCOL_MARK } from './openaiCompat.js';

// 官方 api.openai.com 直连 gpt-5.x 的实测契约(2026-07,gpt-5.6-luna):
//   chat/completions + tools 必须显式 reasoning_effort:'none';思考开只能走 /v1/responses;
//   temperature≠1 与 max_tokens 均被拒。见 tuneOpenAiDirectPayload 头注释的探测矩阵。
describe('tuneOpenAiDirectPayload(官方 OpenAI gpt-5.x 适配)', () => {
  const base = () => ({ model: 'gpt-5.6-luna', temperature: 0.7, messages: [], tools: [{}] }) as any;
  const OFFICIAL = 'https://api.openai.com/v1';

  it('思考关 → 补 reasoning_effort:none + 剥 temperature,仍走 chat/completions', () => {
    const p = base();
    tuneOpenAiDirectPayload(p, 'off', OFFICIAL);
    expect(p.reasoning_effort).toBe('none');
    expect(p.temperature).toBeUndefined();
    expect(p[PROTOCOL_MARK]).toBeUndefined();
  });

  it('思考开 → 打 openai-responses 协议标记,effort 随传', () => {
    const p = base();
    tuneOpenAiDirectPayload(p, 'medium', OFFICIAL);
    expect(p[PROTOCOL_MARK]).toBe('openai-responses');
    expect(p.reasoning_effort).toBe('medium');
  });

  it('max_tokens → max_completion_tokens(压缩等通道会带上限)', () => {
    const p = { ...base(), max_tokens: 1200 };
    tuneOpenAiDirectPayload(p, 'off', OFFICIAL);
    expect(p.max_tokens).toBeUndefined();
    expect(p.max_completion_tokens).toBe(1200);
  });

  it('非官方域名(网关/Ollama)零打扰', () => {
    const p = base();
    tuneOpenAiDirectPayload(p, 'off', 'https://api.siliconflow.cn/v1');
    expect(p.reasoning_effort).toBeUndefined();
    expect(p.temperature).toBe(0.7);
  });

  it('官方但非 gpt-5 族(gpt-4o)零打扰(实测发 effort 会被拒)', () => {
    const p = { ...base(), model: 'gpt-4o-mini' };
    tuneOpenAiDirectPayload(p, 'off', OFFICIAL);
    expect(p.reasoning_effort).toBeUndefined();
  });

  it('已带协议标记(codex 订阅)勿动', () => {
    const p = { ...base(), [PROTOCOL_MARK]: 'openai-responses' };
    tuneOpenAiDirectPayload(p, 'off', 'https://chatgpt.com/backend-api/codex');
    expect(p.reasoning_effort).toBeUndefined();
    expect(p.temperature).toBe(0.7);
  });
});
