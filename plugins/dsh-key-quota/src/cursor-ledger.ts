/**
 * Cursor 控制台的已发生调用，补进用量页的写码账。
 *
 * 写码卡只认 source=cursor。Cursor 自己的账单在控制台，不在 DeepSeek 会话里。
 * 打开用量页时把当天账单里还没有的调用补进同一本 events.jsonl。
 * 数字只来自账单上的 tokenUsage。没有用量的事件不写。
 */
import { appendFileSync, existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const RPC = 'https://api2.cursor.sh/aiserver.v1.DashboardService/GetFilteredUsageEvents'
const CACHE_MS = 30_000

type TokenUsage = {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

type DashboardEvent = {
  timestamp?: string | number
  model?: string
  usageEventId?: string
  tokenUsage?: TokenUsage
}

/** 写码只收 Cursor 的写码模型。点名的对话模型算 LLM，不进写码。 */
export function isCursorCodingModel(model: string): boolean {
  const name = model.trim().toLowerCase()
  return name === '' || name === 'default' || name === 'auto' || name.startsWith('composer')
}

export type CursorLedgerRow = {
  id: string
  ts: string
  source: 'cursor' | 'llm'
  lane: 'cursor_code' | 'cursor_chat'
  provider: 'cursor'
  model: string
  prompt_tokens: number
  completion_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  reasoning_tokens: number
  total_tokens: number
  quality: 'provider'
  ok: true
  job_id: string
  error_class: string
  user_id: string
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

export function shanghaiToday(now = new Date()): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export function shanghaiDayRange(ymd: string): { start: number, end: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null
  const start = Date.parse(`${ymd}T00:00:00+08:00`)
  if (!Number.isFinite(start)) return null
  return { start, end: start + 24 * 60 * 60 * 1000 }
}

function shanghaiIso(ms: number): string {
  return new Date(ms + 8 * 60 * 60 * 1000).toISOString().slice(0, 19) + '+08:00'
}

/** 一条 Cursor 账单事件。没有 token 或没有事件号时返回 null。 */
export function cursorLedgerRow(event: DashboardEvent, userId: string): CursorLedgerRow | null {
  const usage = event.tokenUsage
  if (!usage || typeof usage !== 'object') return null
  const prompt = num(usage.inputTokens)
  const completion = num(usage.outputTokens)
  const cacheRead = num(usage.cacheReadTokens)
  const cacheWrite = num(usage.cacheWriteTokens)
  const total = prompt + completion + cacheRead + cacheWrite
  const eventId = String(event.usageEventId || '').replace(/[^A-Za-z0-9._-]/g, '')
  const ms = Number(event.timestamp)
  if (total <= 0 || eventId === '' || !Number.isFinite(ms) || ms <= 0) return null
  const jobId = `cuev-${eventId}`.slice(0, 80)
  const model = String(event.model || 'cursor').slice(0, 120)
  const coding = isCursorCodingModel(model)
  return {
    id: jobId,
    ts: shanghaiIso(ms),
    source: coding ? 'cursor' : 'llm',
    lane: coding ? 'cursor_code' : 'cursor_chat',
    provider: 'cursor',
    model,
    prompt_tokens: prompt,
    completion_tokens: completion,
    cache_read_tokens: cacheRead,
    cache_write_tokens: cacheWrite,
    reasoning_tokens: 0,
    total_tokens: total,
    quality: 'provider',
    ok: true,
    job_id: jobId,
    error_class: '',
    user_id: userId,
  }
}

function dataRoots(env: NodeJS.ProcessEnv, home: string): string[] {
  const out: string[] = []
  const push = (path: string) => {
    if (path && !out.includes(path)) out.push(path)
  }
  const appData = (env.APPDATA || '').trim()
  const dsh = (env.DSH_HOME || '').trim() || join(home, '.dsh')
  if (appData) {
    const desktop = join(appData, 'zr-workbuddy-desktop')
    push(join(desktop, 'persist', 'engine-data'))
    push(join(desktop, 'runtime-app', 'apps', 'zr-workbuddy', 'engine', 'data'))
    push(join(desktop, 'dsh-home', 'link', 'DSH-ZR-WorkBuddy', 'apps', 'zr-workbuddy', 'engine', 'data'))
  }
  push(join(dsh, 'link', 'DSH-ZR-WorkBuddy', 'apps', 'zr-workbuddy', 'engine', 'data'))
  push(join(home, '.dsh', 'link', 'DSH-ZR-WorkBuddy', 'apps', 'zr-workbuddy', 'engine', 'data'))
  return out
}

export function ledgerFiles(env: NodeJS.ProcessEnv = process.env, home = homedir()): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const root of dataRoots(env, home)) {
    const path = join(root, 'usage', 'events.jsonl')
    if (!existsSync(path)) continue
    let key = path
    try { key = realpathSync(path) } catch { /* keep the path */ }
    if (seen.has(key)) continue
    seen.add(key)
    out.push(path)
  }
  return out
}

function activeUserId(env: NodeJS.ProcessEnv, home: string, now: number): string {
  let best = ''
  let bestMtime = -1
  for (const root of dataRoots(env, home)) {
    const path = join(root, 'auth', 'active.json')
    let mtime = -1
    try { mtime = statSync(path).mtimeMs } catch { continue }
    if (mtime < bestMtime) continue
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as { id?: string, user_id?: string, exp?: number }
      const id = String(raw.id || raw.user_id || '')
      const exp = Number(raw.exp)
      if (!id) continue
      if (Number.isFinite(exp) && exp > 0 && exp * 1000 <= now) continue
      best = id
      bestMtime = mtime
    } catch {
      // 坏的会话文件跳过
    }
  }
  return best
}

