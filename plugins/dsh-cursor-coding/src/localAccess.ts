/**
 * 本机 loopback API 的浏览器访问闸门。
 * - 服务只绑 127.0.0.1，但 CORS=* 时恶意网页仍可 CSRF / 读响应。
 * - 规则：remoteAddress 必须为本机；带 Origin 时必须是 localhost/127.0.0.1。
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

export function isLoopbackRemoteAddress(req: IncomingMessage): boolean {
  const raw = String(req.socket?.remoteAddress || '')
    .trim()
    .toLowerCase()
  return raw === '127.0.0.1' || raw === '::1' || raw === '::ffff:127.0.0.1'
}

/** 本机 remote +（若有 Origin）仅本机 Origin；无 Origin 的本机 Node/curl 放行 */
export function browserOriginAllowed(req: IncomingMessage): boolean {
  if (!isLoopbackRemoteAddress(req)) return false
  const origin = requestOrigin(req)
  if (!origin) return true
  return isLoopbackBrowserOrigin(origin)
}
