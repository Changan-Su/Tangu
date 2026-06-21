/**
 * 微信 iLink Bot API 精简客户端。基于 Echo 的已验证实现泛化到 Tangu：
 * QR 登录、长轮询取消息、文本回复。v1 只处理文本与语音转写文本。
 */
import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';

export const ILINK_BASE_URL = 'https://ilinkai.weixin.qq.com';
// 微信 c2c 媒体 CDN(发送图片/文件:先把密文 POST 到此处,拿 x-encrypted-param 再 sendmessage 引用)。
const ILINK_CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c';
const ILINK_APP_ID = 'bot';
const CHANNEL_VERSION = '2.2.0';
const ILINK_APP_CLIENT_VERSION = (2 << 16) | (2 << 8) | 0;

const EP_GET_UPDATES = 'ilink/bot/getupdates';
const EP_SEND_MESSAGE = 'ilink/bot/sendmessage';
const EP_GET_BOT_QR = 'ilink/bot/get_bot_qrcode';
const EP_GET_QR_STATUS = 'ilink/bot/get_qrcode_status';
const EP_SEND_TYPING = 'ilink/bot/sendtyping';
const EP_GET_CONFIG = 'ilink/bot/getconfig';
const EP_GET_UPLOAD_URL = 'ilink/bot/getuploadurl';

export const SESSION_EXPIRED_ERRCODE = -14;
export const RATE_LIMIT_ERRCODE = -2;
export const LONG_POLL_TIMEOUT_MS = 35_000;

const ITEM_TEXT = 1;
const ITEM_IMAGE = 2;
const ITEM_VOICE = 3;
const ITEM_FILE = 4;
const MSG_TYPE_BOT = 2;
const MSG_STATE_FINISH = 2;
const API_TIMEOUT_MS = 15_000;
const QR_TIMEOUT_MS = 35_000;
const TYPING_START = 1;
const TYPING_STOP = 2;
// getuploadurl 的 media_type(与 item type 不同表):图片=1、视频=2、文件=3。
const MEDIA_IMAGE = 1;
const MEDIA_FILE = 3;
const MEDIA_UPLOAD_TIMEOUT_MS = 120_000;

export type IlinkMediaKind = 'image' | 'file';

// ── 媒体 AES-128-ECB(PKCS7)──。发送：用 16 字节随机 key 加密原文,密文 POST 到 CDN;
//    sendmessage 里携带的 aes_key = base64(该 key 的 32 字符 hex 串)——必须是 hex 串再 base64,
//    直接 base64(原始 16 字节)会导致对端解不出(图片显示灰块)。
function aesEcbPaddedSize(plaintextSize: number): number {
  return Math.ceil((plaintextSize + 1) / 16) * 16;
}
function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-ecb', key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

export interface IlinkInboundMessage {
  from_user_id?: string;
  message_id?: string;
  context_token?: string;
  item_list?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

export interface IlinkUpdate {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: IlinkInboundMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

export interface IlinkSendResult {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  [k: string]: unknown;
}

export interface QrStart {
  qrcode: string;
  qrcodeImg: string;
}

export interface QrStatus {
  status: string;
  redirectHost?: string;
  accountId?: string;
  token?: string;
  baseUrl?: string;
  userId?: string;
}

function randomWechatUin(): string {
  return String(randomBytes(4).readUInt32BE(0));
}

function postHeaders(token: string | undefined, body: string): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'Content-Length': String(Buffer.byteLength(body, 'utf8')),
    'X-WECHAT-UIN': randomWechatUin(),
    'iLink-App-Id': ILINK_APP_ID,
    'iLink-App-ClientVersion': String(ILINK_APP_CLIENT_VERSION),
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

const getHeaders: Record<string, string> = {
  'iLink-App-Id': ILINK_APP_ID,
  'iLink-App-ClientVersion': String(ILINK_APP_CLIENT_VERSION),
};

async function fetchJson(
  url: string,
  init: { method: string; body?: string; headers: Record<string, string> },
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...init, signal: ctrl.signal });
    const raw = await resp.text();
    if (!resp.ok) throw new Error(`iLink HTTP ${resp.status}: ${raw.slice(0, 200)}`);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } finally {
    clearTimeout(timer);
  }
}

