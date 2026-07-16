import { describe, it, expect } from 'vitest';
import { createProviderRegistry } from './providerRegistry.js';

// /agent/models 把直连模型暴露为 `<providerId>/<模型>`(修「与云端托管模型同名被去重吞掉」),
// 该约定依赖这里的两种解析形式 —— 契约钉死:形式 1 前缀命中(含模型名自带斜杠)、形式 2 裸名精确命中。
describe('providerRegistry.resolve(直连模型路由表)', () => {
  const reg = createProviderRegistry([
    { providerId: 'openai', baseUrl: 'https://api.openai.com/v1/', apiKey: 'k', modelIds: ['gpt-5.6-luna'] },
    { providerId: 'Other', baseUrl: 'https://api.siliconflow.cn/v1', modelIds: ['zai-org/GLM-5.2'] },
  ]);

  it('形式 1:<providerId>/<模型> 前缀命中,apiModelId 剥掉前缀', () => {
    const r = reg.resolve('openai/gpt-5.6-luna');
    expect(r?.apiModelId).toBe('gpt-5.6-luna');
    expect(r?.baseUrl).toBe('https://api.openai.com/v1'); // 尾斜杠已归一
  });

  it('形式 1:模型名自带斜杠也只剥第一段(Other/zai-org/GLM-5.2)', () => {
    const r = reg.resolve('Other/zai-org/GLM-5.2');
    expect(r?.apiModelId).toBe('zai-org/GLM-5.2');
  });

  it('形式 2:裸名精确命中 modelIds(旧会话存的裸 id 兼容)', () => {
    expect(reg.resolve('gpt-5.6-luna')?.apiModelId).toBe('gpt-5.6-luna');
    expect(reg.resolve('zai-org/GLM-5.2')?.apiModelId).toBe('zai-org/GLM-5.2'); // 带斜杠裸名:前缀查不到 provider 后回落精确命中
  });

  it('未命中 → null;has 与 resolve 一致(agentLoop 降级闸用 has)', () => {
    expect(reg.resolve('gpt-5.5')).toBeNull();
    expect(reg.has('openai/gpt-5.6-luna')).toBe(true);
    expect(reg.has('gpt-5.5')).toBe(false);
  });
});
