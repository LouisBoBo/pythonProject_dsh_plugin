/**
 * MES 只读 HTTP：对照 WorkBuddy engine/app/mes_client.py（登录 JWT + GET）。
 * 不写工单、不改状态；404 记为 not_found 供日报整段省略。
 */
import type { MesSettings } from './config.js'

export class MesHttpError extends Error {
  readonly status: number
  readonly path: string
  constructor(status: number, path: string, message: string) {
    super(message)
    this.name = 'MesHttpError'
    this.status = status
    this.path = path
  }
}

type Json = Record<string, unknown>

function asRecord(v: unknown): Json {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {}
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text.trim()) return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    return { detail: text.slice(0, 200) }
  }
}

async function request(
  cfg: MesSettings,
  path: string,
  init: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const raw = String(path || '').trim()
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('://') || raw.includes('..') || raw.includes('\\')) {
    throw new MesHttpError(0, raw.slice(0, 80), 'MES 路径非法')
  }
  let origin: string
  try {
    const u = new URL(cfg.baseUrl)
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password) {
      throw new Error('bad base')
    }
    origin = `${u.protocol}//${u.host}${u.pathname}`.replace(/\/+$/, '')
  } catch {
    throw new MesHttpError(0, raw, 'MES 地址非法')
  }
  const url = `${origin}${raw}`
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), cfg.timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: ac.signal })
    const body = await readJson(res)
    return { status: res.status, body }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new MesHttpError(0, path, `MES 请求失败：${msg}`)
  } finally {
    clearTimeout(t)
  }
}

export async function mesLogin(cfg: MesSettings): Promise<string> {
  if (cfg.authType === 'token' && cfg.token.trim()) return cfg.token.trim()
  const { status, body } = await request(cfg, '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: cfg.username || '',
      password: cfg.password || '',
      enterprise_code: cfg.enterpriseCode || '江西中软',
    }),
  })
  const rec = asRecord(body)
  if (status !== 200) {
    throw new MesHttpError(status, '/api/auth/login', `MES 登录失败(HTTP ${status})`)
  }
  const tok = String(rec.access_token || rec.token || '').trim()
  if (!tok) throw new MesHttpError(status, '/api/auth/login', 'MES 登录响应缺少 token')
  return tok
}

function queryString(params?: Record<string, string | number | undefined>): string {
  if (!params) return ''
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '') continue
    q.set(k, String(v))
  }
  const s = q.toString()
  return s ? `?${s}` : ''
}

export async function mesGet(
  cfg: MesSettings,
  token: string,
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<unknown> {
  const headers = { Authorization: `Bearer ${token}` }
  const full = `${path}${queryString(params)}`
  let { status, body } = await request(cfg, full, { method: 'GET', headers })
  if (status === 401 && cfg.authType !== 'token') {
    const next = await mesLogin(cfg)
    ;({ status, body } = await request(cfg, full, {
      method: 'GET',
      headers: { Authorization: `Bearer ${next}` },
    }))
  }
  if (status === 404) {
    throw new MesHttpError(404, path, `GET ${path} 失败(HTTP 404)`)
  }
  if (status !== 200) {
    throw new MesHttpError(status, path, `GET ${path} 失败(HTTP ${status})`)
  }
  return body
}

export async function mesGetOptional(
  cfg: MesSettings,
  token: string,
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<unknown | null> {
  try {
    return await mesGet(cfg, token, path, params)
  } catch (e) {
    if (e instanceof MesHttpError && (e.status === 404 || e.status === 405)) return null
    throw e
  }
}

export async function mesListAll(
  cfg: MesSettings,
  token: string,
  path: string,
  extra?: Record<string, string | number | undefined>,
): Promise<{ items: Json[]; total: number }> {
  const items: Json[] = []
  let total = 0
  for (let page = 1; page <= 20; page++) {
    const body = asRecord(await mesGet(cfg, token, path, { page, page_size: 100, ...extra }))
    const chunk = Array.isArray(body.items) ? body.items.filter((x) => x && typeof x === 'object') : []
    items.push(...(chunk as Json[]))
    const t = Number(body.total)
    if (Number.isFinite(t)) total = t
    else total = items.length
    if (chunk.length < 100 || (Number.isFinite(t) && items.length >= t)) break
  }
  return { items, total }
}

export function listItems(body: unknown): Json[] {
  const rec = asRecord(body)
  return Array.isArray(rec.items) ? rec.items.filter((x) => x && typeof x === 'object') as Json[] : []
}
