import type { ConnectorConfig, MesKind, QueryResult } from '../types.js'
import { mockQuery } from './mock-data.js'
import { truncate } from '../util.js'
import { readWorkbuddyMes } from '../workbuddy_mes.js'

const KINDS = new Set<MesKind>([
  'work_order',
  'yield',
  'scrap',
  'wip',
  'oee',
  'inventory',
  'capacity',
  'output',
])

export const MES_KIND_HELP =
  'work_order | yield | scrap | wip | oee | inventory | capacity | output'

export function normalizeMesKind(raw: string): MesKind | null {
  const s = String(raw || '').trim() as MesKind
  return KINDS.has(s) ? s : null
}

/** mock 用面板开关；http 时只读系统配置，不采用插件账本里的密钥。 */
export function resolveMesConnector(cfg: ConnectorConfig): ConnectorConfig {
  if (cfg.mode === 'mock') return cfg
  const wb = readWorkbuddyMes()
  return {
    ...cfg,
    baseUrl: wb.baseUrl,
    username: wb.username,
    password: wb.password,
    token: wb.token,
    enterpriseCode: wb.enterpriseCode || cfg.enterpriseCode.trim() || '江西中软',
  }
}

type TokenCache = { token: string; at: number; baseUrl: string }

let tokenCache: TokenCache | null = null

async function login(cfg: ConnectorConfig): Promise<string> {
  if (cfg.token.trim()) return cfg.token.trim()
  const base = cfg.baseUrl.trim().replace(/\/+$/, '')
  if (!base) {
    const err = new Error('未配置 MES 地址')
    ;(err as Error & { code?: string }).code = 'connector_unconfigured'
    throw err
  }
  if (tokenCache && tokenCache.baseUrl === base && Date.now() - tokenCache.at < 25 * 60 * 1000) {
    return tokenCache.token
  }
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: cfg.username,
      password: cfg.password,
      enterprise_code: cfg.enterpriseCode || '江西中软',
    }),
    signal: AbortSignal.timeout(15000),
  })
  const text = await res.text()
  if (!res.ok) {
    const err = new Error(`MES 登录失败 HTTP ${res.status}：${text.slice(0, 180)}`)
    ;(err as Error & { code?: string }).code = 'connect_failed'
    throw err
  }
  let data: Record<string, unknown> = {}
  try {
    data = JSON.parse(text) as Record<string, unknown>
  } catch {
    data = {}
  }
  const token = String(data.access_token || data.token || '').trim()
  if (!token) {
    const err = new Error('MES 登录响应缺少 token')
    ;(err as Error & { code?: string }).code = 'connect_failed'
    throw err
  }
  tokenCache = { token, at: Date.now(), baseUrl: base }
  return token
}

async function mesGet(cfg: ConnectorConfig, path: string, params?: Record<string, string>): Promise<unknown> {
  const base = cfg.baseUrl.trim().replace(/\/+$/, '')
  const token = await login(cfg)
  const url = new URL(base + path)
  for (const [k, v] of Object.entries(params || {})) {
    if (v) url.searchParams.set(k, v)
  }
  const doGet = async (bearer: string) =>
    fetch(url, {
      headers: { Authorization: `Bearer ${bearer}` },
      signal: AbortSignal.timeout(20000),
    })
  let res = await doGet(token)
  if (res.status === 401) {
    tokenCache = null
    res = await doGet(await login(cfg))
  }
  const text = await res.text()
  if (!res.ok) {
    const err = new Error(`GET ${path} 失败 HTTP ${res.status}：${text.slice(0, 180)}`)
    ;(err as Error & { code?: string }).code = 'mes_failed'
    throw err
  }
  try {
    return JSON.parse(text)
  } catch {
    return { raw: truncate(text, 4000) }
  }
}

export async function probeMes(cfg: ConnectorConfig): Promise<QueryResult> {
  const live = resolveMesConnector(cfg)
  if (live.mode === 'mock') {
    return { ok: true, source: 'mock', detail: 'mock 模式无需连真实 MES，演示工单 WO-20260918-01 可用' }
  }
  try {
    await login(live)
    return { ok: true, source: 'http', detail: '已登录 MES（凭证来自系统配置或本连接器已填项）' }
  } catch (e) {
    const err = e as Error & { code?: string }
    return { ok: false, source: 'http', code: err.code || 'connect_failed', detail: err.message }
  }
}

