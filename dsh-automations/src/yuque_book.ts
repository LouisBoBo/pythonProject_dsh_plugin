/**
 * 语雀知识库命名空间与 Cookie 头：任务 JSON 只存 group/book，不存凭证。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const RESERVED = new Set([
  'about',
  'api',
  'attachments',
  'dashboard',
  'docs',
  'explore',
  'g',
  'login',
  'notifications',
  'oauth',
  'organizations',
  'privacy',
  'r',
  'register',
  'search',
  'sessions',
  'settings',
  'terms',
])

export const DEFAULT_YUQUE_HOST = 'https://www.yuque.com'

export function yuqueCookiePath(dataRoot: string): string {
  return join(dataRoot, 'credentials', 'yuque.cookie')
}

export function looksLikeYuqueSecret(raw: string): boolean {
  const s = String(raw || '')
  return /_yuque_session\s*=|_yuque_ctoken\s*=|yuque_ctoken\s*=|X-Auth-Token/i.test(s)
}

export function cookieValue(cookie: string, name: string): string {
  const re = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`, 'i')
  const m = String(cookie || '').match(re)
  if (!m) return ''
  try {
    return decodeURIComponent(m[1].trim())
  } catch {
    return m[1].trim()
  }
}

export function yuqueCsrfToken(cookie: string): string {
  return (
    cookieValue(cookie, 'yuque_ctoken') ||
    cookieValue(cookie, '_yuque_ctoken') ||
    cookieValue(cookie, 'ctoken')
  )
}

export function normalizeYuqueHost(raw: string): string {
  let s = String(raw || '').trim().replace(/\/+$/, '')
  if (!s) return DEFAULT_YUQUE_HOST
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return DEFAULT_YUQUE_HOST
      return `${u.protocol}//${u.host}`
    } catch {
      return DEFAULT_YUQUE_HOST
    }
  }
  if (/^[A-Za-z0-9.-]+$/.test(s)) return `https://${s}`
  return DEFAULT_YUQUE_HOST
}

export function normalizeYuqueBook(raw: string): string {
  const s = String(raw || '').trim()
  if (!s) return ''
  if (looksLikeYuqueSecret(s)) {
    throw new Error('语雀 Cookie/Token 不能写进任务。请放到本机凭证文件，不要改仓库配置文件')
  }
  try {
    const u = new URL(s)
    const parts = u.pathname.split('/').filter(Boolean)
    const start = parts[0] && RESERVED.has(parts[0].toLowerCase()) ? 1 : 0
    if (parts.length >= start + 2) {
      return `${parts[start]}/${parts[start + 1]}`
    }
  } catch {
    /* 不是 URL，按 group/book 解析 */
  }
  const m = s.match(/^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/?$/)
  if (m) return `${m[1]}/${m[2]}`
  throw new Error('语雀知识库请填 group/book，或粘贴 https://www.yuque.com/group/book 链接')
}

export function hostFromYuqueUrl(raw: string): string {
  try {
    const u = new URL(String(raw || '').trim())
    if (u.protocol === 'http:' || u.protocol === 'https:') return `${u.protocol}//${u.host}`
  } catch {
    /* ignore */
  }
  return ''
}

export type ParsedCookieFile = { cookie: string; host: string }

export function parseCookieFileText(raw: string): ParsedCookieFile {
  const text = String(raw || '').trim()
  if (!text) return { cookie: '', host: '' }
  if (text.startsWith('{')) {
    try {
      const o = JSON.parse(text) as Record<string, unknown>
      return {
        cookie: String(o.cookie || o.Cookie || '').trim(),
        host: String(o.host || o.YUQUE_HOST || '').trim(),
      }
    } catch {
      /* 当普通 Cookie 文本 */
    }
  }
  let host = ''
  const cookieParts: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const hm = t.match(/^(?:YUQUE_HOST|host)\s*[:=]\s*(.+)$/i)
    if (hm) {
      host = hm[1].trim()
      continue
    }
    const cm = t.match(/^(?:YUQUE_COOKIE|cookie)\s*[:=]\s*(.+)$/i)
    if (cm) {
      cookieParts.push(cm[1].trim())
      continue
    }
    cookieParts.push(t)
  }
  return { cookie: cookieParts.join('; ').replace(/;\s*;/g, '; '), host }
}

export function readYuqueCookieFile(dataRoot: string): ParsedCookieFile {
  const path = yuqueCookiePath(dataRoot)
  if (!existsSync(path)) return { cookie: '', host: '' }
  try {
    return parseCookieFileText(readFileSync(path, 'utf8'))
  } catch {
    return { cookie: '', host: '' }
  }
}

export function yuqueRequestHeaders(opts: {
  host: string
  mode: 'token' | 'cookie'
  token?: string
  cookie?: string
  referer?: string
}): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json; charset=utf-8',
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  }
  if (opts.mode === 'token') {
    headers['X-Auth-Token'] = String(opts.token || '')
    return headers
  }
  const cookie = String(opts.cookie || '')
  headers.Cookie = cookie
  const ctoken = yuqueCsrfToken(cookie)
  if (ctoken) {
    headers['X-Csrf-Token'] = ctoken
    headers['X-CSRF-Token'] = ctoken
  }
  headers['X-Requested-With'] = 'XMLHttpRequest'
  headers.Origin = opts.host
  headers.Referer = opts.referer || `${opts.host}/`
  return headers
}
