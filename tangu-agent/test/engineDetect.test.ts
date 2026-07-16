/**
 * 外部引擎快速检测(isEngineAvailable):配置目录/env/PATH 任一命中即「detected」。
 * 不 spawn、不依赖真实安装——用确定存在的 home 目录与临时 env 覆盖各分支。
 */
import { describe, it, expect } from 'vitest';
import { isEngineAvailable, engineStatus } from '../src/engines/config.js';

const base = { id: 'x', name: 'X', command: 'foo' } as const;

describe('isEngineAvailable — 快速检测', () => {
  it('无 detect 提示 → 默认可用(不隐藏用户自配引擎)', () => {
    expect(isEngineAvailable({ ...base })).toBe(true);
  });

  it('配置目录存在(~ 展开为 home)→ 可用', () => {
    expect(isEngineAvailable({ ...base, detect: { dirs: ['~'] } })).toBe(true);
  });

  it('相关 env 已设 → 可用', () => {
    const KEY = 'TANGU_TEST_ENGINE_KEY_XYZ';
    process.env[KEY] = '1';
    try {
      expect(isEngineAvailable({ ...base, detect: { env: [KEY] } })).toBe(true);
    } finally {
      delete process.env[KEY];
    }
  });

  it('目录/env/bin 全不命中 → 不可用', () => {
    expect(
      isEngineAvailable({
        ...base,
        detect: {
          dirs: ['/nonexistent/forsion/tangu/zzz'],
          env: ['TANGU_DEFINITELY_UNSET_ZZZ'],
          bin: 'tangu-nonexistent-bin-zzz',
        },
      }),
    ).toBe(false);
  });
});

describe('engineStatus — 三态检测', () => {
  const gone = { dirs: ['/nonexistent/forsion/tangu/zzz'], env: ['TANGU_DEFINITELY_UNSET_ZZZ'] };

  it('无 detect → available(不隐藏用户自配引擎)', () => {
    expect(engineStatus({ ...base })).toBe('available');
  });

  it('有鉴权信号(配置目录存在)→ available', () => {
    expect(engineStatus({ ...base, detect: { dirs: ['~'] } })).toBe('available');
  });

  it('有鉴权信号(env 已设)→ available', () => {
    const KEY = 'TANGU_TEST_ENGINE_KEY_XYZ';
    process.env[KEY] = '1';
    try {
      expect(engineStatus({ ...base, detect: { env: [KEY] } })).toBe('available');
    } finally {
      delete process.env[KEY];
    }
  });

  it('bin 在 PATH 但无鉴权信号 → needs-signin(装了没登录)', () => {
    // node 一定在 PATH 上;用它当「已安装的 bin」而无 dirs/env 鉴权信号。
    expect(engineStatus({ ...base, detect: { ...gone, bin: 'node' } })).toBe('needs-signin');
  });

  it('三者全不命中 → not-installed', () => {
    expect(engineStatus({ ...base, detect: { ...gone, bin: 'tangu-nonexistent-bin-zzz' } })).toBe('not-installed');
  });
});