function readToken(env: NodeJS.ProcessEnv): string {
  const explicit = (env.CURSOR_AUTH_TOKEN || '').trim()
  if (explicit) return explicit
  const paths: string[] = []
  const appData = (env.APPDATA || '').trim()
  if (appData) paths.push(join(appData, 'Cursor', 'auth.json'))
  paths.push(join(homedir(), '.cursor', 'auth.json'))
  paths.push(join(homedir(), '.config', 'Cursor', 'auth.json'))
  for (const path of paths) {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as { accessToken?: string }
      if (typeof raw.accessToken === 'string' && raw.accessToken !== '') return raw.accessToken
    } catch {
      // 下一处
    }
  }
  return ''
}

async function fetchDay(
  ymd: string,
  token: string,
  fetchImpl: typeof fetch,
): Promise<DashboardEvent[]> {
  const range = shanghaiDayRange(ymd)
  if (!range) return []
  const events: DashboardEvent[] = []
  for (let page = 1; page <= 8; page += 1) {
    const response = await fetchImpl(RPC, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'connect-protocol-version': '1',
        accept: 'application/json',
      },
      body: JSON.stringify({
        startDate: String(range.start),
        endDate: String(range.end),
        page,
        pageSize: 100,
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
    })
    if (!response.ok) return events
    const parsed = await response.json() as { totalUsageEventsCount?: number, usageEventsDisplay?: DashboardEvent[] }
    const batch = Array.isArray(parsed.usageEventsDisplay) ? parsed.usageEventsDisplay : []
    events.push(...batch)
    const total = Number(parsed.totalUsageEventsCount || 0)
    if (batch.length === 0 || events.length >= total) break
  }
  return events
}

/** 这台电脑上的 Cursor 账单已经归过谁，新的调用就继续归谁。 */
function ledgerOwner(paths: string[]): string {
  const ids = new Set<string>()
  for (const path of paths) {
    let text = ''
    try { text = readFileSync(path, 'utf8') } catch { continue }
    for (const line of text.split('\n')) {
      if (!line.includes('"job_id":"cuev-')) continue
      try {
        const row = JSON.parse(line) as { job_id?: string, user_id?: string }
        const jobId = String(row.job_id || '')
        const userId = String(row.user_id || '')
        if (jobId.startsWith('cuev-') && userId) ids.add(userId)
      } catch {
        // 坏行不参与归属
      }
    }
  }
  return ids.size === 1 ? [...ids][0] : ''
}

function appendFresh(paths: string[], rows: CursorLedgerRow[]): number {
  let appended = 0
  for (const path of paths) {
    let text = ''
    try { text = readFileSync(path, 'utf8') } catch { continue }
    const fresh = rows.filter((row) => !text.includes(`"job_id":${JSON.stringify(row.job_id)}`))
    if (fresh.length === 0) continue
    appendFileSync(path, fresh.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8')
    appended = fresh.length
  }
  return appended
}

let syncedAt = 0
let inflight: Promise<{ appended: number }> | null = null

export type SyncOpts = {
  force?: boolean
  env?: NodeJS.ProcessEnv
  home?: string
  fetchImpl?: typeof fetch
  token?: string
  ledgerPaths?: string[]
  userId?: string
  now?: Date
  days?: string[]
}

/** 把指定自然日里还没入账的 Cursor 调用写进用量账本。失败时不抛。 */
export function syncCursorUsage(opts: SyncOpts = {}): Promise<{ appended: number }> {
  const now = opts.now ?? new Date()
  if (opts.force !== true && now.getTime() - syncedAt < CACHE_MS) return Promise.resolve({ appended: 0 })
  if (inflight && opts.force !== true) return inflight
  const run = doSync(opts, now).then((result) => {
    if (opts.force !== true) syncedAt = Date.now()
    return result
  }).catch(() => ({ appended: 0 }))
  if (opts.force === true) return run
  inflight = run.finally(() => { inflight = null })
  return inflight
}

async function doSync(opts: SyncOpts, now: Date): Promise<{ appended: number }> {
  const env = opts.env ?? process.env
  const home = opts.home ?? homedir()
  const token = opts.token ?? readToken(env)
  const paths = opts.ledgerPaths ?? ledgerFiles(env, home)
  const userId = opts.userId ?? (ledgerOwner(paths) || activeUserId(env, home, now.getTime()))
  if (!token || !userId || paths.length === 0) return { appended: 0 }
  const days = opts.days && opts.days.length > 0 ? opts.days : [shanghaiToday(now)]
  const fetchImpl = opts.fetchImpl ?? fetch
  const rows: CursorLedgerRow[] = []
  const seen = new Set<string>()
  for (const day of days) {
    const events = await fetchDay(day, token, fetchImpl)
    for (const event of events) {
      const row = cursorLedgerRow(event, userId)
      if (!row || seen.has(row.job_id)) continue
      seen.add(row.job_id)
      rows.push(row)
    }
  }
  if (rows.length === 0) return { appended: 0 }
  return { appended: appendFresh(paths, rows) }
}
