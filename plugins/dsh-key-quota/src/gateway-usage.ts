/**
 * 用量页改读中软模型网关（接口文档1 · §7.3 / §7.4 / §7.5）。
 * 个人：GET /api/ai/Usage/My + GetUsageList；企业汇总：Summary。
 * LLM 合计与明细只认网关；写码（Cursor）由本机 cursor-ledger 补进，见 overlayCursorFromLocal。
 * 不再向 Usage/Report 上报（由 ensure 去掉 usageReportUrl）。
 */
import { readGatewayEndpoint, type GatewayEndpoint } from './gateway-catalog.js'
import { parseUsageGrain, weekSpan, type DayRow, type PersonRow, type UsageDetailRow, type UsageGrain, type UsageSummary } from './stats.js'

const OFFSET = 8 * 60 * 60 * 1000
const MAX_DETAIL_PAGES = 200
const DETAIL_PAGE_SIZE = 100

export type GatewayPanel = {
  usage: UsageSummary & { source: 'gateway', note: string }
  people: PersonRow[] | null
  viewerAdmin: boolean
  scope: 'personal' | 'enterprise'
  loaded: boolean
  gatewayError?: string
}

type TokenResolve = (ref: string) => Promise<{ value: string } | undefined>

function dayStartMs(ymd: string): number {
  return Date.parse(`${ymd}T00:00:00+08:00`)
}

function dayEndMs(ymd: string): number {
  return dayStartMs(ymd) + 86_400_000 - 1
}

function monthBounds(on: string): { fromYmd: string, toYmd: string, fromMs: number, toMs: number, month: string } {
  const month = /^\d{4}-\d{2}/.test(on) ? on.slice(0, 7) : shanghaiYmd(Date.now()).slice(0, 7)
  const [y, m] = month.split('-').map(Number)
  const fromYmd = `${month}-01`
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const toYmd = `${month}-${String(last).padStart(2, '0')}`
  return {
    month,
    fromYmd,
    toYmd,
    fromMs: dayStartMs(fromYmd),
    toMs: dayEndMs(toYmd),
  }
}

function shanghaiYmd(ms: number): string {
  return new Date(ms + OFFSET).toISOString().slice(0, 10)
}

function shanghaiHour(ms: number): number {
  return new Date(ms + OFFSET).getUTCHours()
}

