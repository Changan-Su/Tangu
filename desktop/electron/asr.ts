/**
 * 桌面级共享语音转写(ASR)—— 只在 Electron 主进程,不经引擎/服务端。
 * 自带-key 云端:直连某 provider 的 OpenAI 兼容 /audio/transcriptions(multipart 上传)。
 * 本地 SenseVoice(离线)是后续片,届时在此加 transcribeLocal 分支。
 */

export interface TranscribeCloudOpts {
  baseUrl: string
  apiKey?: string
  /** 上游模型名(如 FunAudioLLM/SenseVoiceSmall、whisper-1)。 */
  model: string
  audio: Buffer
  mime: string
  language?: string
}

/** 音频 mime → 上游期望的文件后缀(部分服务按扩展名判编码)。 */
function extForMime(mime: string): string {
  if (/wav/.test(mime)) return 'wav'
  if (/mp4|m4a|aac/.test(mime)) return 'm4a'
  if (/ogg/.test(mime)) return 'ogg'
  if (/mpeg|mp3/.test(mime)) return 'mp3'
  return 'webm'
}

/** POST 音频到 OpenAI 兼容 /audio/transcriptions(multipart),返回纯文本。 */
export async function transcribeViaOpenAI(o: TranscribeCloudOpts): Promise<string> {
  const url = `${o.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`
  const form = new FormData()
  // Uint8Array.from → 纯 ArrayBuffer 视图(Buffer 的 ArrayBufferLike 不满足 BlobPart)。
  form.append('file', new Blob([Uint8Array.from(o.audio)], { type: o.mime }), `audio.${extForMime(o.mime)}`)
  form.append('model', o.model)
  form.append('response_format', 'json')
  if (o.language) form.append('language', o.language)
  const res = await fetch(url, {
    method: 'POST',
    headers: o.apiKey ? { Authorization: `Bearer ${o.apiKey}` } : {},
    body: form,
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`transcribe ${res.status}: ${detail.slice(0, 300)}`)
  }
  const data = (await res.json().catch(() => ({}))) as { text?: string }
  return (data.text || '').trim()
}

/** Forsion 托管云端转写:桌面主进程直连 Forsion 服务端 /api/brain/transcribe(计费,provider key 不下发)。 */
export async function transcribeViaForsion(o: {
  cloudUrl: string
  token: string
  modelId: string
  audioB64: string
  mime: string
  language?: string
}): Promise<string> {
  const res = await fetch(`${o.cloudUrl.replace(/\/+$/, '')}/api/brain/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${o.token}` },
    body: JSON.stringify({ modelId: o.modelId || undefined, audioBase64: o.audioB64, mime: o.mime, language: o.language, projectSource: 'tangu' }),
  })
  const data = (await res.json().catch(() => ({}))) as { text?: string; detail?: string }
  if (!res.ok) throw new Error(data.detail || `Forsion 转写失败 ${res.status}`)
  return (data.text || '').trim()
}
