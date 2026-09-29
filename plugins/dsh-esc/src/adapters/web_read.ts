/**
 * 公开网页/PDF 转 Markdown。对照 fetch / MarkItDown MCP：走 Jina Reader 免费 HTTP，不另起进程。
 * 只读用户给出的公网 URL（工艺规范、规格书、客诉扫描件链接），禁止内网。
 */
import type { ConnectorConfig, QueryResult } from '../types.js'
import { truncate } from '../util.js'

const JINA = 'https://r.jina.ai/'

function isPrivateIpv4(host: string): boolean {
  const dotted = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (dotted) {
    const parts = dotted.slice(1, 5).map((p) => Number(p))
    if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
    const a = parts[0] as number
    const b = parts[1] as number
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 192 && b === 168) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    return false
  }
  if (/^\d+$/.test(host)) return true
  return false
}

export function isPrivateHttpHost(hostRaw: string): boolean {
  const host = String(hostRaw || '')
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
  if (!host) return true
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localhost') ||
    host.includes('metadata.google')
  ) {
    return true
  }
  if (host.includes(':')) return true
  return isPrivateIpv4(host)
}

export function assertPublicHttpUrl(raw: string): URL {
  const text = String(raw || '').trim()
  if (!text) throw new Error('URL 不能为空')
  const url = new URL(text)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('只允许 http/https')
  if (url.username || url.password) throw new Error('禁止 URL 内带账号口令')
  if (isPrivateHttpHost(url.hostname)) throw new Error('禁止读取本机或内网地址')
  return url
}

export async function probeWebRead(cfg: ConnectorConfig): Promise<QueryResult> {
  if (cfg.mode === 'mock') {
    return { ok: true, source: 'mock', detail: 'mock：不请求 Jina。启用 http 后读取公开 URL' }
  }
  return { ok: true, source: 'http', detail: '网页阅读走 Jina Reader，不必填密钥' }
}

export async function readPublicUrl(cfg: ConnectorConfig | undefined, urlRaw: string): Promise<QueryResult> {
  if (!cfg?.enabled) {
    return {
      ok: false,
      source: 'none',
      code: 'connector_disabled',
      detail: '网页阅读连接器未启用。请到「专家·技能·连接器」打开。',
    }
  }
  let url: URL
  try {
    url = assertPublicHttpUrl(urlRaw)
  } catch (e) {
    return { ok: false, source: 'none', code: 'invalid_kind', detail: e instanceof Error ? e.message : String(e) }
  }
  if (cfg.mode === 'mock') {
    return { ok: true, source: 'mock', detail: 'mock：未实际抓取', data: { url: url.href, markdown: '(演示) 未请求公网' } }
  }
  try {
    const res = await fetch(JINA + url.href, {
      headers: { Accept: 'text/plain', 'X-Timeout': '20' },
      signal: AbortSignal.timeout(25000),
    })
    const text = await res.text()
    if (!res.ok) {
      return { ok: false, source: 'http', code: 'connect_failed', detail: `阅读服务 HTTP ${res.status}` }
    }
    const markdown = truncate(text.trim() || '(空)', 8000)
    return { ok: true, source: 'http', detail: `已读取 ${url.href}`, data: { url: url.href, markdown } }
  } catch (e) {
    return { ok: false, source: 'http', code: 'connect_failed', detail: e instanceof Error ? e.message : String(e) }
  }
}
