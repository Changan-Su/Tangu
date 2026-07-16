import { describe, it, expect } from 'vitest'
import { wavBase64 } from './useVoiceInput'

// 本地 SenseVoice 直接吃这个 WAV,编错=整段转写变垃圾,故校验头部字段 + 采样量化。
describe('wavBase64 (16-bit mono PCM WAV encode)', () => {
  it('emits canonical 16k mono header + clamped/quantized samples', () => {
    const pcm = new Float32Array([0, 0.5, -0.5, 1, -1])
    const bin = atob(wavBase64(pcm, 16000))
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const dv = new DataView(bytes.buffer)
    const tag = (o: number) => String.fromCharCode(...bytes.subarray(o, o + 4))

    expect(tag(0)).toBe('RIFF')
    expect(tag(8)).toBe('WAVE')
    expect(tag(12)).toBe('fmt ')
    expect(dv.getUint16(20, true)).toBe(1)          // PCM
    expect(dv.getUint16(22, true)).toBe(1)          // mono
    expect(dv.getUint32(24, true)).toBe(16000)      // sample rate
    expect(dv.getUint16(34, true)).toBe(16)         // bits per sample
    expect(tag(36)).toBe('data')
    expect(dv.getUint32(40, true)).toBe(pcm.length * 2)
    // 量化:0.5→+16383(0.5*0x7fff 截断)、-0.5→-16384、+1→32767、-1→-32768
    expect(dv.getInt16(44 + 0, true)).toBe(0)
    expect(dv.getInt16(44 + 2, true)).toBe(16383)
    expect(dv.getInt16(44 + 4, true)).toBe(-16384)
    expect(dv.getInt16(44 + 6, true)).toBe(32767)
    expect(dv.getInt16(44 + 8, true)).toBe(-32768)
  })
})
