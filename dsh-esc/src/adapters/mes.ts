import type { ConnectorConfig, MesKind, QueryResult } from '../types.js'
import { mockQuery } from './mock-data.js'
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

const CLIP_CHARS = 8000
const CLIP_ITEMS = 40
const LIST_PAGE_SIZE = 100
const LIST_MAX_PAGES = 10

const STATUS_LABELS: Record<string, string> = {
  pending: '待生产',
  in_progress: '生产中',
  completed: '已完成',
  closed: '已关闭',
  cancelled: '已取消',
  draft: '草稿',
}

const DATE_KEYS = [
  'planned_start_time',
  'planned_end_time',
  'actual_start_time',
  'actual_end_time',
  'created_at',
  'updated_at',
  'create_time',
  'plan_start',
]

/** JSON 字符串内不允许的裸控制字符（保留 \t \n \r）。 */
const BARE_CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g

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

function mesError(code: string, message: string): Error {
  const err = new Error(message)
  ;(err as Error & { code?: string }).code = code
  return err
}

/** 清洗后再 parse；禁止把截断后的半截 JSON 丢给 JSON.parse。 */
export function parseMesJson(text: string): unknown {
  const raw = String(text || '')
  const cleaned = raw.replace(BARE_CONTROLS, ' ')
  try {
    return JSON.parse(cleaned)
  } catch (first) {
    try {
      return JSON.parse(raw)
    } catch (second) {
      const msg = second instanceof Error ? second.message : String(second)
      const firstMsg = first instanceof Error ? first.message : String(first)
      throw mesError('mes_failed', `MES 响应不是合法 JSON：${msg || firstMsg}`)
    }
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function itemsOf(data: unknown): unknown[] {
  if (Array.isArray(data)) return data
  const rec = asRecord(data)
  return Array.isArray(rec.items) ? rec.items : []
}

export function rowDateYmd(row: Record<string, unknown>): string {
  for (const k of DATE_KEYS) {
    const s = String(row[k] ?? '').slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  }
  return ''
}

export function countByStatus(items: unknown[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const row of items) {
    if (!row || typeof row !== 'object') continue
    const s = String((row as Record<string, unknown>).status || 'unknown').trim() || 'unknown'
    counts[s] = (counts[s] || 0) + 1
  }
  return counts
}

/** 工单列表按用户窗口过滤；无日期字段的行计入 undated，不混进窗口合计。 */
export function filterItemsByDate(data: unknown, from: string, to: string): unknown {
  const fromY = from.trim()
  const toY = to.trim()
  if (!fromY && !toY) return data
  const rec = Array.isArray(data) ? { items: data, total: data.length } : asRecord(data)
  const src = itemsOf(data)
  if (!src.length && !Array.isArray(rec.items)) return data
  const kept: unknown[] = []
  let undated = 0
  for (const row of src) {
    if (!row || typeof row !== 'object') {
      kept.push(row)
      continue
    }
    const d = rowDateYmd(row as Record<string, unknown>)
    if (!d) {
      undated += 1
      continue
    }
    if (fromY && d < fromY) continue
    if (toY && d > toY) continue
    kept.push(row)
  }
  return {
    ...rec,
    items: kept,
    total: kept.length,
    date_from: fromY || undefined,
    date_to: toY || undefined,
    fetched: src.length,
    undated,
    statusCounts: countByStatus(kept),
    statusLabels: STATUS_LABELS,
  }
}

function clipListEnvelope(rec: Record<string, unknown>, items: unknown[]): Record<string, unknown> {
  const statusCounts = rec.statusCounts && typeof rec.statusCounts === 'object'
    ? rec.statusCounts
    : countByStatus(items)
  const build = (slice: unknown[]) => ({
    truncated: true,
    total: rec.total ?? items.length,
    page: rec.page,
    page_size: rec.page_size,
    date_from: rec.date_from,
    date_to: rec.date_to,
    fetched: rec.fetched ?? items.length,
    undated: rec.undated,
    pages_fetched: rec.pages_fetched,
    itemCount: items.length,
    kept: slice.length,
    statusCounts,
    statusLabels: STATUS_LABELS,
    items: slice,
  })
  let n = Math.min(CLIP_ITEMS, items.length)
  let out = build(items.slice(0, n))
  while (JSON.stringify(out).length > CLIP_CHARS && n > 5) {
    n = Math.max(5, Math.floor(n / 2))
    out = build(items.slice(0, n))
  }
  if (JSON.stringify(out).length > CLIP_CHARS) {
    return {
      truncated: true,
      total: rec.total ?? items.length,
      date_from: rec.date_from,
      date_to: rec.date_to,
      fetched: rec.fetched ?? items.length,
      undated: rec.undated,
      itemCount: items.length,
      kept: 0,
      statusCounts,
      statusLabels: STATUS_LABELS,
      items: [],
    }
  }
  return out
}

/**
 * 超长 MES 结果按列表结构裁剪，禁止 JSON.parse(截断字符串)。
 * 旧实现 truncate 到 7988 再插入换行，会在 position 7988 报 Bad control character。
 */
export function clipData(data: unknown): unknown {
  try {
    const text = JSON.stringify(data)
    if (text.length <= CLIP_CHARS) return data
    if (Array.isArray(data)) return clipListEnvelope({ items: data, total: data.length }, data)
    if (data && typeof data === 'object') {
      const rec = data as Record<string, unknown>
      const items = Array.isArray(rec.items) ? rec.items : null
      if (items) return clipListEnvelope(rec, items)
      return { truncated: true, preview: text.slice(0, 4000), keys: Object.keys(rec) }
    }
    return { truncated: true, preview: text.slice(0, 4000) }
  } catch (e) {
    return { truncated: true, preview: e instanceof Error ? e.message : 'clip_failed' }
  }
}

async function login(cfg: ConnectorConfig): Promise<string> {
  if (cfg.token.trim()) return cfg.token.trim()
  const base = cfg.baseUrl.trim().replace(/\/+$/, '')
  if (!base) throw mesError('connector_unconfigured', '未配置 MES 地址')
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
    throw mesError('connect_failed', `MES 登录失败 HTTP ${res.status}：${text.slice(0, 180)}`)
  }
  let data: Record<string, unknown> = {}
  try {
    data = asRecord(parseMesJson(text))
  } catch {
    data = {}
  }
  const token = String(data.access_token || data.token || '').trim()
  if (!token) throw mesError('connect_failed', 'MES 登录响应缺少 token')
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
    throw mesError('mes_failed', `GET ${path} 失败 HTTP ${res.status}：${text.slice(0, 180)}`)
  }
  return parseMesJson(text)
}

