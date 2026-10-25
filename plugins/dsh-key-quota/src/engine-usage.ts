import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { peopleUsage, summarizeUsage, type PersonRow, type UsageEvent, type UsageSummary } from './stats.js'

type UserRow = { id: string, username: string, displayName: string, role: string }

export type EngineBundle = {
  events: UsageEvent[]
  users: UserRow[]
  active: { id: string, role: string, displayName: string } | null
}

function roots(env: NodeJS.ProcessEnv, home: string): string[] {
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

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

function parseEvents(text: string): UsageEvent[] {
  const rows: UsageEvent[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const raw = JSON.parse(line) as Record<string, unknown>
      const ts = String(raw.ts || '')
      if (!ts) continue
      rows.push({
        ts,
        source: String(raw.source || 'llm'),
        model: String(raw.model || ''),
        userId: String(raw.user_id || ''),
        prompt: num(raw.prompt_tokens),
        completion: num(raw.completion_tokens),
        cacheRead: num(raw.cache_read_tokens),
        total: num(raw.total_tokens),
        jobId: String(raw.job_id || ''),
        lane: String(raw.lane || ''),
      })
    } catch {
      // 坏行跳过
    }
  }
  return rows
}

function parseUsers(text: string): UserRow[] {
  try {
    const raw = JSON.parse(text) as { users?: unknown }
    const list = Array.isArray(raw.users) ? raw.users : []
    return list.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const row = item as Record<string, unknown>
      const id = String(row.id || '')
      if (!id) return []
      return [{
        id,
        username: String(row.username || ''),
        displayName: String(row.display_name || row.username || ''),
        role: String(row.role || ''),
      }]
    })
  } catch {
    return []
  }
}

function parseActive(text: string): (NonNullable<EngineBundle['active']> & { exp: number }) | null {
  try {
    const raw = JSON.parse(text) as Record<string, unknown>
    const id = String(raw.id || raw.user_id || '')
    if (!id) return null
    const exp = Number(raw.exp)
    return {
      id,
      role: String(raw.role || ''),
      displayName: String(raw.display_name || raw.username || ''),
      exp: Number.isFinite(exp) && exp > 0 ? Math.floor(exp) : 0,
    }
  } catch {
    return null
  }
}

function fileMtime(path: string): number {
  try { return statSync(path).mtimeMs } catch { return -1 }
}

/** 登录和账本经常不在同一份副本里。认最新一份未过期的会话。 */
function pickAuth(
  env: NodeJS.ProcessEnv,
  home: string,
  read: (path: string) => string | null,
  now = Date.now(),
): { users: UserRow[], active: EngineBundle['active'] } {
  let bestPath = ''
  let bestMtime = -1
  let best: ReturnType<typeof parseActive> = null
  for (const root of roots(env, home)) {
    const path = join(root, 'auth', 'active.json')
    const mtime = fileMtime(path)
    if (mtime < 0 || mtime < bestMtime) continue
    const parsed = parseActive(read(path) || '')
    if (!parsed) continue
    if (parsed.exp > 0 && parsed.exp * 1000 <= now) continue
    bestPath = path
    bestMtime = mtime
    best = parsed
  }
  if (!bestPath || !best) return { users: [], active: null }
  return {
    users: parseUsers(read(join(bestPath, '..', 'users.json')) || ''),
    active: { id: best.id, role: best.role, displayName: best.displayName },
  }
}

export type PlatformViewer = { id: string, displayName: string, role: 'admin' | 'user' }

/** 认工作助手当前登录。平台登录写入同一份会话后，这里跟着变。 */
export function platformSession(bundle = loadEngineBundle()): {
  viewer: PlatformViewer | null
  colleagues: Array<{ id: string, displayName: string }>
} {
  const colleagues = bundle.users
    .filter((user) => user.id)
    .map((user) => ({ id: user.id, displayName: user.displayName || user.username || user.id }))
  const active = bundle.active
  if (!active?.id) return { viewer: null, colleagues }
  return {
    viewer: {
      id: active.id,
      displayName: active.displayName || active.id,
      role: active.role === 'admin' ? 'admin' : 'user',
    },
    colleagues,
  }
}

