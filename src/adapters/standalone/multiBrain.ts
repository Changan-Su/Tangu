/**
 * standalone 多 provider brain —— 接缝② `brain.llm` 的 dispatcher。
 *
 * 包住一个 httpBrain(Forsion 托管面),只覆写 `llm`:本地注册表命中 → 走 openaiCompat 直连用户自有
 * provider;未命中 → 委托 httpBrain(经 brain-api 用 Forsion 托管模型,计费在云端)。
 * memory / skills / search / users / models / storage 全透传 httpBrain。
 *
 * 「Forsion 只是其中一个 provider」即在此体现:Forsion 是兜底的托管面,直连 provider 与其平级。
 */
import type { CloudBrainServices, BuildPayloadOpts, StreamOpts, ImageGenRequest, ImageGenResult } from '../../seams/cloudBrain.js';
import type { ProviderRegistry } from '../../llm/providerRegistry.js';
import { buildOpenAiCompatPayload, streamOpenAiCompat, DIRECT_MARK, PROTOCOL_MARK } from '../../llm/openaiCompat.js';
import { streamAnthropicOAuth } from '../../llm/anthropicMessages.js';
import { streamOpenAiResponses } from '../../llm/openaiResponses.js';

// 规范尺寸 → OpenAI 兼容像素(direct provider 用;Forsion /v1/images 自带换算,故仅 direct 需要)。
const DIRECT_IMG_SIZE: Record<string, string> = {
  '1:1': '1024x1024', '3:2': '1792x1024', '16:9': '1792x1024', '2:3': '1024x1792', '9:16': '1024x1792',
};

/** 直连用户自有 OpenAI 兼容端点生图(BYO-key);返回 b64。 */
async function generateDirectImage(baseUrl: string, apiKey: string | undefined, apiModelId: string, req: ImageGenRequest): Promise<ImageGenResult> {
  const raw = req.size || '1:1';
  const size = DIRECT_IMG_SIZE[raw] || (/^\d+x\d+$/.test(raw) ? raw : '1024x1024');
  const r = await fetch(`${baseUrl}/images/generations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey || ''}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: apiModelId, prompt: req.prompt, n: req.n || 1, size, response_format: 'b64_json' }),
    signal: req.signal ?? AbortSignal.timeout(180_000),
  });
  if (!r.ok) throw new Error(`image gen ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  const j: any = await r.json();
  const images = (j?.data || []).filter((d: any) => d?.b64_json).map((d: any) => ({ b64: d.b64_json as string, mime: 'image/png' }));
  if (!images.length) throw new Error('provider 未返回图片');
  return { images };
}

export function createMultiBrain(httpBrain: CloudBrainServices, registry: ProviderRegistry): CloudBrainServices {
  return {
    ...httpBrain,
    models: {
      ...httpBrain.models,
      // 直连 provider 目录(模型选择器/Providers 页用;剥掉 apiKey,baseUrl 仅供 UI 展示)。
      listDirectProviders: () =>
        registry.list().map((p) => ({ providerId: p.providerId, baseUrl: p.baseUrl, modelIds: p.modelIds, imageModelIds: p.imageModelIds })),
    },
    images: {
      // 生图分发:命中直连 provider 的图像模型(imageModelIds 或 <providerId>/<model>)→ 直连用户端点;
      // 否则委托 httpBrain(Forsion 托管 /v1/images)。
      generate: async (req: ImageGenRequest) => {
        for (const p of registry.list()) {
          const slash = req.model.startsWith(p.providerId + '/');
          const apiModelId = slash ? req.model.slice(p.providerId.length + 1) : ((p.imageModelIds || []).includes(req.model) ? req.model : null);
          if (apiModelId) return generateDirectImage(p.baseUrl, p.apiKey, apiModelId, req);
        }
        if (!httpBrain.images) throw new Error('当前未配置云端生图');
        return httpBrain.images.generate(req);
      },
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
        const p = opts.payload as any;
        if (p?.[DIRECT_MARK]) {
          // 订阅登录的原生端点据协议再分发;缺省 OpenAI 兼容。
          if (p[PROTOCOL_MARK] === 'anthropic-messages') return streamAnthropicOAuth(opts);
          if (p[PROTOCOL_MARK] === 'openai-responses') return streamOpenAiResponses(opts);
          return streamOpenAiCompat(opts);
        }
        return httpBrain.llm.streamProviderCompletion(opts);
      },
    },
  };
}
