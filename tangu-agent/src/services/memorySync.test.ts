import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runMemorySync, mergeText3 } from './memorySync.js';
import { createLocalMemoryStore, type LocalMemoryStore } from '../adapters/standalone/localMemoryBrain.js';
import type { MemoryBrain } from '../seams/cloudBrain.js';

// 两处可改动点之间隔着未变行:diff3 相邻改动会并成同一冲突区,隔开才能各自成干净 hunk。
const BASE = '# 记忆\n\n- 喜欢猫\n\n## 住处\n\n- 住在东京\n';

function mockCloud(initial: { content: string; updatedAt: number }): MemoryBrain & { content: string; setCalls: string[] } {
  const state = { content: initial.content, updatedAt: initial.updatedAt, setCalls: [] as string[] };
  return {
    get content() { return state.content; },
    get setCalls() { return state.setCalls; },
    getMemory: async () => ({ content: state.content, updatedAt: state.updatedAt }),
    setMemory: async (_u: string, content: string) => {
      state.content = content;
      state.updatedAt = Date.now();
      state.setCalls.push(content);
      return { content, updatedAt: state.updatedAt };
    },
    appendMemoryEntry: async () => ({ appended: false, reason: 'empty' as const, length: 0 }),
    appendLogEntry: async () => ({ date: '2026-07-19', time: '00:00' }),
    getLog: async (_u: string, date?: string) => ({ date: date || '2026-07-19', content: '', updatedAt: null }),
  };
}

let dir = '';
let store: LocalMemoryStore;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'tangu-memsync-'));
  store = createLocalMemoryStore(dir);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('memory blob 基线三方同步', () => {
  it('双侧改不同区域 → diff3 干净合并,推合并稿,基线更新', async () => {
    store.writeMemory(BASE.replace('喜欢猫', '喜欢猫(本地补充)'));
    store.writeMemoryBase!(BASE);
    const cloud = mockCloud({ content: BASE.replace('住在东京', '住在京都'), updatedAt: Date.now() + 60_000 });
    const r = await runMemorySync(store, cloud, { userId: 'u1', dates: [] });
    expect(r.ok).toBe(true);
    expect(r.memory).toBe('merged');
    expect(cloud.content).toContain('喜欢猫(本地补充)');
    expect(cloud.content).toContain('住在京都');
    expect(store.readMemory()).toBe(cloud.content);
    expect(store.readMemoryBase!()).toBe(cloud.content);
  });

  it('双侧改同一行 → 脏合并退 LWW,输方存档绝不丢', async () => {
    store.writeMemory(BASE.replace('喜欢猫', '本地版'));
    store.writeMemoryBase!(BASE);
    // 云端时钟更新 → 云端赢;本地版必须进存档
    const cloud = mockCloud({ content: BASE.replace('喜欢猫', '云端版'), updatedAt: Date.now() + 60_000 });
    const r = await runMemorySync(store, cloud, { userId: 'u1', dates: [] });
    expect(r.memory).toBe('pulled');
    expect(store.readMemory()).toContain('云端版');
    const archives = readdirSync(dir).filter((f) => f.startsWith('MEMORY (conflict'));
    expect(archives.length).toBe(1);
  });

  it('仅本地改、但本地时钟落后 → 仍定向推(基线判定与时钟无关)', async () => {
    store.writeMemory(BASE + '- 新增偏好\n');
    store.writeMemoryBase!(BASE);
    const cloud = mockCloud({ content: BASE, updatedAt: Date.now() + 86_400_000 }); // 云端 ts 快一天
    const r = await runMemorySync(store, cloud, { userId: 'u1', dates: [] });
    expect(r.memory).toBe('pushed');
    expect(cloud.content).toContain('新增偏好');
  });
});

describe('mergeText3', () => {
  it('冲突块 → null(绝不出冲突标记)', () => {
    expect(mergeText3('a\nX\nc', 'a\nb\nc', 'a\nY\nc')).toBeNull();
  });
});