export function loadEngineBundle(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
  read = (path: string) => {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return null
    }
  },
): EngineBundle {
  let best = ''
  let bestMtime = -1
  for (const root of roots(env, home)) {
    const path = join(root, 'usage', 'events.jsonl')
    if (!existsSync(path)) continue
    let mtime = 0
    try { mtime = statSync(path).mtimeMs } catch { mtime = 0 }
    if (mtime >= bestMtime) {
      best = path
      bestMtime = mtime
    }
  }
  const events = best ? parseEvents(read(best) || '') : []
  const auth = pickAuth(env, home, read)
  const withMeter = mergeMeter(events, auth.active?.id || '', env, home, read)
  const ledgerTs = events.reduce((max, evt) => evt.ts > max ? evt.ts : max, '')
  return {
    events: mergeSessions(withMeter, auth.active?.id || '', env, ledgerTs),
    users: auth.users,
    active: auth.active,
  }
}

function meterFiles(env: NodeJS.ProcessEnv, home: string): string[] {
  const dirs: string[] = []
  const explicit = (env.DSH_LLM_METER_DIR || '').trim()
  if (explicit) dirs.push(explicit)
  const dsh = (env.DSH_HOME || '').trim()
  if (dsh) dirs.push(join(dsh, 'llm-meter'))
  dirs.push(join(home, '.dsh', 'llm-meter'))
  const files: string[] = []
  for (const dir of dirs) {
    const path = join(dir, 'events.jsonl')
    if (!files.includes(path)) files.push(path)
  }
  return files
}

function realFile(path: string): boolean {
  try {
    return lstatSync(path).isFile()
  } catch {
    return false
  }
}

/** 引擎尚未收进 usage 账本的 meter 行。归当前登录人，已有 job_id 不重复计入。 */
function mergeMeter(
  events: UsageEvent[],
  activeId: string,
  env: NodeJS.ProcessEnv,
  home: string,
  read: (path: string) => string | null,
): UsageEvent[] {
  const known = new Set(events.map((evt) => evt.jobId).filter(Boolean))
  const extra: UsageEvent[] = []
  for (const path of meterFiles(env, home)) {
    if (!realFile(path)) continue
    for (const row of parseMeter(read(path) || '')) {
      if (known.has(row.jobId)) continue
      known.add(row.jobId)
      extra.push({ ...row, userId: activeId })
    }
  }
  return extra.length ? events.concat(extra) : events
}

function parseMeter(text: string): UsageEvent[] {
  const rows: UsageEvent[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const raw = JSON.parse(line) as Record<string, unknown>
      const rawId = String(raw.id || '').trim()
      if (!rawId) continue
      const prompt = num(raw.prompt_tokens)
      const completion = num(raw.completion_tokens)
      const cacheRead = num(raw.cache_read_tokens)
      const cacheWrite = num(raw.cache_write_tokens)
      const reasoning = num(raw.reasoning_tokens)
      const base = prompt + completion + cacheRead + cacheWrite
      let total = num(raw.total_tokens)
      if (total <= 0) total = base
      else if (reasoning > 0 && total === base + reasoning) total = base
      const lane = String(raw.source || 'dsh_other')
      rows.push({
        ts: String(raw.ts || ''),
        source: 'llm',
        model: String(raw.model || ''),
        userId: '',
        prompt,
        completion,
        cacheRead,
        total,
        jobId: rawId.startsWith('meter_') ? rawId : `meter_${rawId}`.slice(0, 80),
        lane: lane.startsWith('dsh_') ? lane : 'dsh_other',
      })
    } catch {
      // 坏行跳过
    }
  }
  return rows.filter((row) => row.ts)
}

function sessionRoot(env: NodeJS.ProcessEnv): string {
  const local = (env.LOCALAPPDATA || '').trim()
  return local ? join(local, 'ZR_DSH', 'dsh-home', 'sessions') : ''
}