export function extractText(itemList: Array<Record<string, unknown>> | undefined): string {
  for (const item of itemList ?? []) {
    if (item?.type === ITEM_TEXT) return String((item.text_item as any)?.text ?? '');
  }
  for (const item of itemList ?? []) {
    if (item?.type === ITEM_VOICE) {
      const t = String((item.voice_item as any)?.text ?? '');
      if (t) return t;
    }
  }
  return '';
}

export function isSessionExpired(u: { ret?: number; errcode?: number; errmsg?: string }): boolean {
  if (u.ret === SESSION_EXPIRED_ERRCODE || u.errcode === SESSION_EXPIRED_ERRCODE) return true;
  return (
    (u.ret === RATE_LIMIT_ERRCODE || u.errcode === RATE_LIMIT_ERRCODE) &&
    (u.errmsg || '').toLowerCase() === 'unknown error'
  );
}

export function isRateLimited(u: { ret?: number; errcode?: number; errmsg?: string }): boolean {
  if (isSessionExpired(u)) return false;
  return u.ret === RATE_LIMIT_ERRCODE || u.errcode === RATE_LIMIT_ERRCODE;
}

export class IlinkClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private async post(endpoint: string, payload: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>> {
    const body = JSON.stringify({ ...payload, base_info: { channel_version: CHANNEL_VERSION } });
    const url = `${this.baseUrl.replace(/\/+$/, '')}/${endpoint}`;
    return fetchJson(url, { method: 'POST', body, headers: postHeaders(this.token, body) }, timeoutMs);
  }

  async getUpdates(syncBuf: string, timeoutMs = LONG_POLL_TIMEOUT_MS): Promise<IlinkUpdate> {
    try {
      return (await this.post(EP_GET_UPDATES, { get_updates_buf: syncBuf }, timeoutMs)) as IlinkUpdate;
    } catch (e: any) {
      if (e?.name === 'AbortError') return { ret: 0, msgs: [], get_updates_buf: syncBuf };
      throw e;
    }
  }

  async sendText(to: string, text: string, contextToken?: string, clientId?: string): Promise<IlinkSendResult> {
    const msg: Record<string, unknown> = {
      from_user_id: '',
      to_user_id: to,
      client_id: clientId || randomUUID(),
      message_type: MSG_TYPE_BOT,
      message_state: MSG_STATE_FINISH,
      item_list: [{ type: ITEM_TEXT, text_item: { text } }],
    };
    if (contextToken) msg.context_token = contextToken;
    return (await this.post(EP_SEND_MESSAGE, { msg }, API_TIMEOUT_MS)) as IlinkSendResult;
  }

  /** 取 typing ticket(iLink「正在输入」凭据,约 600s TTL;getconfig 端点)。 */
  async getTypingTicket(ilinkUserId: string, contextToken?: string): Promise<string> {
    const payload: Record<string, unknown> = { ilink_user_id: ilinkUserId };
    if (contextToken) payload.context_token = contextToken;
    const r = await this.post(EP_GET_CONFIG, payload, API_TIMEOUT_MS);
    return String(r.typing_ticket ?? '');
  }

  /** 向某用户发送「正在输入」状态(on=true 开始 / false 停止;sendtyping 端点)。 */
  async sendTyping(toUserId: string, typingTicket: string, on: boolean): Promise<void> {
    await this.post(
      EP_SEND_TYPING,
      { ilink_user_id: toUserId, typing_ticket: typingTicket, status: on ? TYPING_START : TYPING_STOP },
      API_TIMEOUT_MS,
    );
  }

  /** POST 密文到 CDN(完整 URL 由调用方按 upload_full_url / upload_param 决定),取回 x-encrypted-param。parentSignal:run 中止时联动取消(最长 120s 的步骤)。 */
  private async uploadCdn(uploadUrl: string, ciphertext: Buffer, parentSignal?: AbortSignal): Promise<string> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), MEDIA_UPLOAD_TIMEOUT_MS);
    const onParentAbort = (): void => ctrl.abort();
    if (parentSignal) {
      if (parentSignal.aborted) ctrl.abort();
      else parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
    try {
      const resp = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(ciphertext),
        signal: ctrl.signal,
      });
      if (!resp.ok) throw new Error(`iLink CDN upload HTTP ${resp.status}`);
      const param = resp.headers.get('x-encrypted-param');
      if (!param) throw new Error('iLink CDN upload: missing x-encrypted-param');
      return param;
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onParentAbort);
    }
  }

  /**
   * 发送图片 / 文件给某用户。三步:getuploadurl → AES-128-ECB 加密后 POST 到 CDN → sendmessage 引用密文。
   * 任一步上游业务错误(ret/errcode)由 getuploadurl/CDN 抛出;最终 sendmessage 的结果原样返回(调用方判 ret)。
   */
  async sendMedia(
    to: string,
    buffer: Buffer,
    opts: { kind: IlinkMediaKind; fileName: string },
    contextToken?: string,
    signal?: AbortSignal,
  ): Promise<IlinkSendResult> {
    const mediaType = opts.kind === 'image' ? MEDIA_IMAGE : MEDIA_FILE;
    const rawsize = buffer.length;
    const rawfilemd5 = createHash('md5').update(buffer).digest('hex');
    const filesize = aesEcbPaddedSize(rawsize);
    const filekey = randomBytes(16).toString('hex');
    const aesKey = randomBytes(16);
    const aesKeyHex = aesKey.toString('hex');

    const up = await this.post(
      EP_GET_UPLOAD_URL,
      { filekey, media_type: mediaType, to_user_id: to, rawsize, rawfilemd5, filesize, no_need_thumb: true, aeskey: aesKeyHex },
      API_TIMEOUT_MS,
    );
    if (isSessionExpired(up as any)) return up as IlinkSendResult; // 让调用方按会话过期处理(清 context / 提示重连)
    // iLink 不同账号/版本二选一返回:upload_full_url(直接给完整 CDN URL,优先)或 upload_param(需自拼 CDN URL)。
    const uploadFullUrl = String((up as any).upload_full_url ?? '');
    const uploadParam = String((up as any).upload_param ?? '');
    const uploadUrl = uploadFullUrl
      || (uploadParam ? `${ILINK_CDN_BASE_URL}/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${encodeURIComponent(filekey)}` : '');
    if (!uploadUrl) throw new Error(`iLink getuploadurl 未返回 upload_full_url/upload_param:${JSON.stringify(up).slice(0, 300)}`);

    const ciphertext = encryptAesEcb(buffer, aesKey);
    const downloadParam = await this.uploadCdn(uploadUrl, ciphertext, signal);

    const media = { encrypt_query_param: downloadParam, aes_key: Buffer.from(aesKeyHex, 'ascii').toString('base64'), encrypt_type: 1 };
    const item = opts.kind === 'image'
      ? { type: ITEM_IMAGE, image_item: { media, mid_size: filesize } }
      : { type: ITEM_FILE, file_item: { media, file_name: opts.fileName, len: String(rawsize) } };
    const msg: Record<string, unknown> = {
      from_user_id: '',
      to_user_id: to,
      client_id: randomUUID(),
      message_type: MSG_TYPE_BOT,
      message_state: MSG_STATE_FINISH,
      item_list: [item],
    };
    if (contextToken) msg.context_token = contextToken;
    return (await this.post(EP_SEND_MESSAGE, { msg }, API_TIMEOUT_MS)) as IlinkSendResult;
  }

  static async qrStart(baseUrl = ILINK_BASE_URL, botType = '3'): Promise<QrStart> {
    const url = `${baseUrl.replace(/\/+$/, '')}/${EP_GET_BOT_QR}?bot_type=${botType}`;
    const r = await fetchJson(url, { method: 'GET', headers: getHeaders }, QR_TIMEOUT_MS);
    return { qrcode: String(r.qrcode ?? ''), qrcodeImg: String(r.qrcode_img_content ?? '') };
  }

  static async qrStatus(baseUrl: string, qrcode: string): Promise<QrStatus> {
    const url = `${baseUrl.replace(/\/+$/, '')}/${EP_GET_QR_STATUS}?qrcode=${encodeURIComponent(qrcode)}`;
    const r = await fetchJson(url, { method: 'GET', headers: getHeaders }, QR_TIMEOUT_MS);
    return {
      status: String(r.status ?? 'wait'),
      redirectHost: r.redirect_host ? String(r.redirect_host) : undefined,
      accountId: r.ilink_bot_id ? String(r.ilink_bot_id) : undefined,
      token: r.bot_token ? String(r.bot_token) : undefined,
      baseUrl: r.baseurl ? String(r.baseurl) : undefined,
      userId: r.ilink_user_id ? String(r.ilink_user_id) : undefined,
    };
  }
}
