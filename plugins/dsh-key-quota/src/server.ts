import { randomBytes } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { syncCursorUsage } from './cursor-ledger.js'
import { panelUsage } from './engine-usage.js'
import { dispatch, isLoopback, type DispatchDeps, type DispatchResult } from './http.js'
import { keyIdOf, tailOf } from './key-id.js'

/** 同事要填的地址。本机回环一定有，再附上当前网卡的 IPv4。 */
export function advertiseUrls(port: number): string[] {
  const urls = [`http://127.0.0.1:${port}`]
  for (const list of Object.values(networkInterfaces())) {
    for (const info of list || []) {
      if (!info || info.internal) continue
      if (info.family !== 'IPv4') continue
      if (info.address.startsWith('169.254.')) continue
      const url = `http://${info.address}:${port}`
      if (!urls.includes(url)) urls.push(url)
    }
  }
  urls.sort((a, b) => rank(b) - rank(a))
  return urls
}

function rank(url: string): number {
  if (url.includes('192.168.')) return 2
  if (url.includes('127.0.0.1')) return 0
  return 1
}

export function loadReportToken(dir: string, configured: string, create: boolean): string {
  if (configured) return configured
  if (!create) return ''
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'report-token')
  if (existsSync(path)) {
    const text = readFileSync(path, 'utf8').trim()
    if (text) return text
  }
  const token = randomBytes(24).toString('hex')
  writeFileSync(path, `${token}\n`)
  return token
}

export type QuotaLogger = {
  info?: (message: string) => void
  warn?: (message: string) => void
}

function allowOrigin(origin: string): string {
  if (!origin) return 'http://127.0.0.1'
  // 桌面窗口的页面地址是 dsh-app://app，不是 http://127.0.0.1。
  if (origin === 'dsh-app://app') return origin
  try {
    const url = new URL(origin)
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return origin
  } catch {
    return 'http://127.0.0.1'
  }
  return 'http://127.0.0.1'
}

function send(req: IncomingMessage, res: ServerResponse, result: DispatchResult): void {
  const origin = allowOrigin(String(req.headers.origin || ''))
  res.writeHead(result.status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization, content-type, x-key-id',
    'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
    'access-control-allow-private-network': 'true',
    vary: 'Origin',
  })
  res.end(JSON.stringify(result.body))
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buf.length
    if (size > 1_000_000) throw new Error('body too large')
    chunks.push(buf)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (!text) return {}
  return JSON.parse(text) as unknown
}

export async function loadClientPanel(opts: {
  apiKey: string
  quotaBaseUrl: string
  reportToken: string
  fetchImpl?: typeof fetch
}): Promise<Record<string, unknown>> {
  const empty = {
    ok: true,
    self: null,
    keys: null,
    canAppoint: false,
    appointList: null,
    reportToken: '',
    hint: '',
  }
  if (!opts.apiKey) {
    return { ...empty, hint: '未配置 DeepSeek Key。请到系统配置填写。' }
  }
  const selfTail = {
    tail: tailOf(opts.apiKey),
    alias: '',
    role: 'member',
    blocked: false,
    limitTokens: null,
    used: 0,
    period: '',
  }
  if (!opts.quotaBaseUrl) {
    return { ...empty, self: selfTail, hint: '未连接额度服务，不限额。' }
  }
  const fetchImpl = opts.fetchImpl ?? fetch
  const headers = {
    authorization: `Bearer ${opts.reportToken}`,
    'x-key-id': keyIdOf(opts.apiKey),
  }
  try {
    const meRes = await fetchImpl(`${opts.quotaBaseUrl}/v1/me`, { headers, signal: AbortSignal.timeout(3000) })
    const me = await meRes.json() as Record<string, unknown>
    if (!meRes.ok) {
      const err = me.error && typeof me.error === 'object' ? me.error as { message?: string } : {}
      return { ...empty, self: selfTail, hint: err.message || '还没有用量记录。' }
    }
    let keys: unknown = null
    if (me.role === 'admin') {
      const allRes = await fetchImpl(`${opts.quotaBaseUrl}/v1/admin/keys`, { headers, signal: AbortSignal.timeout(3000) })
      const all = await allRes.json() as { keys?: unknown }
      if (allRes.ok && Array.isArray(all.keys)) keys = all.keys
    }
    return { ...empty, self: me, keys, hint: '' }
  } catch {
    return { ...empty, self: selfTail, hint: '额度服务不可达。' }
  }
}

export type QuotaHttpOpts = {
  deps: DispatchDeps
  apiKey: () => string
  clientPanel?: () => Promise<Record<string, unknown>>
  logger?: QuotaLogger
}

function headerValue(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value
  return String(raw || '').split(',')[0]?.trim() || ''
}

async function withUsage(result: DispatchResult, url: string, remoteAddress: string): Promise<DispatchResult> {
  const path = url.split('?')[0]
  if (result.status !== 200 || path !== '/v1/local/panel' || !isLoopback(remoteAddress)) return result
  try {
    await syncCursorUsage()
    return { status: 200, body: { ...result.body, ...panelUsage(url) } }
  } catch {
    return result
  }
}

