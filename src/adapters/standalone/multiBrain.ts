/**
 * standalone 多 provider brain —— 接缝② `brain.llm` 的 dispatcher。
 *
 * 包住一个 httpBrain(Forsion 托管面),只覆写 `llm`:本地注册表命中 → 走 openaiCompat 直连用户自有
 * provider;未命中 → 委托 httpBrain(经 brain-api 用 Forsion 托管模型,计费在云端)。
 * memory / skills / search / users / models / storage 全透传 httpBrain。
 *
 * 「Forsion 只是其中一个 provider」即在此体现:Forsion 是兜底的托管面,直连 provider 与其平级。
 */
import type { CloudBrainServices, BuildPayloadOpts, StreamOpts } from '../../seams/cloudBrain.js';
import type { ProviderRegistry } from '../../llm/providerRegistry.js';
import { buildOpenAiCompatPayload, streamOpenAiCompat, DIRECT_MARK } from '../../llm/openaiCompat.js';

export function createMultiBrain(httpBrain: CloudBrainServices, registry: ProviderRegistry): CloudBrainServices {
  return {
    ...httpBrain,
    models: {
      ...httpBrain.models,
      // 直连 provider 目录(模型选择器用;剥掉 apiKey/baseUrl,只下发 id 与模型白名单)。
      listDirectProviders: () =>
        registry.list().map((p) => ({ providerId: p.providerId, modelIds: p.modelIds })),
    },
    llm: {
      resolveModelAndKey: async (modelId: string) => {
        const local = registry.resolve(modelId);
        if (local) return local; // local.model 带 DIRECT_MARK
        return httpBrain.llm.resolveModelAndKey(modelId);
      },
      buildProviderPayload: async (opts: BuildPayloadOpts) => {
        if ((opts.model as any)?.[DIRECT_MARK]) return buildOpenAiCompatPayload(opts);
        return httpBrain.llm.buildProviderPayload(opts);
      },
      streamProviderCompletion: async (opts: StreamOpts) => {
        if ((opts.payload as any)?.[DIRECT_MARK]) return streamOpenAiCompat(opts);
        return httpBrain.llm.streamProviderCompletion(opts);
      },
    },
  };
}
