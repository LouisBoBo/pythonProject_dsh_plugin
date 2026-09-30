/**
 * 本机 loopback API 的浏览器访问闸门。
 * - 服务只绑 127.0.0.1，但 CORS=* 时恶意网页仍可 CSRF / 读响应。
 * - 规则：带 Origin 时必须是 localhost/127.0.0.1；无 Origin（Node/curl）放行。
 */
import type { IncomingMessage } from 'node:http'

export function requestOrigin(req: IncomingMessage): string {
  return String(req.headers.origin || '').trim()
}

export function isLoopbackBrowserOrigin(origin: string): boolean {
  if (!origin) return false
  try {
    const u = new URL(origin)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost'
  } catch {
    return false
  }
}

/** 浏览器跨域：仅本机 Origin；无 Origin（插件内 Node fetch / 自检）视为可信 */
export function browserOriginAllowed(req: IncomingMessage): boolean {
  const origin = requestOrigin(req)
  if (!origin) return true
  return isLoopbackBrowserOrigin(origin)
}