export async function serveQuota(opts: QuotaHttpOpts, input: {
  method: string
  url: string
  headers: Record<string, string | string[] | undefined>
  remoteAddress: string
  body: unknown
}): Promise<DispatchResult> {
  const path = input.url.split('?')[0]
  if (opts.deps.role !== 'server') {
    if (input.method === 'GET' && path === '/v1/local/panel' && isLoopback(input.remoteAddress)) {
      const body = opts.clientPanel ? await opts.clientPanel() : { ok: true, self: null, keys: null, canAppoint: false }
      return await withUsage({ status: 200, body }, input.url, input.remoteAddress)
    }
    return { status: 404, body: { ok: false, error: { code: 'not_found', message: '这台电脑不提供额度账本。' } } }
  }
  const loopback = isLoopback(input.remoteAddress)
  const key = loopback ? opts.apiKey() : ''
  return await withUsage(await dispatch({
    method: input.method,
    path: input.url,
    headers: input.headers as Record<string, string | undefined>,
    body: input.body,
    remoteAddress: input.remoteAddress,
  }, {
    ...opts.deps,
    localKeyId: loopback ? (key ? keyIdOf(key) : '') : undefined,
  }), input.url, input.remoteAddress)
}

export const QUOTA_WEB_PREFIX = '/key-quota'

type WebReq = {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
  socket?: { remoteAddress?: string }
}

type WebRes = {
  writeHead: (status: number, headers?: Record<string, string>) => void
  end: (body?: string) => void
}

/** 页面和限额端口不是同一个源。面板走宿主自己的 HTTP，避免浏览器拦掉 18790。 */
export function registerQuotaWeb(webServer: {
  register: (route: {
    kind: 'prefix'
    path: string
    handler: (req: WebReq, res: WebRes) => void
  }) => () => void
}, opts: QuotaHttpOpts): () => void {
  return webServer.register({
    kind: 'prefix',
    path: QUOTA_WEB_PREFIX,
    handler(req, res) {
      void (async () => {
        const site = headerValue(req.headers['sec-fetch-site'])
        if (site && site !== 'same-origin' && site !== 'none') {
          sendWeb(res, { status: 403, body: { ok: false, error: { code: 'not_owner', message: '拒绝跨站读取限额面板。' } } })
          return
        }
        const raw = req.url || QUOTA_WEB_PREFIX
        const path = raw.startsWith(QUOTA_WEB_PREFIX) ? (raw.slice(QUOTA_WEB_PREFIX.length) || '/') : raw
        try {
          const body = !req.method || req.method === 'GET' || req.method === 'HEAD' ? {} : await readWebBody(req)
          const remote = req.socket?.remoteAddress || '127.0.0.1'
          const result = await serveQuota(opts, {
            method: req.method || 'GET',
            url: path,
            headers: req.headers,
            remoteAddress: remote,
            body,
          })
          sendWeb(res, result)
        } catch (err) {
          opts.logger?.warn?.(`key-quota: ${err instanceof Error ? err.message : String(err)}`)
          sendWeb(res, { status: 400, body: { ok: false, error: { code: 'not_found', message: '请求无法解析。' } } })
        }
      })()
    },
  })
}

function sendWeb(res: WebRes, result: DispatchResult): void {
  res.writeHead(result.status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(result.body))
}

async function readWebBody(req: WebReq): Promise<unknown> {
  const stream = req as WebReq & AsyncIterable<Buffer | string>
  if (typeof stream[Symbol.asyncIterator] !== 'function') return {}
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buf.length
    if (size > 1_000_000) throw new Error('body too large')
    chunks.push(buf)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (!text) return {}
  return JSON.parse(text) as unknown
}

export function startQuotaServer(opts: QuotaHttpOpts & {
  listen: string
  port: number
}): Server {
  const server = createServer(async (req, res) => {
    if (!req.url || !req.method) return
    if (req.method === 'OPTIONS') {
      send(req, res, { status: 204, body: {} })
      return
    }
    const remote = req.socket.remoteAddress || ''
    try {
      const body = req.method === 'GET' ? {} : await readBody(req)
      const result = await serveQuota(opts, {
        method: req.method,
        url: req.url,
        headers: req.headers as Record<string, string | string[] | undefined>,
        remoteAddress: remote,
        body,
      })
      send(req, res, result)
    } catch (err) {
      opts.logger?.warn?.(`key-quota: ${err instanceof Error ? err.message : String(err)}`)
      send(req, res, { status: 400, body: { ok: false, error: { code: 'not_found', message: '请求无法解析。' } } })
    }
  })
  server.on('error', (err) => {
    opts.logger?.warn?.(`key-quota: 端口 ${opts.port} 未能监听（${err.message}）。聊天不受影响，限额服务未启动。`)
  })
  server.listen(opts.port, opts.listen, () => {
    opts.logger?.info?.(`key-quota: http://${opts.listen}:${opts.port}`)
  })
  return server
}
