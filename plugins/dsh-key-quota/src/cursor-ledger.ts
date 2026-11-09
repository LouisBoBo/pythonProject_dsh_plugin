/**
 * Cursor 控制台的已发生调用，补进用量页的写码账。
 *
 * 写码卡只认 source=cursor。Cursor 自己的账单在控制台，不在 DeepSeek 会话里。
 * 打开用量页时把选定自然日账单里还没有的调用补进同一本 events.jsonl。
 * 数字只来自账单上的 tokenUsage。没有用量的事件不写。
 *
 * LLM 卡已改走网关接口；本文件只服务写码，不得改网关 LLM 合计。
 */
import { createDecipheriv, pbkdf2Sync } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const SAFE_PREFIX = 'cursor-safe-storage:v1:'

/** 网页账单接口；带 startDate 会空返回，须分页后在本地按日过滤。 */
const WEB_RPC = 'https://cursor.com/api/dashboard/get-filtered-usage-events'
const CACHE_MS = 30_000
const FETCH_PAGE_SIZE = 100
const FETCH_MAX_PAGES = 80

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

/**
 * Cursor 控制台账单一律进写码。
 * LLM 用量页已走网关；若再把点名模型标成 llm，网关路径下会整条丢掉。
 */
export function isCursorCodingModel(_model: string): boolean {
  return true
}

export type CursorLedgerRow = {
  id: string
  ts: string
  source: 'cursor'
  lane: 'cursor_code'
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
  return {
    id: jobId,
    ts: shanghaiIso(ms),
    source: 'cursor',
    lane: 'cursor_code',
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
    user_id: String(userId || '').replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 80),
  }
}

/** 与 engine-usage.roots 对齐，避免 Mac/桌面路径写不进读得到的账本。 */
function dataRoots(env: NodeJS.ProcessEnv, home: string): string[] {
  const out: string[] = []
  const push = (path: string) => {
    if (path && !out.includes(path)) out.push(path)
  }
  const appData = (env.APPDATA || '').trim()
  const dsh = (env.DSH_HOME || '').trim() || join(home, '.dsh')
  const desktops: string[] = []
  if (appData) desktops.push(join(appData, 'zr-workbuddy-desktop'))
  desktops.push(join(home, 'Library', 'Application Support', 'zr-workbuddy-desktop'))
  for (const desktop of desktops) {
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

/** 网关模式下本机 LLM 账可能不存在；写码同步前确保至少有一本可写的 events.jsonl。 */
export function ensureLedgerFiles(env: NodeJS.ProcessEnv = process.env, home = homedir()): string[] {
  const existing = ledgerFiles(env, home)
  if (existing.length > 0) return existing
  for (const root of dataRoots(env, home)) {
    try {
      mkdirSync(join(root, 'usage'), { recursive: true })
      const path = join(root, 'usage', 'events.jsonl')
      if (!existsSync(path)) writeFileSync(path, '', { encoding: 'utf8', mode: 0o600 })
      return ledgerFiles(env, home)
    } catch {
      // 试下一处根目录
    }
  }
  return []
}

/** 上海自然日加减。 */
export function shanghaiShiftYmd(ymd: string, days: number): string {
  const ms = Date.parse(`${ymd}T12:00:00+08:00`)
  if (!Number.isFinite(ms)) return ymd
  return shanghaiToday(new Date(ms + days * 86_400_000))
}

/** 用量页选定日/近7天/月需要同步的上海自然日。 */
export function panelSyncDays(on: string, grain: 'day' | 'week' | 'month', now = new Date()): string[] {
  const today = shanghaiToday(now)
  const day = /^\d{4}-\d{2}-\d{2}$/.test(on) ? on : today
  const focus = day > today ? today : day
  if (grain === 'week') {
    const from = shanghaiShiftYmd(focus, -6)
    const days: string[] = []
    let cur = from
    while (cur <= focus) {
      days.push(cur)
      const next = shanghaiShiftYmd(cur, 1)
      if (next <= cur) break
      cur = next
    }
    return days.length ? days : [focus]
  }
  if (grain !== 'month') {
    // 打开「今天」时顺带补昨天，避免漏同步后写码卡空白
    if (focus === today) {
      const yday = shanghaiShiftYmd(today, -1)
      return yday === focus ? [focus] : [yday, focus]
    }
    return [focus]
  }
  const month = focus.slice(0, 7)
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  let to = `${month}-${String(last).padStart(2, '0')}`
  if (to > today) to = today
  const days: string[] = []
  for (let d = 1; d <= last; d += 1) {
    const ymd = `${month}-${String(d).padStart(2, '0')}`
    if (ymd > to) break
    days.push(ymd)
  }
  return days.length ? days : [focus]
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

/** 读 macOS 钥匙串里 Cursor Safe Storage 口令；超时/拒绝则空，不阻塞用量页。 */
function readCursorSafeStoragePassword(): string {
  try {
    const out = spawnSync(
      'security',
      ['find-generic-password', '-w', '-s', 'Cursor Safe Storage', '-a', 'Cursor Key'],
      { encoding: 'utf8', timeout: 20_000 },
    )
    if (out.status !== 0) return ''
    return String(out.stdout || '').replace(/\n$/, '')
  } catch {
    return ''
  }
}

/** Electron/Chromium v10：PBKDF2(password, saltysalt, 1003) → AES-128-CBC。 */
export function decryptCursorSafeStorage(value: string, password: string): string {
  if (!value.startsWith(SAFE_PREFIX) || !password) return ''
  try {
    let data = Buffer.from(value.slice(SAFE_PREFIX.length), 'base64')
    if (data.subarray(0, 3).toString('utf8') === 'v10') data = data.subarray(3)
    const key = pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1')
    const decipher = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20))
    const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8').trim()
    // 加密串本身不能当 Bearer；解密后才是会话 token
    if (!plain || plain.startsWith(SAFE_PREFIX)) return ''
    return plain
  } catch {
    return ''
  }
}

/** 明文 token 直接用；cursor-safe-storage 密文先解再返回。 */
export function normalizeCursorAuthToken(value: string): string {
  const text = String(value || '').trim()
  if (!text) return ''
  if (!text.startsWith(SAFE_PREFIX)) return text
  return decryptCursorSafeStorage(text, readCursorSafeStoragePassword())
}

/** macOS / Windows 上 Cursor 常把 accessToken 存在 state.vscdb，不一定有 auth.json。 */
function readTokenFromVscdb(dbPath: string): string {
  if (!existsSync(dbPath)) return ''
  try {
    // Node 22+；失败则退回空，不拖垮用量页
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (path: string, opts?: { readOnly?: boolean }) => {
        prepare: (sql: string) => { get: (...args: unknown[]) => { value?: unknown } | undefined }
        close: () => void
      }
    }
    const db = new DatabaseSync(dbPath, { readOnly: true })
    try {
      const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get('cursorAuth/accessToken')
      const value = row && typeof row.value === 'string' ? row.value.trim() : ''
      return normalizeCursorAuthToken(value)
    } finally {
      db.close()
    }
  } catch {
    return ''
  }
}

