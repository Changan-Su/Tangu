/**
 * sherpa-onnx-node 无自带类型声明,这里只声明本地 ASR 用到的最小面(OfflineRecognizer + readWave)。
 * 完整 API 见包内 types.js(JSDoc)。
 */
declare module 'sherpa-onnx-node' {
  export function readWave(filename: string): { samples: Float32Array; sampleRate: number }
  export class OfflineStream {
    acceptWaveform(w: { samples: Float32Array; sampleRate: number }): void
  }
  export class OfflineRecognizer {
    constructor(config: unknown)
    static createAsync(config: unknown): Promise<OfflineRecognizer>
    createStream(): OfflineStream
    decode(stream: OfflineStream): void
    decodeAsync(stream: OfflineStream): Promise<{ text: string }>
    getResult(stream: OfflineStream): { text: string }
  }
}