function shanghaiIso(ms: number): string {
  const sh = new Date(ms + OFFSET)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${sh.getUTCFullYear()}-${p(sh.getUTCMonth() + 1)}-${p(sh.getUTCDate())}T${p(sh.getUTCHours())}:${p(sh.getUTCMinutes())}:${p(sh.getUTCSeconds())}+08:00`
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** 用量/模型接口字段名不固定（Pascal / camel / 大小写混用），按候选键取值。 */
export function pickApiText(row: Record<string, unknown>, keys: readonly string[]): string {
  const lower = new Map<string, unknown>()
  for (const [k, v] of Object.entries(row)) lower.set(k.toLowerCase(), v)
  for (const key of keys) {
    const v = text(lower.get(key.toLowerCase()))
    if (v) return v
  }
  return ''
}

function asObjectList(datas: unknown): Record<string, unknown>[] {
  if (Array.isArray(datas)) {
    return datas.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
  }
  if (!datas || typeof datas !== 'object') return []
  const o = datas as Record<string, unknown>
  for (const key of ['models', 'list', 'rows', 'items', 'records']) {
    if (Array.isArray(o[key])) return asObjectList(o[key])
  }
  return []
}

/** 厂商编号多为 DEEPSEEK 这类全大写代码，展示成 deepseek；已是名称则原样。 */
function displayVendor(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  if (/^[A-Z0-9][A-Z0-9_-]*$/.test(s)) return s.toLowerCase()
  return s
}

export type AliasIdentity = {
  alias: string
  provider: string
  model: string
}

const ALIAS_KEYS = ['CMODEL_ALIAS', 'modelAlias', 'CALIAS', 'alias'] as const
const REAL_MODEL_KEYS = ['CREAL_MODEL', 'realModel', 'CMODEL_NAME', 'CMODEL'] as const
const VENDOR_NO_KEYS = ['CVENDOR_NO', 'vendorNo', 'CPROVIDER', 'provider'] as const
const VENDOR_NAME_KEYS = ['CVENDOR_NAME', 'vendorName', 'providerName'] as const

/** 模型维护列表一行 → 别名对应的真实供应商、真实模型。值全部来自行字段。 */
export function identityFromModelRow(row: Record<string, unknown>): AliasIdentity | null {
  const alias = pickApiText(row, ALIAS_KEYS)
  if (!alias) return null
  const model = pickApiText(row, REAL_MODEL_KEYS) || alias
  const provider = displayVendor(pickApiText(row, VENDOR_NO_KEYS) || pickApiText(row, VENDOR_NAME_KEYS))
  return { alias, provider, model }
}

/**
 * 用量行上的供应商/模型：先读行里已有的真实字段，没有再按别名查模型目录。
 * 禁止写死 zr-gateway / standard；目录也没有时模型退回别名，供应商留空。
 */
export function identityFromUsageRow(
  row: Record<string, unknown>,
  catalog: ReadonlyMap<string, AliasIdentity>,
): { provider: string, model: string } {
  const alias = pickApiText(row, ALIAS_KEYS)
  const hit = alias ? catalog.get(alias.toLowerCase()) : undefined
  const provider = displayVendor(
    pickApiText(row, VENDOR_NO_KEYS) || pickApiText(row, VENDOR_NAME_KEYS) || hit?.provider || '',
  )
  const model = pickApiText(row, REAL_MODEL_KEYS) || hit?.model || alias || '—'
  return { provider, model }
}

async function fetchModelCatalog(
  endpoint: GatewayEndpoint,
  token: string,
  fetchImpl: typeof fetch,
): Promise<Map<string, AliasIdentity>> {
  const map = new Map<string, AliasIdentity>()
  let page = 1
  let total = Infinity
  while (page <= 20 && map.size < total) {
    const got = await gatewayGet(endpoint, token, '/api/ai/Models/GetModelList', {
      pageIndex: page,
      pageSize: 100,
    }, fetchImpl)
    if (!got.ok) break
    total = got.totalRows || 0
    const list = asObjectList(got.datas)
    if (!list.length) break
    for (const raw of list) {
      const id = identityFromModelRow(raw)
      if (!id) continue
      map.set(id.alias.toLowerCase(), id)
    }
    if (list.length < 100) break
    page += 1
  }
  return map
}

/**
 * 从网关登录 JWT 取用户编号/登录名。
 * 用量明细 CUSER_ID 与 My 接口均按 JWT NameIdentifier，不能用引擎 platformSession.id。
 */
export function gatewayUserFromJwt(token: string): { id: string, name: string } {
  const raw = String(token || '').trim()
  const part = raw.split('.')[1]
  if (!part) return { id: '', name: '' }
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const json = JSON.parse(Buffer.from(pad, 'base64').toString('utf8')) as Record<string, unknown>
    const id = text(
      json['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier']
      ?? json.nameid
      ?? json.sub
      ?? json.userId
      ?? json.uid,
    )
    const name = text(
      json['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name']
      ?? json.unique_name
      ?? json.preferred_username
      ?? json.name
      ?? json.loginName,
    )
    return { id, name }
  } catch {
    return { id: '', name: '' }
  }
}

/** 解开宿主 FunctionResult 外壳，取出 Datas / TotalRows / Content。 */
export function unwrapFunctionResult(body: unknown): {
  ok: boolean
  datas: unknown
  totalRows: number
  content: string
} {
  if (!body || typeof body !== 'object') return { ok: false, datas: null, totalRows: 0, content: '空响应' }
  const outer = body as Record<string, unknown>
  const data = outer.data && typeof outer.data === 'object' ? (outer.data as Record<string, unknown>) : outer
  const success = data.Success === true || data.success === true
  const content = text(data.Content) || text(data.content) || text((outer.message as { content?: string } | undefined)?.content)
  const datas = data.Datas !== undefined ? data.Datas : data.datas
  const totalRows = num(data.TotalRows ?? data.totalRows)
  if (outer.success === false || outer.code === 401) {
    return { ok: false, datas: null, totalRows: 0, content: content || '未登录或令牌无效' }
  }
  if (!success) return { ok: false, datas: null, totalRows: 0, content: content || '业务失败' }
  return { ok: true, datas, totalRows, content }
}

async function gatewayGet(
  endpoint: GatewayEndpoint,
  token: string,
  path: string,
  query: Record<string, string | number>,
  fetchImpl: typeof fetch,
): Promise<{ ok: boolean, datas: unknown, totalRows: number, content: string }> {
  const u = new URL(`${endpoint.origin}${path}`)
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, String(v))
  let body: unknown
  try {
    const res = await fetchImpl(u.toString(), {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    })
    body = await res.json()
    if (res.status === 401) return { ok: false, datas: null, totalRows: 0, content: '网关令牌无效，请重新登录工作助手' }
    if (!res.ok) return { ok: false, datas: null, totalRows: 0, content: `网关 HTTP ${res.status}` }
  } catch (err) {
    return { ok: false, datas: null, totalRows: 0, content: err instanceof Error ? err.message : String(err) }
  }
  return unwrapFunctionResult(body)
}

type MyBreakdown = {
  date?: string
  modelAlias?: string
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cachedInputTokens?: number
  reasoningTokens?: number
  costYuan?: number
  calls?: number
  userId?: string
  userName?: string
}

type MyDatas = {
  totalInputTokens?: number
  totalOutputTokens?: number
  totalTokens?: number
  totalCachedInputTokens?: number
  totalReasoningTokens?: number
  totalCostYuan?: number
  totalCalls?: number
  breakdown?: MyBreakdown[]
}

type ListRow = Record<string, unknown>

function emptyDay(hour?: number, date?: string): DayRow {
  return {
    ...(hour !== undefined ? { hour } : {}),
    ...(date ? { date } : {}),
    llm_calls: 0,
    llm_tokens: 0,
    llm_cache_hit: 0,
    llm_cache_miss: 0,
    llm_output: 0,
    cursor_calls: 0,
    cursor_tokens: 0,
    cursor_cache_hit: 0,
    cursor_cache_miss: 0,
    cursor_output: 0,
    calls: 0,
  }
}

function takeCursorFields(local: DayRow): Pick<DayRow,
  'cursor_calls' | 'cursor_tokens' | 'cursor_cache_hit' | 'cursor_cache_miss' | 'cursor_output'
> {
  return {
    cursor_calls: local.cursor_calls || 0,
    cursor_tokens: local.cursor_tokens || 0,
    cursor_cache_hit: local.cursor_cache_hit || 0,
    cursor_cache_miss: local.cursor_cache_miss || 0,
    cursor_output: local.cursor_output || 0,
  }
}

function overlayHourly(gateway: DayRow[], local: DayRow[]): DayRow[] {
  const byHour = new Map<number, DayRow>()
  for (const row of gateway) {
    if (typeof row.hour === 'number') byHour.set(row.hour, { ...row })
  }
  for (const loc of local) {
    if (typeof loc.hour !== 'number') continue
    const base = byHour.get(loc.hour) || emptyDay(loc.hour)
    const cursor = takeCursorFields(loc)
    byHour.set(loc.hour, {
      ...base,
      hour: loc.hour,
      ...cursor,
      calls: (base.llm_calls || 0) + cursor.cursor_calls,
    })
  }
  // 网关无分时时仍保留本机写码时段；禁止 map 空数组把写码图冲成空白
  if (byHour.size === 0) return gateway
  return [...byHour.keys()]
    .sort((a, b) => a - b)
    .map((hour) => byHour.get(hour) || emptyDay(hour))
}

function overlayDaily(gateway: DayRow[], local: DayRow[]): DayRow[] {
  const byDate = new Map<string, DayRow>()
  for (const row of gateway) {
    if (row.date) byDate.set(row.date, { ...row })
  }
  for (const loc of local) {
    if (!loc.date) continue
    const base = byDate.get(loc.date) || emptyDay(undefined, loc.date)
    const cursor = takeCursorFields(loc)
    byDate.set(loc.date, {
      ...base,
      date: loc.date,
      ...cursor,
      calls: (base.llm_calls || 0) + cursor.cursor_calls,
    })
  }
  return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)))
}

/**
 * 网关 LLM + 本机写码。只覆盖 cursor_* / today.cursor / cursor.models / 写码明细；
 * 禁止改 today.llm、llm.models、llm_* 分时与网关 detail。
 */
export function overlayCursorFromLocal<T extends UsageSummary>(
  gateway: T,
  local: UsageSummary,
): T {
  const cursorDetail = local.detail.filter((row) => row.source === 'cursor')
  // 网关回落本机账时 detail 里可能已有写码行；先去掉再叠，避免次数/明细翻倍
  const detail = gateway.detail
    .filter((row) => row.source !== 'cursor')
    .concat(cursorDetail)
    .sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))
    .slice(0, 200)
  const hourly = overlayHourly(gateway.hourly || [], local.hourly || [])
  const daily = overlayDaily(gateway.daily || [], local.daily || [])
  const monthly = overlayDaily(gateway.monthly || [], local.monthly || [])
  return {
    ...gateway,
    today: {
      llm: gateway.today.llm,
      cursor: {
        calls: local.today.cursor.calls || 0,
        tokens: local.today.cursor.tokens || 0,
      },
    },
    hourly,
    daily,
    monthly,
    llm: gateway.llm,
    cursor: { models: local.cursor.models || [] },
    detail,
    ...('note' in gateway
      ? { note: String((gateway as { note?: string }).note || '') || 'LLM 来自网关；写码来自本机 Cursor 账单' }
      : {}),
  }
}

/**
 * 与 My.totalTokens 对齐：只认行上的 CTOTAL_TOKENS。
 *
 * 现场（2026-11-05）核对：My.totalTokens === SUM(CTOTAL)。
 * 同一调用常有两条明细——网关自统计（CTOTAL=input+output）与客户端
 * Usage/Report（不传 totalTokens → CTOTAL=0，但仍有 CINPUT/COUTPUT）。
 * 若 CTOTAL 为空时回退 input+output，会把客户端那条再加一遍，合计约翻倍。
 * My 本身对 CTOTAL=0 的行计 0，故这里也不回退。
 */
export function billableTokens(_input: number, _output: number, reportedTotal = 0): number {
  return reportedTotal > 0 ? reportedTotal : 0
}

function applyTokens(row: DayRow, input: number, output: number, cache: number, total: number, calls = 1): void {
  const tok = billableTokens(input, output, total)
  // 只统计 CTOTAL>0 的接口行：与 My.totalTokens=SUM(CTOTAL) 同一批数据。
  // CTOTAL=0 的客户端重复行 / 空行不计次数，避免 KPI 与分时图各算各的。
  if (tok <= 0) return
  row.llm_calls += calls
  row.llm_tokens += tok
  row.llm_cache_hit += cache
  row.llm_cache_miss += Math.max(0, input - cache)
  row.llm_output += output
  row.calls += calls
}

function clientTsMs(row: ListRow): number {
  const raw = row.CCLIENT_TS ?? row.cclient_ts ?? row.clientTs
  const n = Number(raw)
  if (Number.isFinite(n) && n > 1e11) return Math.floor(n)
  if (Number.isFinite(n) && n > 1e9) return Math.floor(n * 1000)
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = Date.parse(raw)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function mapDetail(row: ListRow, catalog: ReadonlyMap<string, AliasIdentity>): UsageDetailRow {
  const ms = clientTsMs(row)
  const input = num(row.CINPUT_TOKENS ?? row.cinput_tokens)
  const output = num(row.COUTPUT_TOKENS ?? row.coutput_tokens)
  const cache = num(row.CCACHED_INPUT_TOKENS ?? row.ccached_input_tokens)
  const reported = num(row.CTOTAL_TOKENS ?? row.ctotal_tokens)
  const ident = identityFromUsageRow(row, catalog)
  return {
    ts: ms ? shanghaiIso(ms) : '',
    provider: ident.provider,
    model: ident.model,
    source: 'llm',
    lane: 'llm',
    tokens: billableTokens(input, output, reported),
    task: text(row.CREQUEST_ID ?? row.crequest_id),
    userId: text(row.CUSER_ID ?? row.cuser_id),
    userName: text(row.CUSER_CREATED ?? row.cuser_created),
    input,
    cacheRead: cache,
    output,
  }
}

async function fetchAllDetails(
  endpoint: GatewayEndpoint,
  token: string,
  fromMs: number,
  toMs: number,
  fetchImpl: typeof fetch,
  catalog: ReadonlyMap<string, AliasIdentity>,
  filterUser?: { id: string, name: string },
): Promise<{ rows: UsageDetailRow[], error?: string }> {
  const all: UsageDetailRow[] = []
  let page = 1
  let totalRows = Infinity
  let lastPageFull = false
  while (page <= MAX_DETAIL_PAGES && all.length < totalRows) {
    const got = await gatewayGet(endpoint, token, '/api/ai/Usage/GetUsageList', {
      from: fromMs,
      to: toMs,
      pageIndex: page,
      pageSize: DETAIL_PAGE_SIZE,
    }, fetchImpl)
    if (!got.ok) return { rows: all, error: got.content }
    totalRows = got.totalRows || 0
    const list = Array.isArray(got.datas) ? got.datas : []
    if (!list.length) {
      lastPageFull = false
      break
    }
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue
      const row = mapDetail(raw as ListRow, catalog)
      // 与卡片/图同源：CTOTAL=0 的失败上报、客户端重复行不进明细和各模型次数
      if (row.tokens <= 0) continue
      all.push(row)
    }
    lastPageFull = list.length >= DETAIL_PAGE_SIZE
    if (!lastPageFull) break
    page += 1
  }
  // 达到页上限但网关仍有更多行：明确提示，避免图表静默少算
  const truncated = page > MAX_DETAIL_PAGES && lastPageFull && all.length < totalRows
  const truncNote = truncated
    ? `明细超过 ${MAX_DETAIL_PAGES * DETAIL_PAGE_SIZE} 条分页上限，图表按已加载明细统计`
    : ''
  if (!filterUser) return truncNote ? { rows: all, error: truncNote } : { rows: all }
  const id = String(filterUser.id || '')
  const name = String(filterUser.name || '')
  // 先按 JWT 用户 id 精确过滤；命中即用，避免显示名撞车时把同事的用量算进来
  const byId = id ? all.filter((r) => r.userId === id) : []
  if (byId.length) return truncNote ? { rows: byId, error: truncNote } : { rows: byId }
  if (!name) return { rows: [] }
  const named = all.filter((r) => r.userName === name || r.userId === name)
  // 只能靠显示名兜底时，若同名对应多个 userId，则宁可不出数也不能混算他人
  const ids = new Set(named.map((r) => r.userId).filter(Boolean))
  if (ids.size > 1) {
    return { rows: [], error: '网关中存在同名账号，个人明细暂不可用' }
  }
  return truncNote ? { rows: named, error: truncNote } : { rows: named }
}

function buildHourly(details: UsageDetailRow[], on: string): DayRow[] {
  const buckets = Array.from({ length: 24 }, (_, hour) => emptyDay(hour))
  for (const row of details) {
    const ms = Date.parse(row.ts)
    if (!Number.isFinite(ms)) continue
    if (shanghaiYmd(ms) !== on) continue
    applyTokens(
      buckets[shanghaiHour(ms)],
      row.input || 0,
      row.output || 0,
      row.cacheRead || 0,
      row.tokens,
      1,
    )
  }
  return buckets
}

/** 按日桶：只从 GetUsageList 明细累加（CTOTAL），不编造 calls。 */
function buildDailyFromDetails(details: UsageDetailRow[], month: string): DayRow[] {
  const byDate = new Map<string, DayRow>()
  for (const row of details) {
    const ms = Date.parse(row.ts)
    if (!Number.isFinite(ms)) continue
    const date = shanghaiYmd(ms)
    if (!date.startsWith(month)) continue
    const bucket = byDate.get(date) || emptyDay(undefined, date)
    applyTokens(bucket, row.input || 0, row.output || 0, row.cacheRead || 0, row.tokens, 1)
    byDate.set(date, bucket)
  }
  return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)))
}

/** 闭区间 [from, to] 逐日桶；缺日补 0，供近 7 天图。 */
function buildDailyFromRange(details: UsageDetailRow[], from: string, to: string): DayRow[] {
  const byDate = new Map<string, DayRow>()
  let cur = from
  while (cur <= to) {
    byDate.set(cur, emptyDay(undefined, cur))
    const nextMs = Date.parse(`${cur}T12:00:00+08:00`) + 86_400_000
    const next = shanghaiYmd(nextMs)
    if (next <= cur) break
    cur = next
  }
  for (const row of details) {
    const ms = Date.parse(row.ts)
    if (!Number.isFinite(ms)) continue
    const date = shanghaiYmd(ms)
    if (date < from || date > to) continue
    const bucket = byDate.get(date) || emptyDay(undefined, date)
    applyTokens(bucket, row.input || 0, row.output || 0, row.cacheRead || 0, row.tokens, 1)
    byDate.set(date, bucket)
  }
  return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)))
}

function modelsFromBreakdown(
  breakdown: MyBreakdown[],
  catalog: ReadonlyMap<string, AliasIdentity>,
  details: UsageDetailRow[] = [],
): UsageSummary['llm'] {
  const buckets = new Map<string, { provider: string, model: string, tokens: number, calls: number }>()
  const take = (provider: string, model: string) => {
    const key = `${provider}\0${model}`
    const existing = buckets.get(key)
    if (existing) return existing
    const created = { provider, model, tokens: 0, calls: 0 }
    buckets.set(key, created)
    return created
  }
  for (const b of breakdown) {
    const row = b as unknown as Record<string, unknown>
    if (!pickApiText(row, ALIAS_KEYS) && !pickApiText(row, REAL_MODEL_KEYS)) continue
    const ident = identityFromUsageRow(row, catalog)
    const bucket = take(ident.provider, ident.model)
    bucket.tokens += num(b.totalTokens)
    bucket.calls += num(b.calls)
  }
  // Usage/My 的 groupBy=model 没有 calls；次数与 KPI/图同源，按 GetUsageList 每一行计 1 次
  const fromDetails = new Map<string, { n: number, tokens: number }>()
  for (const d of details) {
    const key = `${d.provider || ''}\0${d.model || '—'}`
    const acc = fromDetails.get(key) || { n: 0, tokens: 0 }
    acc.n += 1
    acc.tokens += d.tokens || 0
    fromDetails.set(key, acc)
  }
  for (const [key, acc] of fromDetails) {
    const sep = key.indexOf('\0')
    const bucket = take(key.slice(0, sep), key.slice(sep + 1))
    if (!bucket.tokens) bucket.tokens = acc.tokens
    if (bucket.calls < acc.n) bucket.calls = acc.n
  }
  const models = [...buckets.values()].sort((a, b) => b.tokens - a.tokens || b.calls - a.calls)
  return { models }
}

function peopleFromBreakdown(breakdown: MyBreakdown[]): PersonRow[] {
  return breakdown
    .filter((b) => text(b.userId) || text(b.userName))
    .map((b) => ({
      user_id: text(b.userId) || text(b.userName),
      username: text(b.userName) || text(b.userId),
      display_name: text(b.userName) || text(b.userId),
      llm_tokens: num(b.totalTokens) || num(b.inputTokens) + num(b.outputTokens),
      llm_calls: num(b.calls) || 0,
      cursor_tokens: 0,
      cursor_calls: 0,
    }))
    .sort((a, b) => b.llm_tokens - a.llm_tokens)
}

/**
 * 组装用量页数据。鉴权用网关登录 JWT（ZR_GATEWAY_TOKEN）。
 */
export async function fetchGatewayPanel(opts: {
  on: string
  grain: UsageGrain
  scope: 'personal' | 'enterprise'
  viewerAdmin: boolean
  viewer?: { id: string, username?: string, displayName?: string } | null
  resolveToken: TokenResolve
  endpoint?: GatewayEndpoint | null
  fetchImpl?: typeof fetch
}): Promise<GatewayPanel | null> {
  const endpoint = opts.endpoint === undefined ? readGatewayEndpoint() : opts.endpoint
  if (!endpoint) return null
  const grain = parseUsageGrain(opts.grain)
  const cred = await opts.resolveToken(endpoint.credentialRef || 'ZR_GATEWAY_TOKEN')
  const token = String(cred?.value || '').trim()
  if (!token) {
    return {
      usage: emptyUsage(opts.on, grain),
      people: null,
      viewerAdmin: opts.viewerAdmin,
      scope: opts.scope,
      loaded: false,
      gatewayError: '未拿到网关登录令牌，请先登录工作助手',
    }
  }
  const fetchImpl = opts.fetchImpl || fetch
  const scope = opts.scope === 'enterprise' && opts.viewerAdmin ? 'enterprise' : 'personal'
  const on = opts.on || shanghaiYmd(Date.now())

  let fromMs: number
  let toMs: number
  let month = on.slice(0, 7)
  let monthFrom = on
  let monthTo = on
  if (grain === 'month') {
    const b = monthBounds(on)
    fromMs = b.fromMs
    toMs = b.toMs
    month = b.month
    monthFrom = b.fromYmd
    monthTo = b.toYmd
  } else if (grain === 'week') {
    const today = shanghaiYmd(Date.now())
    const w = weekSpan(on, today)
    fromMs = dayStartMs(w.from)
    toMs = dayEndMs(w.to)
    month = w.month
    monthFrom = w.from
    monthTo = w.to
  } else {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(on) ? on : shanghaiYmd(Date.now())
    fromMs = dayStartMs(day)
    toMs = dayEndMs(day)
    month = day.slice(0, 7)
    monthFrom = day
    monthTo = day
  }

  const summaryPath = scope === 'enterprise' ? '/api/ai/Usage/Summary' : '/api/ai/Usage/My'
  const catalogP = fetchModelCatalog(endpoint, token, fetchImpl)
  const dayGroup = await gatewayGet(endpoint, token, summaryPath, {
    from: fromMs,
    to: toMs,
    groupBy: grain === 'month' ? 'day' : 'day',
  }, fetchImpl)
  if (!dayGroup.ok) {
    return {
      usage: emptyUsage(on, grain),
      people: null,
      viewerAdmin: opts.viewerAdmin,
      scope,
      loaded: false,
      gatewayError: dayGroup.content || '拉取用量失败',
    }
  }
  const modelGroup = await gatewayGet(endpoint, token, summaryPath, {
    from: fromMs,
    to: toMs,
    groupBy: 'model',
  }, fetchImpl)
  const userGroup = scope === 'enterprise'
    ? await gatewayGet(endpoint, token, '/api/ai/Usage/Summary', {
      from: fromMs,
      to: toMs,
      groupBy: 'user',
    }, fetchImpl)
    : null
  const catalog = await catalogP

  const dayDatas = (dayGroup.datas && typeof dayGroup.datas === 'object' ? dayGroup.datas : {}) as MyDatas
  const modelDatas = (modelGroup.ok && modelGroup.datas && typeof modelGroup.datas === 'object'
    ? modelGroup.datas
    : {}) as MyDatas
  const modelBreakdown = Array.isArray(modelDatas.breakdown) ? modelDatas.breakdown : []

  // 个人明细必须按网关 JWT 用户过滤；引擎 active.id 与 CUSER_ID 不是同一套编号。
  const gwUser = gatewayUserFromJwt(token)
  const filterUser = scope === 'personal'
    ? (gwUser.id || gwUser.name
      ? { id: gwUser.id, name: gwUser.name }
      : undefined)
    : undefined
  // 个人必须带网关用户过滤；解析失败则不拉全量明细（避免把别人的行算进个人页）。
  const details = filterUser || scope !== 'personal'
    ? await fetchAllDetails(endpoint, token, fromMs, toMs, fetchImpl, catalog, filterUser)
    : { rows: [] as UsageDetailRow[], error: '无法从网关令牌解析当前用户，个人明细暂不可用' }

  const dayKey = grain === 'day'
    ? (/^\d{4}-\d{2}-\d{2}$/.test(on) ? on : shanghaiYmd(Date.now()))
    : monthTo
  // 分时/逐日只从 GetUsageList 明细按 CTOTAL 累加；KPI 与图必须同源，禁止另编次数。
  const hourly = grain === 'day' ? buildHourly(details.rows, dayKey) : []
  const monthly = grain === 'month'
    ? buildDailyFromDetails(details.rows, month)
    : grain === 'week'
      ? buildDailyFromRange(details.rows, monthFrom, monthTo)
      : []
  const daily = monthly.length
    ? monthly
    : (grain === 'day'
      ? [(() => {
        const row = emptyDay(undefined, dayKey)
        for (const d of details.rows) {
          const ms = Date.parse(d.ts)
          if (Number.isFinite(ms) && shanghaiYmd(ms) !== dayKey) continue
          applyTokens(row, d.input || 0, d.output || 0, d.cacheRead || 0, d.tokens, 1)
        }
        return row
      })()]
      : [])

  const series = grain === 'day' ? hourly : monthly
  const seriesCalls = series.reduce((sum, row) => sum + (row.llm_calls || 0), 0)
  const seriesTokens = series.reduce((sum, row) => sum + (row.llm_tokens || 0), 0)
  // Token 优先用 My.totalTokens（接口字段；已核对 = SUM(CTOTAL)）；次数用与图相同的明细汇总
  const llmTokens = num(dayDatas.totalTokens) || seriesTokens
  const llmCalls = num(dayDatas.totalCalls) || seriesCalls

  const usage: GatewayPanel['usage'] = {
    ok: true,
    source: 'gateway',
    note: '',
    grain,
    on: dayKey,
    month,
    month_from: monthFrom,
    month_to: monthTo,
    today: {
      llm: { calls: llmCalls, tokens: llmTokens },
      cursor: { calls: 0, tokens: 0 },
    },
    hourly,
    daily,
    monthly,
    llm: modelsFromBreakdown(modelBreakdown, catalog, details.rows),
    cursor: { models: [] },
    detail: details.rows,
  }

  const people = scope === 'enterprise' && userGroup?.ok && userGroup.datas && typeof userGroup.datas === 'object'
    ? peopleFromBreakdown(Array.isArray((userGroup.datas as MyDatas).breakdown) ? (userGroup.datas as MyDatas).breakdown! : [])
    : null

  return {
    usage,
    people,
    viewerAdmin: opts.viewerAdmin,
    scope,
    loaded: true,
    gatewayError: details.error,
  }
}

function emptyUsage(on: string, grain: UsageGrain): GatewayPanel['usage'] {
  const today = shanghaiYmd(Date.now())
  const day = /^\d{4}-\d{2}-\d{2}$/.test(on) ? on : today
  if (grain === 'week') {
    const w = weekSpan(day, today)
    // 必须补齐 7 个零日桶；空 monthly 会让前端逐日图按 n=1 读 rows[0] 崩溃白屏
    const monthly = buildDailyFromRange([], w.from, w.to)
    return {
      ok: true,
      source: 'gateway',
      note: '',
      grain,
      on: w.to,
      month: w.month,
      month_from: w.from,
      month_to: w.to,
      today: { llm: { calls: 0, tokens: 0 }, cursor: { calls: 0, tokens: 0 } },
      hourly: [],
      daily: monthly,
      monthly,
      llm: { models: [] },
      cursor: { models: [] },
      detail: [],
    }
  }
  const b = monthBounds(day)
  const monthDays = grain === 'month' ? buildDailyFromRange([], b.fromYmd, b.toYmd) : []
  return {
    ok: true,
    source: 'gateway',
    note: '',
    grain,
    on: day,
    month: b.month,
    month_from: grain === 'month' ? b.fromYmd : day,
    month_to: grain === 'month' ? b.toYmd : day,
    today: { llm: { calls: 0, tokens: 0 }, cursor: { calls: 0, tokens: 0 } },
    hourly: grain === 'day' ? Array.from({ length: 24 }, (_, hour) => emptyDay(hour)) : [],
    daily: monthDays,
    monthly: monthDays,
    llm: { models: [] },
    cursor: { models: [] },
    detail: [],
  }
}

/** 从网关再生块里去掉 usageReportUrl，避免客户端再向 Usage/Report 上报。 */
export function stripGatewayUsageReportUrl(text: string): string {
  const begin = text.indexOf('# zr-model-gateway:begin')
  const end = text.indexOf('# zr-model-gateway:end')
  if (begin < 0 || end < begin) return text
  const head = text.slice(0, begin)
  const block = text.slice(begin, end)
  const tail = text.slice(end)
  const cleaned = block
    .split(/\r?\n/)
    .filter((line) => !/^\s*usageReportUrl:\s*/.test(line))
    .join('\n')
  return head + cleaned + tail
}
