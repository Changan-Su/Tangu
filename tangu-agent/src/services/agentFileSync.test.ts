import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { conflictCopyName, decide, runAgentFilesSync } from './agentFileSync.js';
import type { AgentFileContent, AgentFileMeta, AgentFilesBrain } from '../seams/cloudBrain.js';

const slug = 'cloud-only';
const config = 'name = "Cloud Only"\ncloud_sync = true\nlibrary_order = ["reference.md"]\n';
const contents: Record<string, AgentFileContent> = {
  'config.toml': { content: config, isBinary: false, mtimeMs: 1000, deleted: false },
  'SOUL.md': { content: '云端人格', isBinary: false, mtimeMs: 1001, deleted: false },
  'Library/reference.md': { content: '# 云端资料\n已同步', isBinary: false, mtimeMs: 1002, deleted: false },
};
const metas: AgentFileMeta[] = Object.entries(contents).map(([relPath, f]) => ({
  relPath,
  mtimeMs: f.mtimeMs,
  size: Buffer.byteLength(f.content || ''),
  isBinary: f.isBinary,
  deleted: f.deleted,
}));

let home = '';
let previousHome: string | undefined;

beforeAll(() => {
  previousHome = process.env.TANGU_HOME;
  home = mkdtempSync(path.join(tmpdir(), 'tangu-agent-file-sync-'));
  process.env.TANGU_HOME = home;
});

afterAll(() => {
  if (previousHome === undefined) delete process.env.TANGU_HOME;
  else process.env.TANGU_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

describe('runAgentFilesSync cloud-only bootstrap', () => {
  it('discovers cloud_sync agent from manifest and pulls its Library', async () => {
    const cloud: AgentFilesBrain = {
      getManifest: async () => [{ slug, files: metas }],
      getFile: async (_userId, gotSlug, relPath) => gotSlug === slug ? contents[relPath] || null : null,
      putFile: async (_userId, _slug, _relPath, body) => ({ mtimeMs: body.mtimeMs }),
      deleteFile: async () => {},
    };

    const result = await runAgentFilesSync(cloud, 'user-1', { onlySlug: slug });

    expect(result.ok).toBe(true);
    expect(result.agents).toBe(1);
    expect(result.pulled).toBe(3);
    expect(readFileSync(path.join(home, 'agents', slug, 'config.toml'), 'utf8')).toBe(config);
    expect(readFileSync(path.join(home, 'agents', slug, 'Library', 'reference.md'), 'utf8')).toContain('已同步');
  });
});

// decide 是 desktop reconcile.ts 的移植(全表单测在那边);这里守住移植后的关键语义不漂移。
describe('decide(hash 三方对账移植)', () => {
  const sh = (seq: number, hash: string) => ({ seq, hash });
  const rm = (seq: number, hash: string | null) => ({ seq, hash });

  it('编辑胜删除(两方向)', () => {
    expect(decide('b', sh(3, 'a'), null)).toEqual({ kind: 'pushCreate' }); // 云端删了但本地改过 → 复活
    expect(decide(null, sh(3, 'a'), rm(5, 'b'))).toEqual({ kind: 'pull' }); // 本地删了但云端改过 → 拉回
  });
  it('删除生效(两方向)', () => {
    expect(decide('a', sh(3, 'a'), null)).toEqual({ kind: 'deleteLocal' });
    expect(decide(null, sh(3, 'a'), rm(3, 'a'))).toEqual({ kind: 'pushDelete' });
  });
  it('单侧改动 → 定向传播(CAS 票据)', () => {
    expect(decide('b', sh(3, 'a'), rm(3, 'a'))).toEqual({ kind: 'push', baseSeq: 3 });
    expect(decide('a', sh(3, 'a'), rm(5, 'b'))).toEqual({ kind: 'pull' });
  });
  it('双方都动:内容一致 adopt,不同 conflict(副本,绝不静默覆盖)', () => {
    expect(decide('b', sh(3, 'a'), rm(5, 'b'))).toEqual({ kind: 'adopt' });
    expect(decide('c', sh(3, 'a'), rm(5, 'b'))).toEqual({ kind: 'conflict' });
  });
  it('无基线首配:hash 未知(旧二进制行)永不视作相等', () => {
    expect(decide('a', null, rm(4, null))).toEqual({ kind: 'conflict' });
  });
});

describe('conflictCopyName', () => {
  const now = new Date(2026, 6, 19, 15, 32);
  it('带子目录与扩展名', () => {
    expect(conflictCopyName('Library/notes.md', now)).toBe('Library/notes (conflict 2026-07-19 1532).md');
  });
  it('根级 toml', () => {
    expect(conflictCopyName('config.toml', now)).toBe('config (conflict 2026-07-19 1532).toml');
  });
});
