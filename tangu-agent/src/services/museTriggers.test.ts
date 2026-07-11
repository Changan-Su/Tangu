import { describe, it, expect } from 'vitest';
import { evaluateTriggers, buildTriggerKickoff, type MuseTrigger } from './museTriggers.js';

function rule(over: Partial<MuseTrigger>): MuseTrigger {
  return {
    id: 'w-test01',
    desc: 'test rule',
    cond: { type: 'event_seen', match: 'x' },
    cooldownHours: 24,
    lastFiredAt: null,
    enabled: true,
    createdAt: '2026-07-10T00:00:00.000Z',
    ...over,
  };
}

const NOW = new Date(2026, 6, 11, 12, 0); // 本地 2026-07-11 12:00

describe('evaluateTriggers', () => {
  it('file_chars_gte:达标命中,未达/不可读不命中', async () => {
    const t = rule({ cond: { type: 'file_chars_gte', path: '/x/a.md', n: 100 } });
    const hit = await evaluateTriggers([t], { now: NOW, readFileChars: async () => 120 });
    expect(hit.map((x) => x.id)).toEqual(['w-test01']);
    expect(await evaluateTriggers([t], { now: NOW, readFileChars: async () => 99 })).toHaveLength(0);
    expect(await evaluateTriggers([t], { now: NOW, readFileChars: async () => null })).toHaveLength(0);
  });

  it('cooldown:期内不复触,过期可再触;disabled 永不触', async () => {
    const base = rule({ cond: { type: 'file_chars_gte', path: '/x/a.md', n: 1 } });
    const env = { now: NOW, readFileChars: async () => 999 };
    const recent = { ...base, lastFiredAt: new Date(NOW.getTime() - 2 * 3600_000).toISOString() };
    expect(await evaluateTriggers([recent], env)).toHaveLength(0);
    const stale = { ...base, lastFiredAt: new Date(NOW.getTime() - 25 * 3600_000).toISOString() };
    expect(await evaluateTriggers([stale], env)).toHaveLength(1);
    const off = { ...base, enabled: false };
    expect(await evaluateTriggers([off], env)).toHaveLength(0);
  });

  it('event_seen:只认 lastFiredAt/创建之后的活动行(不吃存量)', async () => {
    const created = new Date(NOW.getTime() - 3600_000).toISOString(); // 1h 前创建
    const t = rule({ cond: { type: 'event_seen', match: 'xxx.md' }, createdAt: created, cooldownHours: 0 });
    const oldLine = '202607110900 note.edit f="xxx.md" l=1-2'; // 创建之前
    const newLine = '202607111130 note.edit f="xxx.md" l=3-4'; // 创建之后
    expect(await evaluateTriggers([t], { now: NOW, activityLines: [oldLine] })).toHaveLength(0);
    expect(await evaluateTriggers([t], { now: NOW, activityLines: [oldLine, newLine] })).toHaveLength(1);
    expect(await evaluateTriggers([t], { now: NOW, activityLines: ['202607111130 chat.send "别的"'] })).toHaveLength(0);
  });

  it('daily_at 补发语义:过点且距上次 >20h 才触;未到点/当天已触不复触', async () => {
    const t = rule({ cond: { type: 'daily_at', time: '09:00' } });
    expect(await evaluateTriggers([t], { now: NOW })).toHaveLength(1); // 12:00 > 09:00,从未触过
    const before = new Date(2026, 6, 11, 8, 0);
    expect(await evaluateTriggers([t], { now: before })).toHaveLength(0); // 未到点
    const firedToday = { ...t, lastFiredAt: new Date(2026, 6, 11, 9, 5).toISOString() };
    expect(await evaluateTriggers([firedToday], { now: NOW })).toHaveLength(0); // 3h 前触过
    const firedYesterday = { ...t, lastFiredAt: new Date(2026, 6, 10, 9, 5).toISOString() };
    expect(await evaluateTriggers([firedYesterday], { now: NOW })).toHaveLength(1); // 26h 前 → 今天补发
  });
});

describe('buildTriggerKickoff', () => {
  it('空 → 空串;命中 → 英文段 + desc/prompt', () => {
    expect(buildTriggerKickoff([])).toBe('');
    const out = buildTriggerKickoff([
      rule({ desc: '盯 xxx.md 满 100 字', prompt: 'Remind the user.', cond: { type: 'file_chars_gte', path: '/x/xxx.md', n: 100 } }),
    ]);
    expect(out).toContain('[Watch triggers fired this cycle');
    expect(out).toContain('盯 xxx.md 满 100 字');
    expect(out).toContain('Remind the user.');
    expect(out).toContain('100+ non-whitespace chars');
  });
});
