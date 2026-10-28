import { listLibraries, readDocument } from './store.js'
import { MomError } from './types.js'

export const MOM_HTTP_PREFIX = '/mom-docs/v1'
const CLIENT_HEADER = 'library'

type HeaderValue = string | string[] | undefined

export type MomHttpRequest = {
  method?: string
  url?: string
  headers: Record<string, HeaderValue>
}

export type MomHttpResponse = {
  writeHead: (status: number, headers?: Record<string, string>) => void
  setHeader?: (name: string, value: string) => void
  end: (body?: string) => void
}

type WebServer = {
  register: (route: {
    kind: 'prefix'
    path: string
    handler: (req: MomHttpRequest, res: MomHttpResponse) => void
  }) => () => void
}

function firstHeader(value: HeaderValue): string {
  const raw = Array.isArray(value) ? value[0] : value
  return String(raw || '').split(',')[0]?.trim() || ''
}

function sendJson(res: MomHttpResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(payload)
}

function rejectBrowser(req: MomHttpRequest): { status: number; message: string } | null {
  if (firstHeader(req.headers['x-dsh-mom-client']) !== CLIENT_HEADER) {
    return { status: 401, message: '资料库页面请求无效' }
  }
  const site = firstHeader(req.headers['sec-fetch-site'])
  if (site && site !== 'same-origin' && site !== 'none') {
    return { status: 403, message: '拒绝跨站读取资料库' }
  }
  const origin = firstHeader(req.headers.origin)
  if (origin) {
    let originHost = ''
    try {
      originHost = new URL(origin).host
    } catch {
      return { status: 403, message: '资料库请求来源无效' }
    }
    const expected = firstHeader(req.headers['x-forwarded-host']) || firstHeader(req.headers.host)
    if (!expected || originHost.toLowerCase() !== expected.toLowerCase()) {
      return { status: 403, message: '拒绝跨源读取资料库' }
    }
  }
  return null
}

export function handleMomRequest(req: MomHttpRequest, res: MomHttpResponse): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader?.('allow', 'GET, HEAD')
    sendJson(res, 405, { ok: false, code: 'write_failed', message: '资料库页面只支持读取' })
    return
  }
  const denied = rejectBrowser(req)
  if (denied) {
    sendJson(res, denied.status, { ok: false, code: 'directory_invalid', message: denied.message })
    return
  }
  let url: URL
  try {
    url = new URL(req.url || '/', 'http://mom-docs.local')
  } catch {
    sendJson(res, 400, { ok: false, code: 'directory_invalid', message: '请求路径无效' })
    return
  }
  const relative = url.pathname.slice(MOM_HTTP_PREFIX.length).replace(/^\/+|\/+$/g, '')
  const directories = url.searchParams.getAll('directory')
  const directory = directories[0] || ''
  try {
    if (relative === 'files') {
      const listed = listLibraries(directories)
      const body = { ok: true, workspaces: listed.workspaces }
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end()
        return
      }
      sendJson(res, 200, body)
      return
    }
    if (relative === 'file') {
      const date = url.searchParams.get('date') || ''
      const name = url.searchParams.get('name') || ''
      const doc = readDocument(directory, date, name)
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end()
        return
      }
      sendJson(res, 200, {
        ok: true,
        directory,
        date: doc.date,
        fileName: doc.fileName,
        content: doc.content,
      })
      return
    }
    sendJson(res, 404, { ok: false, code: 'filename_invalid', message: '没有这个资料库接口' })
  } catch (err) {
    const failed = err instanceof MomError ? err : new MomError('write_failed', '读取失败')
    sendJson(res, 400, { ok: false, code: failed.code, message: failed.message })
  }
}

export function registerMomHttp(webServer: WebServer): () => void {
  return webServer.register({
    kind: 'prefix',
    path: MOM_HTTP_PREFIX,
    handler: (req, res) => {
      try {
        handleMomRequest(req, res)
      } catch {
        sendJson(res, 500, { ok: false, code: 'write_failed', message: '读取失败' })
      }
    },
  })
}