function clipData(data: unknown): unknown {
  const text = JSON.stringify(data)
  if (text.length <= 8000) return data
  return { truncated: true, preview: JSON.parse(truncate(text, 8000)) }
}

export async function queryMes(cfg: ConnectorConfig | undefined, kindRaw: string, keyword: string, from = '', to = ''): Promise<QueryResult> {
  if (!cfg || !cfg.enabled) {
    return {
      ok: false,
      source: 'none',
      code: 'connector_disabled',
      detail: 'MES 连接器未启用。请到左侧栏「专家·技能·连接器」打开公司 MES，或使用现网 mes_ask。',
    }
  }
  const kind = normalizeMesKind(kindRaw)
  if (!kind) {
    return {
      ok: false,
      source: 'none',
      code: 'invalid_kind',
      detail: `kind 只允许 ${MES_KIND_HELP}`,
    }
  }
  const live = resolveMesConnector(cfg)
  if (live.mode === 'mock') return mockQuery(kind, keyword)

  if (!live.baseUrl.trim()) {
    return {
      ok: false,
      source: 'none',
      code: 'connector_unconfigured',
      detail: '未配置 MES。请到 WorkBuddy「系统配置」填写 MES 访问地址，或本连接器改用 mock 演示。',
    }
  }

  try {
    if (kind === 'work_order') {
      const key = keyword.trim()
      if (key && !key.includes(' ')) {
        try {
          const one = await mesGet(live, `/api/work-orders/${encodeURIComponent(key)}`)
          return { ok: true, source: 'http', detail: `已取工单 ${key}`, data: clipData(one) }
        } catch {
          /* 回落到列表 */
        }
      }
      const data = await mesGet(live, '/api/work-orders', {
        page: '1',
        page_size: '20',
        keyword: key,
      })
      return { ok: true, source: 'http', detail: key ? `已查询工单关键词 ${key}` : '已查询工单列表', data: clipData(data) }
    }
    if (kind === 'wip') {
      const data = await mesGet(live, '/api/work-orders', { page: '1', page_size: '50', status: 'in_progress' })
      return { ok: true, source: 'http', detail: '已查询在制工单', data: clipData(data) }
    }
    if (kind === 'yield') {
      const kpi = await mesGet(live, '/api/quality/kpi', { date_from: from, date_to: to })
      const process = await mesGet(live, '/api/quality/process-yield', { date_from: from, date_to: to })
      return { ok: true, source: 'http', detail: '已查询良率 KPI / 工序良率', data: clipData({ kpi, process }) }
    }
    if (kind === 'scrap') {
      const defects = await mesGet(live, '/api/quality/top-defects', { date_from: from, date_to: to })
      const dist = await mesGet(live, '/api/quality/defect-distribution', { date_from: from, date_to: to })
      return { ok: true, source: 'http', detail: '已查询报废/缺陷分布', data: clipData({ defects, dist }) }
    }
    if (kind === 'oee') {
      const data = await mesGet(live, '/api/device/oee')
      return { ok: true, source: 'http', detail: '已查询设备 OEE', data: clipData(data) }
    }
    if (kind === 'capacity') {
      const data = await mesGet(live, '/api/device/utilization', { period: 'day' })
      return { ok: true, source: 'http', detail: '已查询设备利用率/稼动', data: clipData(data) }
    }
    if (kind === 'output') {
      const data = await mesGet(live, '/api/reports/daily-output', {
        page: '1',
        page_size: '100',
        date_from: from,
        date_to: to,
      })
      return { ok: true, source: 'http', detail: '已查询日产出', data: clipData(data) }
    }
    const data = await mesGet(live, '/api/warehouse/inventory-stock', { page: '1', page_size: '50', keyword: keyword.trim() })
    return { ok: true, source: 'http', detail: '已查询物料库存', data: clipData(data) }
  } catch (e) {
    const err = e as Error & { code?: string }
    return { ok: false, source: 'http', code: err.code || 'mes_failed', detail: err.message }
  }
}
