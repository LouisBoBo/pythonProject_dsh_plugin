/**
 * 用量页改读中软模型网关（接口文档1 · §7.3 / §7.4 / §7.5）。
 * 个人：GET /api/ai/Usage/My + GetUsageList；企业汇总：Summary。
 * 不再依赖本机 events.jsonl；也不再向 Usage/Report 上报（由 ensure 去掉 usageReportUrl）。
 */
import { readGatewayEndpoint, type GatewayEndpoint } from './gateway-catalog.js'
import type { DayRow, PersonRow, UsageDetailRow, UsageSummary } from './stats.js'

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

function mapDetail(row: ListRow): UsageDetailRow {
  const ms = clientTsMs(row)
  const input = num(row.CINPUT_TOKENS ?? row.cinput_tokens)
  const output = num(row.COUTPUT_TOKENS ?? row.coutput_tokens)
  const cache = num(row.CCACHED_INPUT_TOKENS ?? row.ccached_input_tokens)
  const reported = num(row.CTOTAL_TOKENS ?? row.ctotal_tokens)
  return {
    ts: ms ? shanghaiIso(ms) : '',
    provider: 'zr-gateway',
    model: text(row.CMODEL_ALIAS ?? row.cmodel_alias) || '—',
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
      all.push(mapDetail(raw as ListRow))
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

function modelsFromBreakdown(breakdown: MyBreakdown[]): UsageSummary['llm'] {
  const models = breakdown
    .filter((b) => text(b.modelAlias))
    .map((b) => ({
      provider: 'zr-gateway',
      model: text(b.modelAlias),
      tokens: num(b.totalTokens),
      calls: num(b.calls),
    }))
    .sort((a, b) => b.tokens - a.tokens)
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
  grain: 'day' | 'month'
  scope: 'personal' | 'enterprise'
  viewerAdmin: boolean
  viewer?: { id: string, username?: string, displayName?: string } | null
  resolveToken: TokenResolve
  endpoint?: GatewayEndpoint | null
  fetchImpl?: typeof fetch
}): Promise<GatewayPanel | null> {
  const endpoint = opts.endpoint === undefined ? readGatewayEndpoint() : opts.endpoint
  if (!endpoint) return null
  const cred = await opts.resolveToken(endpoint.credentialRef || 'ZR_GATEWAY_TOKEN')
  const token = String(cred?.value || '').trim()
  if (!token) {
    return {
      usage: emptyUsage(opts.on, opts.grain),
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
  const grain = opts.grain

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
  } else {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(on) ? on : shanghaiYmd(Date.now())
    fromMs = dayStartMs(day)
    toMs = dayEndMs(day)
    month = day.slice(0, 7)
    monthFrom = day
    monthTo = day
  }

  const summaryPath = scope === 'enterprise' ? '/api/ai/Usage/Summary' : '/api/ai/Usage/My'
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
    ? await fetchAllDetails(endpoint, token, fromMs, toMs, fetchImpl, filterUser)
    : { rows: [] as UsageDetailRow[], error: '无法从网关令牌解析当前用户，个人明细暂不可用' }

  const dayKey = grain === 'month' ? monthFrom : (/^\d{4}-\d{2}-\d{2}$/.test(on) ? on : shanghaiYmd(Date.now()))
  // 分时/逐日只从 GetUsageList 明细按 CTOTAL 累加；KPI 与图必须同源，禁止另编次数。
  const hourly = grain === 'day' ? buildHourly(details.rows, dayKey) : []
  const monthly = grain === 'month' ? buildDailyFromDetails(details.rows, month) : []
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

  const series = grain === 'month' ? monthly : hourly
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
    llm: modelsFromBreakdown(modelBreakdown),
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

function emptyUsage(on: string, grain: 'day' | 'month'): GatewayPanel['usage'] {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(on) ? on : shanghaiYmd(Date.now())
  const b = monthBounds(day)
  return {
    ok: true,
    source: 'gateway',
    note: '',
    grain,
    on: day,
    month: b.month,
    month_from: b.fromYmd,
    month_to: b.toYmd,
    today: { llm: { calls: 0, tokens: 0 }, cursor: { calls: 0, tokens: 0 } },
    hourly: Array.from({ length: 24 }, (_, hour) => emptyDay(hour)),
    daily: [],
    monthly: [],
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