function readToken(env: NodeJS.ProcessEnv, home = homedir()): string {
  const explicit = normalizeCursorAuthToken((env.CURSOR_AUTH_TOKEN || '').trim())
  if (explicit) return explicit
  const paths: string[] = []
  const appData = (env.APPDATA || '').trim()
  if (appData) paths.push(join(appData, 'Cursor', 'auth.json'))
  paths.push(join(home, '.cursor', 'auth.json'))
  paths.push(join(home, '.config', 'Cursor', 'auth.json'))
  paths.push(join(home, 'Library', 'Application Support', 'Cursor', 'auth.json'))
  for (const path of paths) {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as { accessToken?: string }
      const token = normalizeCursorAuthToken(typeof raw.accessToken === 'string' ? raw.accessToken : '')
      if (token) return token
    } catch {
      // 下一处
    }
  }
  const dbPaths: string[] = []
  if (appData) dbPaths.push(join(appData, 'Cursor', 'User', 'globalStorage', 'state.vscdb'))
  dbPaths.push(join(home, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb'))
  dbPaths.push(join(home, '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb'))
  for (const dbPath of dbPaths) {
    const token = readTokenFromVscdb(dbPath)
    if (token) return token
  }
  return ''
}

/** 从 JWT sub 拼网页账单 Cookie。失败则空，由调用方改走 Bearer。 */
export function workosSessionCookie(token: string): string {
  try {
    const seg = String(token || '').split('.')[1] || ''
    if (!seg) return ''
    const payload = JSON.parse(Buffer.from(seg, 'base64url').toString('utf8')) as { sub?: string }
    const sub = String(payload.sub || '')
    const userId = sub.includes('|') ? sub.slice(sub.indexOf('|') + 1) : sub
    if (!userId) return ''
    return `WorkosCursorSessionToken=${encodeURIComponent(`${userId}::${token}`)}`
  } catch {
    return ''
  }
}

function normalizeDashboardEvent(raw: Record<string, unknown>): DashboardEvent | null {
  const usageRaw = (raw.tokenUsage || raw.token_usage) as Record<string, unknown> | undefined
  if (!usageRaw || typeof usageRaw !== 'object') return null
  const usageEventId = String(raw.usageEventId || raw.usage_event_id || '')
  const timestamp = Number(raw.timestamp)
  if (!usageEventId || !Number.isFinite(timestamp) || timestamp <= 0) return null
  return {
    timestamp,
    model: String(raw.model || 'cursor'),
    usageEventId,
    tokenUsage: {
      inputTokens: Number(usageRaw.inputTokens ?? usageRaw.input_tokens) || 0,
      outputTokens: Number(usageRaw.outputTokens ?? usageRaw.output_tokens) || 0,
      cacheReadTokens: Number(usageRaw.cacheReadTokens ?? usageRaw.cache_read_tokens) || 0,
      cacheWriteTokens: Number(usageRaw.cacheWriteTokens ?? usageRaw.cache_write_tokens) || 0,
    },
  }
}

/**
 * 拉取 [startYmd, endYmd] 闭开区间内的账单事件。
 * 注意：网页接口带 startDate 会返回空对象，只能分页后本地按时间过滤。
 */
async function fetchRange(
  startYmd: string,
  endYmd: string,
  token: string,
  fetchImpl: typeof fetch,
): Promise<DashboardEvent[]> {
  const start = shanghaiDayRange(startYmd)
  const end = shanghaiDayRange(endYmd)
  if (!start || !end) return []
  const cookie = workosSessionCookie(token)
  const events: DashboardEvent[] = []
  const seen = new Set<string>()
  for (let page = 1; page <= FETCH_MAX_PAGES; page += 1) {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      origin: 'https://cursor.com',
      referer: 'https://cursor.com/dashboard?tab=usage',
      accept: 'application/json',
    }
    if (cookie) headers.cookie = cookie
    else headers.authorization = `Bearer ${token}`
    const response = await fetchImpl(WEB_RPC, {
      method: 'POST',
      headers,
      body: JSON.stringify({ page, pageSize: FETCH_PAGE_SIZE }),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) return events
    const parsed = await response.json() as {
      totalUsageEventsCount?: number
      usageEventsDisplay?: Array<Record<string, unknown>>
    }
    const batch = Array.isArray(parsed.usageEventsDisplay) ? parsed.usageEventsDisplay : []
    if (batch.length === 0) break

    let pageMax = 0
    for (const raw of batch) {
      if (!raw || typeof raw !== 'object') continue
      const ev = normalizeDashboardEvent(raw)
      if (!ev) continue
      const ms = Number(ev.timestamp)
      if (ms > pageMax) pageMax = ms
      if (ms < start.start || ms >= end.end) continue
      if (seen.has(ev.usageEventId!)) continue
      seen.add(ev.usageEventId!)
      events.push(ev)
    }
    // 页码越大越旧：整页都早于窗口起点则后面不会再有目标日
    if (pageMax > 0 && pageMax < start.start) break
    const total = Number(parsed.totalUsageEventsCount || 0)
    if (page * FETCH_PAGE_SIZE >= total) break
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
  const token = opts.token ?? readToken(env, home)
  const paths = opts.ledgerPaths ?? ensureLedgerFiles(env, home)
  const userId = opts.userId ?? (ledgerOwner(paths) || activeUserId(env, home, now.getTime()))
  if (!token || !userId || paths.length === 0) return { appended: 0 }
  const days = opts.days && opts.days.length > 0 ? opts.days : [shanghaiToday(now)]
  const start = days.reduce((a, b) => (a < b ? a : b))
  const end = days.reduce((a, b) => (a > b ? a : b))
  const fetchImpl = opts.fetchImpl ?? fetch
  const rows: CursorLedgerRow[] = []
  const seen = new Set<string>()
  const events = await fetchRange(start, end, token, fetchImpl)
  for (const event of events) {
    const row = cursorLedgerRow(event, userId)
    if (!row || seen.has(row.job_id)) continue
    seen.add(row.job_id)
    rows.push(row)
  }
  if (rows.length === 0) return { appended: 0 }
  return { appended: appendFresh(paths, rows) }
}