async function fetchWorkOrderPages(
  live: ConnectorConfig,
  extra: Record<string, string>,
): Promise<Record<string, unknown>> {
  const items: unknown[] = []
  let total: unknown
  let pages = 0
  for (let page = 1; page <= LIST_MAX_PAGES; page += 1) {
    const data = await mesGet(live, '/api/work-orders', {
      page: String(page),
      page_size: String(LIST_PAGE_SIZE),
      ...extra,
    })
    pages = page
    const rec = asRecord(data)
    const chunk = itemsOf(data)
    items.push(...chunk)
    if (typeof rec.total === 'number') total = rec.total
    if (chunk.length < LIST_PAGE_SIZE) break
    if (typeof rec.total === 'number' && items.length >= rec.total) break
  }
  return {
    items,
    total: typeof total === 'number' ? total : items.length,
    pages_fetched: pages,
    page_size: LIST_PAGE_SIZE,
    statusCounts: countByStatus(items),
    statusLabels: STATUS_LABELS,
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

export async function queryMes(
  cfg: ConnectorConfig | undefined,
  kindRaw: string,
  keyword: string,
  from = '',
  to = '',
): Promise<QueryResult> {
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

  const windowHint = from || to ? `（窗口 ${from || '…'}～${to || '…'}）` : ''

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
      const extra: Record<string, string> = {}
      if (key) {
        extra.keyword = key
        extra.search = key
      }
      const data = filterItemsByDate(await fetchWorkOrderPages(live, extra), from, to)
      const n = itemsOf(data).length
      return {
        ok: true,
        source: 'http',
        detail: key ? `已查询工单关键词 ${key}${windowHint}` : `已查询工单列表${windowHint}，窗口内 ${n} 条`,
        data: clipData(data),
      }
    }
    if (kind === 'wip') {
      const data = filterItemsByDate(
        await fetchWorkOrderPages(live, { status: 'in_progress' }),
        from,
        to,
      )
      const n = itemsOf(data).length
      return {
        ok: true,
        source: 'http',
        detail: `已查询在制工单${windowHint}，窗口内 ${n} 条`,
        data: clipData(data),
      }
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
    const data = await mesGet(live, '/api/warehouse/inventory-stock', {
      page: '1',
      page_size: '50',
      keyword: keyword.trim(),
    })
    return { ok: true, source: 'http', detail: '已查询物料库存', data: clipData(data) }
  } catch (e) {
    const err = e as Error & { code?: string }
    return { ok: false, source: 'http', code: err.code || 'mes_failed', detail: err.message }
  }
}
