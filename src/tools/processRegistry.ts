/**
 * 后台进程注册表(host 模式):run_bash background:true 启动的子进程按 session 登记,
 * list_processes / read_process_output / kill_process 据此管理。
 *   - 输出进 ring buffer(每进程 200KB 上限,超出丢头留尾)
 *   - 进程退出后保留记录与输出(可读尾巴),完成态记录 30 分钟后由 reaper 清理
 *   - dispose()(模块卸载/进程退出)SIGKILL 所有在跑子进程,防泄漏
 */
import { spawn, type ChildProcess } from 'node:child_process';

const OUTPUT_CAP = 200_000;
const FINISHED_TTL_MS = 30 * 60 * 1000;
const MAX_PER_SESSION = 10;

export interface BackgroundProcess {
  id: string;
  sessionId: string;
  command: string;
  pid: number | null;
  status: 'running' | 'exited' | 'killed' | 'error';
  exitCode: number | null;
  startedAt: number;
  endedAt: number | null;
  output: string; // stdout+stderr 合流 ring buffer
  truncated: boolean;
  child: ChildProcess | null;
}

const procs = new Map<string, BackgroundProcess>(); // id -> proc
let seq = 0;
let reaper: ReturnType<typeof setInterval> | null = null;
let exitHookInstalled = false;

function ensureReaper(): void {
  if (reaper) return;
  reaper = setInterval(() => {
    const now = Date.now();
    for (const [id, p] of procs) {
      if (p.status !== 'running' && p.endedAt && now - p.endedAt > FINISHED_TTL_MS) procs.delete(id);
    }
    if (!procs.size && reaper) {
      clearInterval(reaper);
      reaper = null;
    }
  }, 60_000);
  reaper.unref?.();
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    process.on('exit', () => {
      for (const p of procs.values()) if (p.child && p.status === 'running') p.child.kill('SIGKILL');
    });
  }
}

function append(p: BackgroundProcess, chunk: string): void {
  p.output += chunk;
  if (p.output.length > OUTPUT_CAP) {
    p.output = p.output.slice(p.output.length - OUTPUT_CAP);
    p.truncated = true;
  }
}

export function startBackgroundProcess(sessionId: string, command: string, cwd: string): BackgroundProcess | string {
  const running = [...procs.values()].filter((p) => p.sessionId === sessionId && p.status === 'running');
  if (running.length >= MAX_PER_SESSION) {
    return `Error: 本会话已有 ${running.length} 个后台进程在跑(上限 ${MAX_PER_SESSION});先 kill_process 清理。`;
  }
  const id = `bg_${Date.now().toString(36)}_${++seq}`;
  let child: ChildProcess;
  try {
    child = spawn(command, { cwd, shell: true, detached: false });
  } catch (e: any) {
    return `Error: spawn failed: ${e?.message || e}`;
  }
  const p: BackgroundProcess = {
    id, sessionId, command, pid: child.pid ?? null,
    status: 'running', exitCode: null,
    startedAt: Date.now(), endedAt: null,
    output: '', truncated: false, child,
  };
  child.stdout?.on('data', (d) => append(p, d.toString()));
  child.stderr?.on('data', (d) => append(p, d.toString()));
  child.on('error', (e: any) => {
    append(p, `\n[error] ${e?.message || e}`);
    p.status = 'error';
    p.endedAt = Date.now();
    p.child = null;
  });
  child.on('close', (code) => {
    if (p.status === 'running') p.status = code === null ? 'killed' : 'exited';
    p.exitCode = code;
    p.endedAt = Date.now();
    p.child = null;
  });
  procs.set(id, p);
  ensureReaper();
  return p;
}

export function listProcesses(sessionId: string): BackgroundProcess[] {
  return [...procs.values()].filter((p) => p.sessionId === sessionId);
}

export function getProcess(sessionId: string, id: string): BackgroundProcess | null {
  const p = procs.get(id);
  return p && p.sessionId === sessionId ? p : null;
}

export function killProcess(sessionId: string, id: string): string {
  const p = getProcess(sessionId, id);
  if (!p) return `Error: 进程 ${id} 不存在`;
  if (p.status !== 'running' || !p.child) return `进程 ${id} 已结束(status=${p.status})`;
  p.status = 'killed';
  p.endedAt = Date.now();
  try {
    p.child.kill('SIGTERM');
    const child = p.child;
    setTimeout(() => child.kill('SIGKILL'), 3000).unref?.();
  } catch {
    /* 已退出 */
  }
  return `killed ${id} (pid ${p.pid})`;
}

/** 模块卸载/dispose:杀掉所有在跑子进程 + 停 reaper。 */
export function disposeAllProcesses(): void {
  for (const p of procs.values()) {
    if (p.child && p.status === 'running') {
      p.status = 'killed';
      p.endedAt = Date.now();
      try { p.child.kill('SIGKILL'); } catch { /* ignore */ }
    }
  }
  procs.clear();
  if (reaper) {
    clearInterval(reaper);
    reaper = null;
  }
}
