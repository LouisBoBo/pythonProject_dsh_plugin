import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * 公司模型网关的用量归属：供应商、Key 遮罩、真实模型都由服务器给出。
 * 本地推断只作兜底；服务器连不上时页面保持原样。
 */

export type GatewayEndpoint = {
  /** 网关源站，例如 https://175.178.238.31 */
  origin: string
  /** 会话令牌所在的凭据引用，由宿主 credentials 服务解析 */
  credentialRef: string
}

export type GatewayUsageRow = {
  provider: string
  providerName: string
  keyHint: string
  alias: string
  model: string
  purpose: string
  calls: number
  tokens: number
}

type ReadFile = (path: string) => string | null

const DEFAULT_CREDENTIAL_REF = 'ZR_GATEWAY_TOKEN'
const OFFSET_MS = 8 * 60 * 60 * 1000

function readFileOrNull(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : null
  } catch {
    return null
  }
}

/** 桌面端 profile 的候选位置（macOS + Windows + ~/.dsh），与用量页其它配置同源。 */
export function gatewayProfilePaths(env: NodeJS.ProcessEnv = process.env, home = homedir()): string[] {
  const out: string[] = []
  const push = (path: string) => { if (path && !out.includes(path)) out.push(path) }
  const dsh = (env.DSH_HOME || '').trim() || join(home, '.dsh')
  push(join(dsh, 'profiles', 'desktop', 'cordis.patch.yml'))
  const local = (env.LOCALAPPDATA || '').trim()
  if (local) push(join(local, 'ZR_DSH', 'dsh-home', 'profiles', 'desktop', 'cordis.patch.yml'))
  push(join(home, 'AppData', 'Local', 'ZR_DSH', 'dsh-home', 'profiles', 'desktop', 'cordis.patch.yml'))
  const appData = (env.APPDATA || '').trim()
  if (appData) push(join(appData, 'ZR_DSH', 'dsh-home', 'profiles', 'desktop', 'cordis.patch.yml'))
  return out
}

/**
 * 从生成的 profile 里读网关地址。
 * @param text - cordis.patch.yml 的内容。
 * @returns 源站与凭据引用；没有网关块时返回 null。
 */
export function parseGatewayProfile(text: string): GatewayEndpoint | null {
  const lines = text.split(/\r?\n/)
  let baseUrl = ''
  let credentialRef = ''
  for (let i = 0; i < lines.length; i += 1) {
    const head = lines[i]?.match(/^(\s*)zr-gateway:\s*$/)
    if (!head) continue
    const blockIndent = head[1]?.length ?? 0
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j] ?? ''
      if (line.trim() === '') continue
      const indent = line.length - line.trimStart().length
      if (indent <= blockIndent) break
      const pair = line.match(/^\s*([A-Za-z0-9_]+):\s*(.*?)\s*$/)
      if (!pair) continue
      if (pair[1] === 'baseURL') baseUrl = pair[2] ?? ''
      if (pair[1] === 'apiKeyEnv') credentialRef = pair[2] ?? ''
    }
    break
  }
  if (!baseUrl) return null
  let origin: string
  try {
    const parsed = new URL(baseUrl)
    if (!/^https?:$/.test(parsed.protocol)) return null
    origin = parsed.origin
  } catch {
    return null
  }
  return { origin, credentialRef: credentialRef || DEFAULT_CREDENTIAL_REF }
}

/** @returns profile 里配置的网关，未配置或读不到时返回 null。 */
export function readGatewayEndpoint(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
  read: ReadFile = readFileOrNull,
): GatewayEndpoint | null {
  for (const path of gatewayProfilePaths(env, home)) {
    const text = read(path)
    if (!text) continue
    const endpoint = parseGatewayProfile(text)
    if (endpoint) return endpoint
  }
  return null
}

/**
 * 把页面选中的「某天/某月」换成网关的 [start, end) Unix 秒。
 * @param on - 页面上的日期（YYYY-MM-DD），空串表示今天。
 * @param grain - day 或 month。
 * @param now - 当前时间，测试用。
 */
export function usageWindow(
  on: string,
  grain: 'day' | 'month',
  now = new Date(),
): { start: number; end: number } | null {
  const today = new Date(now.getTime() + OFFSET_MS).toISOString().slice(0, 10)
  const day = /^\d{4}-\d{2}-\d{2}$/.test(on) ? on : today
  if (grain === 'month') {
    const [year, month] = day.slice(0, 7).split('-').map(Number)
    if (!year || !month) return null
    const startMs = Date.UTC(year, month - 1, 1) - OFFSET_MS
    const endMs = Date.UTC(year, month, 1) - OFFSET_MS
    return { start: Math.floor(startMs / 1000), end: Math.floor(endMs / 1000) }
  }
  const startMs = Date.parse(`${day}T00:00:00+08:00`)
  if (!Number.isFinite(startMs)) return null
  return { start: Math.floor(startMs / 1000), end: Math.floor(startMs / 1000) + 86_400 }
}

function count(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 拉取当前登录人的按模型用量；只带会话令牌，服务器不会返回完整 Key。
 * @returns 行数组；网络失败或响应不符合契约时返回 null。
 */
export async function fetchGatewayUsage(
  endpoint: GatewayEndpoint,
  token: string,
  window: { start: number; end: number },
  fetchImpl: typeof fetch = fetch,
): Promise<GatewayUsageRow[] | null> {
  if (!token) return null
  const url = `${endpoint.origin}/v1/usage/models?start=${window.start}&end=${window.end}`
  let body: unknown
  try {
    const response = await fetchImpl(url, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(2500),
    })
    if (!response.ok) return null
    body = await response.json()
  } catch {
    return null
  }
  if (!body || typeof body !== 'object') return null
  const models = (body as { models?: unknown }).models
  if (!Array.isArray(models)) return null
  return models.map((raw) => {
    const row = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const provider = text(row.provider)
    return {
      provider,
      providerName: text(row.providerName) || provider,
      keyHint: text(row.keyHint),
      alias: text(row.alias),
      model: text(row.model),
      purpose: text(row.purpose) || 'llm',
      calls: count(row.calls),
      tokens: count(row.inputTokens) + count(row.outputTokens),
    }
  })
}
