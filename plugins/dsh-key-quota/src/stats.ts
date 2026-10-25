/** 图表分项与引擎用量页一致：合计 = 命中 + 未命中 + 输出。只读已落盘数字，不改计量账本。 */

export type UsageEvent = {
  ts: string
  source: string
  model: string
  userId: string
  prompt: number
  completion: number
  cacheRead: number
  total: number
  jobId?: string
  lane?: string
}

export type DayRow = {
  date?: string
  hour?: number
  llm_calls: number
  llm_tokens: number
  llm_cache_hit: number
  llm_cache_miss: number
  llm_output: number
  cursor_calls: number
  cursor_tokens: number
  cursor_cache_hit: number
  cursor_cache_miss: number
  cursor_output: number
  calls: number
}

export type UsageSummary = {
  ok: true
  grain: 'day' | 'month'
  on: string
  month: string
  month_from: string
  month_to: string
  today: {
    llm: { calls: number, tokens: number }
    cursor: { calls: number, tokens: number }
  }
  hourly: DayRow[]
  daily: DayRow[]
  monthly: DayRow[]
  llm: { models: Array<{ model: string, tokens: number }> }
  cursor: { models: Array<{ model: string, tokens: number }> }
}

export type PersonRow = {
  user_id: string
  username: string
  display_name: string
  llm_tokens: number
  llm_calls: number
  cursor_tokens: number
  cursor_calls: number
}

const OFFSET = 8 * 60 * 60 * 1000

function n(v: number): number {
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0
}

export function shanghaiStamp(ts: string): { ymd: string, hour: number } | null {
  const text = ts.trim()
  const naive = text.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::\d{2})?(?:\.\d+)?$/)
  if (naive) return { ymd: naive[1], hour: Number(naive[2]) }
  const d = new Date(text)
  if (Number.isNaN(d.getTime())) return null
  const sh = new Date(d.getTime() + OFFSET)
  return { ymd: sh.toISOString().slice(0, 10), hour: sh.getUTCHours() }
}

export function shanghaiToday(now = new Date()): string {
  return new Date(now.getTime() + OFFSET).toISOString().slice(0, 10)
}

function emptyDay(): DayRow {
  return {
    llm_calls: 0, llm_tokens: 0, llm_cache_hit: 0, llm_cache_miss: 0, llm_output: 0,
    cursor_calls: 0, cursor_tokens: 0, cursor_cache_hit: 0, cursor_cache_miss: 0, cursor_output: 0,
    calls: 0,
  }
}

function chartParts(evt: UsageEvent): { tokens: number, hit: number, miss: number, out: number } {
  const prompt = n(evt.prompt)
  const hit = n(evt.cacheRead)
  const output = n(evt.completion)
  const stored = n(evt.total)
  const exclusive = prompt + output + hit
  const job = evt.jobId || ''
  const lane = evt.lane || ''
  const exclusiveShape = hit > prompt
    || (hit > 0 && stored > 0 && Math.abs(exclusive - stored) <= 2)
    || job.startsWith('meter_')
    || lane.startsWith('dsh_')
  const miss = exclusiveShape
    ? prompt
    : (prompt ? Math.max(0, prompt - hit) : (output === 0 && stored ? stored : 0))
  const stack = miss + hit + output
  return { tokens: stack > 0 ? stack : stored, hit, miss, out: output }
}

function add(slot: DayRow, evt: UsageEvent): void {
  const src = evt.source === 'cursor' ? 'cursor' : 'llm'
  const parts = chartParts(evt)
  const prefix = src === 'cursor' ? 'cursor' : 'llm'
  slot.calls += 1
  slot[`${prefix}_calls`] += 1
  slot[`${prefix}_tokens`] += parts.tokens
  slot[`${prefix}_cache_hit`] += parts.hit
  slot[`${prefix}_cache_miss`] += parts.miss
  slot[`${prefix}_output`] += parts.out
}

function ymdAdd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

function monthEnd(ymd: string, today: string): { from: string, to: string, month: string } {
  const month = ymd.slice(0, 7)
  const from = `${month}-01`
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  let to = `${month}-${String(last).padStart(2, '0')}`
  if (to > today) to = today
  if (to < from) to = from
  return { from, to, month }
}

function focusDay(on: string, today: string): string {
  const raw = on.trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return today
  if (raw > today) return today
  const oldest = ymdAdd(today, -89)
  return raw < oldest ? oldest : raw
}

