import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let home: string;
let prevHome: string | undefined;

beforeAll(() => {
  prevHome = process.env.TANGU_HOME;
  home = mkdtempSync(join(tmpdir(), 'tangu-activity-'));
  process.env.TANGU_HOME = home;
});
afterAll(() => {
  if (prevHome === undefined) delete process.env.TANGU_HOME;
  else process.env.TANGU_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

// TANGU_HOME 须在 import 前生效 → 动态 import。
async function mod() {
  return await import('./userActivity.js');
}

describe('formatActivityLine(行格式+消毒)', () => {
  it('基本形态:ts event k=v "片段"', async () => {
    const { formatActivityLine } = await mod();
    const at = new Date(2026, 6, 11, 2, 16); // 本地 2026-07-11 02:16
    const line = formatActivityLine('chat.new', { s: 'a1b2c3', text: '帮我整理今天的任务' }, at)!;
    expect(line).toBe('202607110216 chat.new s=a1b2c3 "帮我整理今天的任务"');
  });
  it('注入防御:换行折叠、双引号降级、事件名非法丢弃、片段截 40', async () => {
    const { formatActivityLine } = await mod();
    const evil = formatActivityLine('note.edit', { f: 'a.md"\n202601010101 fake.event', text: 'x\ny"z' })!;
    expect(evil.split('\n')).toHaveLength(1);
    expect(evil).not.toContain('"\n');
    expect(evil).toContain("a.md' 202601010101 fake.event");
    expect(formatActivityLine('Bad Event!')).toBeNull();
    expect(formatActivityLine('plugin:pid:evt')).toContain(' plugin:pid:evt');
    const long = formatActivityLine('chat.send', { text: '字'.repeat(100) })!;
    expect(long.length).toBeLessThanOrEqual(200);
  });
  it('空值键跳过,含空格值加引号', async () => {
    const { formatActivityLine } = await mod();
    const line = formatActivityLine('view.open', { f: 'Notes/周 计划.md', empty: '', u: undefined })!;
    expect(line).toContain('f="Notes/周 计划.md"');
    expect(line).not.toContain('empty');
  });
});

describe('appendActivityLine + readActivityLines(落盘/过滤/截断)', () => {
  it('往返:追加即可读,残尾行丢弃', async () => {
    const { appendActivityLine, readActivityLines, activityDir } = await mod();
    appendActivityLine('chat.send', { s: 'abc123', text: 'hello' });
    await new Promise((r) => setTimeout(r, 80)); // fire-and-forget 落盘
    // 手工塞一条残尾(模拟并发写入被截断)
    const d = new Date();
    const p = (x: number): string => String(x).padStart(2, '0');
    const file = join(activityDir(), `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.log`);
    await fs.appendFile(file, '20260711'); // 无换行残尾
    const lines = await readActivityLines({ hours: 1 });
    expect(lines.some((l) => l.includes('chat.send'))).toBe(true);
    expect(lines.every((l) => /^\d{12} \S/.test(l))).toBe(true);
  });
  it('hours 窗口过滤 + query 子串过滤 + limit 尾部保留', async () => {
    const { readActivityLines, activityDir, activityTs } = await mod();
    const now = new Date(2026, 6, 11, 12, 0);
    const old = new Date(now.getTime() - 30 * 3600_000); // 30h 前(昨天文件)
    const p = (x: number): string => String(x).padStart(2, '0');
    const df = (d: Date): string => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    await fs.mkdir(activityDir(), { recursive: true });
    await fs.writeFile(join(activityDir(), `${df(old)}.log`), `${activityTs(old)} note.create f=old.md\n`);
    const today = Array.from({ length: 5 }, (_, i) => `${activityTs(new Date(now.getTime() - (5 - i) * 60_000))} note.edit f=new.md l=${i}-${i + 1}`);
    await fs.writeFile(join(activityDir(), `${df(now)}.log`), today.join('\n') + '\n');
    const within = await readActivityLines({ hours: 24, now });
    expect(within.some((l) => l.includes('old.md'))).toBe(false);
    expect(within.filter((l) => l.includes('new.md'))).toHaveLength(5);
    const wide = await readActivityLines({ hours: 48, now });
    expect(wide.some((l) => l.includes('old.md'))).toBe(true);
    const q = await readActivityLines({ hours: 48, now, query: 'l=2-3' });
    expect(q).toHaveLength(1);
    const lim = await readActivityLines({ hours: 24, now, limit: 2 });
    expect(lim).toHaveLength(2);
    expect(lim[1]).toContain('l=4-5'); // 保最新
  });
});