function shanghaiIso(ms: number): string {
  const sh = new Date(ms + 8 * 60 * 60 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${sh.getUTCFullYear()}-${p(sh.getUTCMonth() + 1)}-${p(sh.getUTCDate())}T${p(sh.getUTCHours())}:${p(sh.getUTCMinutes())}:${p(sh.getUTCSeconds())}+08:00`
}

/** 会话里的供应商 usage。引擎账本停更之后的才补，避免和已入库的流水叠记。 */
function usageFromSession(text: string, sessionId: string, afterTs: string): UsageEvent[] {
  const rows: UsageEvent[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let ev: Record<string, unknown>
    try {
      ev = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    if (ev.type !== 'assistant/message') continue
    const seq = Number(ev.seq)
    const time = Number(ev.time)
    if (!Number.isInteger(seq) || seq < 0 || !Number.isFinite(time)) continue
    const data = ev.data && typeof ev.data === 'object' ? ev.data as Record<string, unknown> : {}
    const usage = data.usage && typeof data.usage === 'object' ? data.usage as Record<string, unknown> : null
    if (!usage) continue
    const prompt = num(usage.inputTokens)
    const completion = num(usage.outputTokens)
    const cacheRead = num(usage.cacheReadTokens)
    const cacheWrite = num(usage.cacheWriteTokens)
    const reasoning = num(usage.reasoningTokens)
    const base = prompt + completion + cacheRead + cacheWrite
    let total = num(usage.totalTokens)
    if (total <= 0) total = base
    else if (reasoning > 0 && total === base + reasoning) total = base
    if (base <= 0 && total <= 0) continue
    const ts = shanghaiIso(time)
    if (afterTs && ts <= afterTs) continue
    const message = data.message && typeof data.message === 'object' ? data.message as Record<string, unknown> : {}
    const source = message.source && typeof message.source === 'object' ? message.source as Record<string, unknown> : {}
    const provider = String(source.provider || '')
    const cursor = /cursor/i.test(provider) && !/deepseek/i.test(provider)
    rows.push({
      ts,
      source: cursor ? 'cursor' : 'llm',
      model: String(source.model || provider || ''),
      userId: '',
      prompt,
      completion,
      cacheRead,
      total: total > 0 ? total : base,
      jobId: `sess_${sessionId}_${seq}`.slice(0, 80),
      lane: cursor ? 'cursor_code' : 'dsh_chat',
    })
  }
  return rows
}

function mergeSessions(events: UsageEvent[], activeId: string, env: NodeJS.ProcessEnv, afterTs: string): UsageEvent[] {
  const root = sessionRoot(env)
  if (!root || !existsSync(root)) return events
  const known = new Set(events.map((evt) => evt.jobId).filter(Boolean))
  const fingerprints = new Set(events.map((evt) => `${evt.ts.slice(0, 19)}|${evt.model}|${evt.total}|${evt.prompt}|${evt.completion}`))
  const extra: UsageEvent[] = []
  let workspaces: string[] = []
  try {
    workspaces = readdirSync(root, { withFileTypes: true }).filter((ent) => ent.isDirectory()).map((ent) => ent.name)
  } catch {
    return events
  }
  for (const workspace of workspaces) {
    let sessions: string[] = []
    try {
      sessions = readdirSync(join(root, workspace), { withFileTypes: true }).filter((ent) => ent.isDirectory()).map((ent) => ent.name)
    } catch {
      continue
    }
    for (const name of sessions) {
      if (!name.startsWith('session-')) continue
      const file = join(root, workspace, name, 'session.v4.jsonl.zstd')
      if (!existsSync(file)) continue
      let text = ''
      try {
        text = zstdDecompressSync(readFileSync(file)).toString('utf8')
      } catch {
        continue
      }
      for (const row of usageFromSession(text, name.slice('session-'.length), afterTs)) {
        const fingerprint = `${row.ts.slice(0, 19)}|${row.model}|${row.total}|${row.prompt}|${row.completion}`
        if (!row.jobId || known.has(row.jobId) || fingerprints.has(fingerprint)) continue
        known.add(row.jobId)
        fingerprints.add(fingerprint)
        extra.push({ ...row, userId: activeId })
      }
    }
  }
  return extra.length ? events.concat(extra) : events
}

export function panelQuery(url: string): { on: string, grain: 'day' | 'month', scope: 'personal' | 'enterprise' } {
  const q = url.includes('?') ? url.slice(url.indexOf('?') + 1) : ''
  const params = new URLSearchParams(q)
  return {
    on: params.get('on') || '',
    grain: params.get('grain') === 'month' ? 'month' : 'day',
    scope: params.get('scope') === 'enterprise' ? 'enterprise' : 'personal',
  }
}

export function panelUsage(url: string, bundle = loadEngineBundle()): {
  usage: UsageSummary
  people: PersonRow[] | null
  viewerAdmin: boolean
  scope: 'personal' | 'enterprise'
  loaded: boolean
} {
  const query = panelQuery(url)
  const viewerAdmin = bundle.active?.role === 'admin'
  const scope = query.scope === 'enterprise' && viewerAdmin ? 'enterprise' : 'personal'
  const userId = scope === 'personal' ? (bundle.active?.id || null) : null
  const usage = summarizeUsage(bundle.events, { on: query.on, grain: query.grain, userId })
  const from = query.grain === 'month' ? usage.month_from : usage.on
  const to = query.grain === 'month' ? usage.month_to : usage.on
  const people = scope === 'enterprise' ? peopleUsage(bundle.events, bundle.users, from, to) : null
  return { usage, people, viewerAdmin, scope, loaded: bundle.events.length > 0 }
}