function fillDays(from: string, to: string, map: Map<string, DayRow>): DayRow[] {
  const rows: DayRow[] = []
  let cur = from
  while (cur <= to) {
    rows.push({ date: cur, ...(map.get(cur) || emptyDay()) })
    cur = ymdAdd(cur, 1)
  }
  return rows
}

export function summarizeUsage(events: UsageEvent[], opts: {
  on?: string
  grain?: string
  userId?: string | null
  now?: Date
}): UsageSummary {
  const today = shanghaiToday(opts.now ?? new Date())
  const grain = opts.grain === 'month' ? 'month' : 'day'
  const on = focusDay(opts.on || '', today)
  const span = monthEnd(on, today)
  const userId = opts.userId ? String(opts.userId) : ''
  const inUser = (evt: UsageEvent) => !userId || evt.userId === userId

  const dayMap = new Map<string, DayRow>()
  const hourMap = new Map<number, DayRow>()
  for (let h = 0; h < 24; h++) hourMap.set(h, { ...emptyDay(), hour: h })
  const models = { llm: new Map<string, number>(), cursor: new Map<string, number>() }

  for (const evt of events) {
    if (!inUser(evt)) continue
    const stamp = shanghaiStamp(evt.ts)
    if (!stamp) continue
    const src = evt.source === 'cursor' ? 'cursor' : 'llm'
    const inMonth = stamp.ymd >= span.from && stamp.ymd <= span.to
    const onFocus = stamp.ymd === on
    const inModelWindow = grain === 'month'
      ? inMonth
      : stamp.ymd >= ymdAdd(on, -6) && stamp.ymd <= on
    if (inModelWindow) {
      const model = (evt.model || '').trim() || 'unknown'
      const parts = chartParts(evt)
      models[src].set(model, (models[src].get(model) || 0) + parts.tokens)
    }
    if (!inMonth) continue
    if (grain === 'month' || onFocus) {
      const hour = hourMap.get(stamp.hour) || emptyDay()
      add(hour, evt)
      hour.hour = stamp.hour
      hourMap.set(stamp.hour, hour)
    }
    const day = dayMap.get(stamp.ymd) || emptyDay()
    add(day, evt)
    dayMap.set(stamp.ymd, day)
  }

  const monthly = fillDays(span.from, span.to, dayMap)
  const hourly = [...hourMap.values()]
  const focus = dayMap.get(on) || emptyDay()
  const period = grain === 'month'
    ? monthly.reduce((acc, row) => {
        acc.llm_calls += row.llm_calls
        acc.llm_tokens += row.llm_tokens
        acc.cursor_calls += row.cursor_calls
        acc.cursor_tokens += row.cursor_tokens
        return acc
      }, emptyDay())
    : focus

  const modelList = (src: 'llm' | 'cursor') => [...models[src].entries()]
    .map(([model, tokens]) => ({ model, tokens }))
    .sort((a, b) => b.tokens - a.tokens || a.model.localeCompare(b.model))

  return {
    ok: true,
    grain,
    on,
    month: span.month,
    month_from: span.from,
    month_to: span.to,
    today: {
      llm: { calls: period.llm_calls, tokens: period.llm_tokens },
      cursor: { calls: period.cursor_calls, tokens: period.cursor_tokens },
    },
    hourly,
    daily: monthly,
    monthly,
    llm: { models: modelList('llm') },
    cursor: { models: modelList('cursor') },
  }
}

export function peopleUsage(events: UsageEvent[], users: Array<{
  id: string
  username: string
  displayName: string
}>, from: string, to: string): PersonRow[] {
  const by = new Map<string, PersonRow>()
  for (const user of users) {
    by.set(user.id, {
      user_id: user.id,
      username: user.username,
      display_name: user.displayName || user.username || user.id,
      llm_tokens: 0,
      llm_calls: 0,
      cursor_tokens: 0,
      cursor_calls: 0,
    })
  }
  for (const evt of events) {
    const stamp = shanghaiStamp(evt.ts)
    if (!stamp || stamp.ymd < from || stamp.ymd > to) continue
    const id = evt.userId || ''
    if (!id) continue
    if (!by.has(id)) {
      by.set(id, {
        user_id: id,
        username: '',
        display_name: id,
        llm_tokens: 0,
        llm_calls: 0,
        cursor_tokens: 0,
        cursor_calls: 0,
      })
    }
    const row = by.get(id)!
    const parts = chartParts(evt)
    if (evt.source === 'cursor') {
      row.cursor_calls += 1
      row.cursor_tokens += parts.tokens
    } else {
      row.llm_calls += 1
      row.llm_tokens += parts.tokens
    }
  }
  return [...by.values()]
}
