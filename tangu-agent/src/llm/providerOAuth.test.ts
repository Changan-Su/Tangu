import { describe, it, expect, afterEach, vi } from 'vitest';
import { fetchProviderModels } from './providerOAuth.js';

describe('fetchProviderModels', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('parses { data: [{ id }] } (Claude / OpenAI shape)', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [{ id: 'claude-x' }, { id: 'claude-y' }] }) }));
    const r = await fetchProviderModels({ protocol: 'anthropic-messages', baseUrl: 'https://api.anthropic.com' } as any, 'tok');
    expect(r).toEqual(['claude-x', 'claude-y']);
  });

  it('parses [{ slug, visibility }] and drops hidden (Codex shape); URL carries client_version', async () => {
    let calledUrl = '';
    vi.stubGlobal('fetch', (url: string) => {
      calledUrl = url;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ // 真实端点顶层是 { models: [...] }(2026-07-17 实测),非裸数组
          models: [
            { slug: 'gpt-5.6-sol', visibility: 'list' },
            { slug: 'codex-auto-review', visibility: 'hide' },
          ],
        }),
      });
    });
    const r = await fetchProviderModels({ protocol: 'openai-responses', baseUrl: 'https://chatgpt.com/backend-api/codex' } as any, 'tok', 'acct');
    expect(r).toEqual(['gpt-5.6-sol']);
    // 回归:Codex 后端缺 client_version query 直接 400 → 实拉永远失败,用户被冻结在硬编快照上看不到新模型。
    expect(calledUrl).toContain('client_version=');
  });

  it('returns null on http error (→ caller falls back to curated hints)', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
    const r = await fetchProviderModels({ protocol: 'openai', baseUrl: 'https://api.x.ai/v1' } as any, 'tok');
    expect(r).toBeNull();
  });
});
