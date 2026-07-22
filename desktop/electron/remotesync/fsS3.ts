/**
 * S3 兼容后端(AWS S3 / 阿里 OSS / 腾讯 COS / MinIO / Cloudflare R2)。
 *
 * 改编自 remotely-save `src/fsS3.ts`(Apache-2.0,Copyright remotely-save contributors,
 * 见本目录 LICENSE / NOTICE.md)。主要修改(License 4(b) 声明):
 *  - 去除 Obsidian requestUrl 定制 HTTP handler(Node 无 CORS,直接用 SDK 默认 handler)
 *  - 去除合成目录缓存 / useAccurateMTime 逐对象 HEAD / mkdir:本层引擎文件驱动,目录对象一律跳过
 *  - 接口精简为 RemoteFs(walk/readFile/writeFile/rm/check)
 * 保留:分页列举、multipart 上传、rclone 兼容的 MTime/CTime 元数据(秒)。
 */
import { Readable } from 'node:stream'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandInput,
  S3Client,
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import type { RemoteEntity, RemoteFs } from './types'

export interface S3Config {
  endpoint: string
  region: string
  accessKeyID: string
  secretAccessKey: string
  bucket: string
  /** 远端目录前缀(自动规整为 `x/` 或空)。 */
  prefix?: string
  forcePathStyle?: boolean
  partsConcurrency?: number
}

/** 规整 prefix:'' | 'a/b/'。 */
export function normPrefix(x: string | undefined): string {
  let y = (x ?? '').trim().replace(/\\/g, '/').replace(/\/+/g, '/')
  if (y === '' || y === '/' || y === '.') return ''
  if (y.startsWith('/')) y = y.slice(1)
  if (!y.endsWith('/')) y = `${y}/`
  return y
}

async function bodyToBuffer(b: unknown): Promise<Buffer> {
  if (b == null) throw new Error('S3 GetObject returned empty body')
  if (b instanceof Readable) {
    const chunks: Buffer[] = []
    for await (const chunk of b) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    return Buffer.concat(chunks)
  }
  if (typeof (b as Blob).arrayBuffer === 'function') {
    return Buffer.from(await (b as Blob).arrayBuffer())
  }
  throw new Error('unsupported S3 body type')
}

/** 与 rclone / remotely-save 兼容的元数据 mtime(秒;旧数据可能是毫秒)。 */
function metaMtimeMs(meta: Record<string, string> | undefined): number {
  const raw = Number.parseFloat(meta?.mtime || meta?.MTime || '0')
  if (!Number.isFinite(raw) || raw === 0) return 0
  return raw >= 1000000000000 ? Math.floor(raw) : Math.floor(raw * 1000)
}

export function createS3Remote(cfg: S3Config): RemoteFs {
  let endpoint = cfg.endpoint.trim()
  if (endpoint !== '' && !/^https?:\/\//.test(endpoint)) endpoint = `https://${endpoint}`
  const prefix = normPrefix(cfg.prefix)
  const client = new S3Client({
    region: cfg.region || 'us-east-1',
    ...(endpoint ? { endpoint } : {}),
    forcePathStyle: cfg.forcePathStyle ?? false,
    credentials: { accessKeyId: cfg.accessKeyID, secretAccessKey: cfg.secretAccessKey },
  })
  const full = (key: string): string => `${prefix}${key}`

  return {
    kind: 's3',
    async walk(signal) {
      const out: RemoteEntity[] = []
      const cmd: ListObjectsV2CommandInput = { Bucket: cfg.bucket }
      if (prefix) cmd.Prefix = prefix
      let truncated = true
      while (truncated) {
        const rsp = await client.send(new ListObjectsV2Command(cmd), { abortSignal: signal })
        for (const obj of rsp.Contents ?? []) {
          const raw = obj.Key
          if (!raw || raw.endsWith('/')) continue // 目录对象跳过(文件驱动)
          if (prefix && !raw.startsWith(prefix)) continue
          const key = raw.slice(prefix.length)
          if (!key) continue
          const mtimeMs = obj.LastModified ? Math.floor(obj.LastModified.valueOf() / 1000) * 1000 : 0
          const size = obj.Size ?? 0
          out.push({ key, size, mtimeMs, id: obj.ETag ?? `${mtimeMs}:${size}` })
        }
        truncated = rsp.IsTruncated ?? false
        if (truncated) {
          if (!rsp.NextContinuationToken) throw new Error('S3 list truncated without continuation token')
          cmd.ContinuationToken = rsp.NextContinuationToken
        }
      }
      return out
    },
    async readFile(key, signal) {
      const rsp = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: full(key) }), { abortSignal: signal })
      return bodyToBuffer(rsp.Body)
    },
    async writeFile(key, data, mtimeMs, signal) {
      const upload = new Upload({
        client,
        queueSize: cfg.partsConcurrency ?? 5,
        partSize: 5 * 1024 * 1024,
        leavePartsOnError: false,
        params: {
          Bucket: cfg.bucket,
          Key: full(key),
          Body: data,
          Metadata: { MTime: `${mtimeMs / 1000.0}`, CTime: `${mtimeMs / 1000.0}` },
        },
      })
      // 超时/中止必须真取消 multipart,否则"被判超时的上传"可能在后台完成、盖掉后来的新版本
      const onAbort = (): void => {
        void upload.abort().catch(() => {})
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      try {
        const done = await upload.done()
        const etag = (done as { ETag?: string }).ETag
        const mt = metaMtimeMs({ MTime: `${mtimeMs / 1000.0}` }) || mtimeMs
        return { key, size: data.byteLength, mtimeMs: mt, id: etag ?? `${mt}:${data.byteLength}` }
      } finally {
        signal?.removeEventListener('abort', onAbort)
      }
    },
    async rm(key, signal) {
      await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: full(key) }), { abortSignal: signal })
    },
    async check() {
      try {
        const cmd: ListObjectsV2CommandInput = { Bucket: cfg.bucket, MaxKeys: 1 }
        if (prefix) cmd.Prefix = prefix
        await client.send(new ListObjectsV2Command(cmd))
        return { ok: true }
      } catch (e) {
        let msg = String((e as Error)?.message || e)
        if (cfg.endpoint.includes(cfg.bucket)) msg += '(endpoint 里似乎包含了 bucket 名,请去掉后重试)'
        return { ok: false, error: msg }
      }
    },
  }
}
