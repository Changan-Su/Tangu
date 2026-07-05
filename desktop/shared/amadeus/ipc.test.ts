/** Amadeus 插件 manifest 门禁单测:cmpVersion 排序 + gatePluginManifest 四种情形。 */
import { describe, it, expect } from 'vitest'
import { cmpVersion, gatePluginManifest, AMADEUS_PLUGIN_API } from './ipc'

describe('cmpVersion', () => {
  it('数值逐段比较,缺段=0,前导 v 忽略', () => {
    expect(cmpVersion('1.2.0', '1.10.0')).toBe(-1)
    expect(cmpVersion('v2.0', '2.0.0')).toBe(0)
    expect(cmpVersion('2.0.1', '2.0')).toBe(1)
  })
})

describe('gatePluginManifest', () => {
  it('缺 apiVersion 视为 1 → 放行(存量插件全兼容)', () => {
    expect(gatePluginManifest({}, '2.0.0')).toBeNull()
  })
  it('apiVersion 不等于宿主 → api', () => {
    expect(gatePluginManifest({ apiVersion: AMADEUS_PLUGIN_API + 1 }, '2.0.0')).toBe('api')
    expect(gatePluginManifest({ apiVersion: AMADEUS_PLUGIN_API }, '2.0.0')).toBeNull()
  })
  it('minAppVersion 高于应用版本 → minApp;不高 → 放行', () => {
    expect(gatePluginManifest({ minAppVersion: '99.0.0' }, '2.0.0')).toBe('minApp')
    expect(gatePluginManifest({ minAppVersion: '1.0.0' }, '2.0.0')).toBeNull()
  })
  it('appVersion 未知 → 跳过 minApp 检查(不误杀)', () => {
    expect(gatePluginManifest({ minAppVersion: '99.0.0' }, null)).toBeNull()
  })
})
