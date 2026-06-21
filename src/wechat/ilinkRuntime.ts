/**
 * 多账号 iLink 长轮询运行时。账号 token 只保存在 ~/.tangu/wechat，不进入数据库。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  IlinkClient,
  ILINK_BASE_URL,
  LONG_POLL_TIMEOUT_MS,
  extractText,
  isRateLimited,
  isSessionExpired,
  type IlinkInboundMessage,
  type IlinkMediaKind,
} from './ilinkClient.js';

export interface AccountCredentials {
  accountId: string;
  token: string;
  baseUrl?: string;
}

interface AccountState extends AccountCredentials {
  baseUrl: string;
  syncBuf: string;
  contextTokens: Record<string, string>;
}

export interface IlinkRuntimeOptions {
  stateDir: string;
  onMessage: (msg: { accountId: string; openid: string; text: string; messageId?: string }) => Promise<string>;
  onSessionExpired?: (accountId: string) => void;
  logger?: (level: 'info' | 'warn' | 'error', msg: string) => void;
}

const RETRY_DELAY_MS = 2_000;
const BACKOFF_DELAY_MS = 30_000;
const SESSION_EXPIRED_PAUSE_MS = 600_000;
const DEDUP_TTL_MS = 300_000;
const DEDUP_MAX = 2_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class IlinkRuntime {
  private readonly accounts = new Map<string, AccountState>();
  private readonly clients = new Map<string, IlinkClient>();
  private readonly running = new Set<string>();
  private readonly dedup = new Map<string, Map<string, number>>();
  // typing ticket 缓存:key=`${accountId}:${openid}` → {ticket, expiresAt}(iLink ticket ~600s TTL)。
  private readonly typingTickets = new Map<string, { ticket: string; expiresAt: number }>();
  private shuttingDown = false;
  private readonly log: (level: 'info' | 'warn' | 'error', msg: string) => void;

  constructor(private readonly opts: IlinkRuntimeOptions) {
    this.log = opts.logger ?? ((level, msg) => {
      const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
      fn(`[tangu-wechat] ${msg}`);
    });
  }

  private accountsFile(): string {
    return path.join(this.opts.stateDir, 'accounts.json');
  }

  private stateFile(accountId: string): string {
    return path.join(this.opts.stateDir, `${encodeURIComponent(accountId)}.state.json`);
  }

  private async readJson<T>(file: string, fallback: T): Promise<T> {
    try { return JSON.parse(await fs.readFile(file, 'utf8')) as T; }
    catch { return fallback; }
  }

  private async writeJson(file: string, data: unknown): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(tmp, file);
  }

  async loadAccounts(): Promise<void> {
    await fs.mkdir(this.opts.stateDir, { recursive: true });
    const creds = await this.readJson<AccountCredentials[]>(this.accountsFile(), []);
    for (const c of creds) await this.hydrate(c);
    this.log('info', `loaded ${this.accounts.size} account(s)`);
  }

  private async hydrate(c: AccountCredentials): Promise<AccountState> {
    const persisted = await this.readJson<{ syncBuf?: string; contextTokens?: Record<string, string> }>(this.stateFile(c.accountId), {});
    const state: AccountState = {
      accountId: c.accountId,
      token: c.token,
      baseUrl: c.baseUrl || ILINK_BASE_URL,
      syncBuf: persisted.syncBuf ?? '',
      contextTokens: persisted.contextTokens ?? {},
    };
    this.accounts.set(c.accountId, state);
    this.clients.set(c.accountId, new IlinkClient(state.baseUrl, state.token));
    return state;
  }

  private async persistAccountList(): Promise<void> {
    const list: AccountCredentials[] = Array.from(this.accounts.values()).map((a) => ({
      accountId: a.accountId,
      token: a.token,
      baseUrl: a.baseUrl,
    }));
    await this.writeJson(this.accountsFile(), list);
  }

  private persistState(a: AccountState): Promise<void> {
    return this.writeJson(this.stateFile(a.accountId), { syncBuf: a.syncBuf, contextTokens: a.contextTokens });
  }

  async addAccount(c: AccountCredentials): Promise<void> {
    const state = await this.hydrate(c);
    await this.persistAccountList();
    await this.persistState(state);
    if (!this.shuttingDown) this.start(c.accountId);
  }

  async removeAccount(accountId: string): Promise<void> {
    this.stop(accountId);
    this.accounts.delete(accountId);
    this.clients.delete(accountId);
    await this.persistAccountList();
  }

  startAll(): void {
    this.shuttingDown = false;
    for (const id of this.accounts.keys()) this.start(id);
  }

  start(accountId: string): void {
    if (this.running.has(accountId) || !this.accounts.has(accountId)) return;
    this.running.add(accountId);
    void this.pollLoop(accountId);
  }

  stop(accountId: string): void {
    this.running.delete(accountId);
  }

  shutdown(): void {
    this.shuttingDown = true;
    this.running.clear();
  }

  status(): Array<{ accountId: string; running: boolean; peers: number }> {
    return Array.from(this.accounts.values()).map((a) => ({
      accountId: a.accountId,
      running: this.running.has(a.accountId),
      peers: Object.keys(a.contextTokens).length,
    }));
  }

  async send(accountId: string, openid: string, text: string): Promise<{ ok: boolean; error?: string }> {
    const account = this.accounts.get(accountId);
    const client = this.clients.get(accountId);
    if (!account || !client) return { ok: false, error: `unknown account ${accountId}` };
    try {
      await this.sendWithContext(account, client, openid, text);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  /**
   * 发送图片 / 文件给某用户(走 context_token,会话过期则清缓存)。
   * 与文本不同:媒体上游业务错误会被显式上报(ok:false),让工具/用户知道是否送达。
   */
  async sendMedia(
    accountId: string,
    openid: string,
    buffer: Buffer,
    opts: { kind: IlinkMediaKind; fileName: string },
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; error?: string }> {
    const account = this.accounts.get(accountId);
    const client = this.clients.get(accountId);
    if (!account || !client) return { ok: false, error: `unknown account ${accountId}` };
    try {
      const res = await client.sendMedia(openid, buffer, opts, account.contextTokens[openid], signal);
      if (isSessionExpired(res)) {
        delete account.contextTokens[openid];
        await this.persistState(account);
        return { ok: false, error: '微信会话已过期,请让对方重新发一条消息或在 Desktop 重新扫码。' };
      }
      if ((res.ret ?? 0) !== 0 || (res.errcode ?? 0) !== 0) {
        return { ok: false, error: `iLink 发送失败(ret=${res.ret ?? ''} errcode=${res.errcode ?? ''} ${res.errmsg ?? ''})`.trim() };
      }
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  /**
   * 给某用户发送「正在输入」状态(best-effort,失败静默)。
   * iLink 需先 getconfig 拿 typing_ticket(按 peer 缓存,~600s TTL)再 sendtyping。
   */
  async setTyping(accountId: string, openid: string, on: boolean): Promise<void> {
    const account = this.accounts.get(accountId);
    const client = this.clients.get(accountId);
    if (!account || !client) return;
    const key = `${accountId}:${openid}`;
    try {
      let entry = this.typingTickets.get(key);
      if (!entry || entry.expiresAt <= Date.now()) {
        const ticket = await client.getTypingTicket(openid, account.contextTokens[openid]);
        if (!ticket) return;
        entry = { ticket, expiresAt: Date.now() + 580_000 };
        this.typingTickets.set(key, entry);
      }
      await client.sendTyping(openid, entry.ticket, on);
    } catch (e: any) {
      this.log('warn', `[${accountId}] setTyping failed: ${e?.message || e}`);
    }
  }

  private async pollLoop(accountId: string): Promise<void> {
    const account = this.accounts.get(accountId)!;
    const client = this.clients.get(accountId)!;
    let timeoutMs = LONG_POLL_TIMEOUT_MS;
    let failures = 0;
    this.log('info', `poll loop started: ${accountId}`);
    while (this.running.has(accountId) && !this.shuttingDown) {
      try {
        const resp = await client.getUpdates(account.syncBuf, timeoutMs);
        if (typeof resp.longpolling_timeout_ms === 'number' && resp.longpolling_timeout_ms > 0) timeoutMs = resp.longpolling_timeout_ms;
        const ret = resp.ret ?? 0;
        const errcode = resp.errcode ?? 0;
        if (ret !== 0 || errcode !== 0) {
          if (isSessionExpired(resp)) {
            this.opts.onSessionExpired?.(accountId);
            this.log('error', `[${accountId}] session expired; paused until re-login`);
            await sleep(SESSION_EXPIRED_PAUSE_MS);
            continue;
          }
          failures += 1;
          this.log('warn', `[${accountId}] getUpdates ret=${ret} err=${errcode} (${failures})`);
          await sleep(failures >= 3 ? BACKOFF_DELAY_MS : RETRY_DELAY_MS);
          if (failures >= 3) failures = 0;
          continue;
        }
        failures = 0;
        const nextBuf = String(resp.get_updates_buf ?? '');
        if (nextBuf && nextBuf !== account.syncBuf) {
          account.syncBuf = nextBuf;
          await this.persistState(account);
        }
        for (const msg of resp.msgs ?? []) {
          await this.handleMessage(account, client, msg).catch((e: any) =>
            this.log('error', `[${accountId}] handle message failed: ${e?.message || e}`),
          );
        }
      } catch (e: any) {
        failures += 1;
        this.log('error', `[${accountId}] poll error: ${e?.message || e}`);
        await sleep(failures >= 3 ? BACKOFF_DELAY_MS : RETRY_DELAY_MS);
        if (failures >= 3) failures = 0;
      }
    }
    this.running.delete(accountId);
    this.log('info', `poll loop stopped: ${accountId}`);
  }

  private isDuplicate(accountId: string, messageId: string): boolean {
    if (!messageId) return false;
    let m = this.dedup.get(accountId);
    if (!m) {
      m = new Map();
      this.dedup.set(accountId, m);
    }
    const now = Date.now();
    if (m.has(messageId) && (m.get(messageId) ?? 0) > now) return true;
    m.set(messageId, now + DEDUP_TTL_MS);
    if (m.size > DEDUP_MAX) {
      for (const [k, exp] of m) if (exp <= now) m.delete(k);
    }
    return false;
  }

  private async handleMessage(account: AccountState, client: IlinkClient, msg: IlinkInboundMessage): Promise<void> {
    const openid = String(msg.from_user_id ?? '').trim();
    if (!openid || openid === account.accountId) return;
    const messageId = String(msg.message_id ?? '');
    if (this.isDuplicate(account.accountId, messageId)) return;
    const contextToken = String(msg.context_token ?? '').trim();
    if (contextToken && account.contextTokens[openid] !== contextToken) {
      account.contextTokens[openid] = contextToken;
      await this.persistState(account);
    }
    const text = extractText(msg.item_list).trim();
    if (!text) return;
    const reply = await this.opts.onMessage({ accountId: account.accountId, openid, text, messageId });
    if (reply) await this.sendWithContext(account, client, openid, reply);
  }

  private async sendWithContext(account: AccountState, client: IlinkClient, openid: string, text: string): Promise<void> {
    const ctx = account.contextTokens[openid];
    let res = await client.sendText(openid, text, ctx);
    if (isSessionExpired(res) && ctx) {
      delete account.contextTokens[openid];
      await this.persistState(account);
      res = await client.sendText(openid, text);
    }
    if (isRateLimited(res)) this.log('warn', `[${account.accountId}] send rate-limited for ${openid}`);
  }
}
