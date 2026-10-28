import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { sideUsagePath, userUsagePath } from './side-usage.js'
import { peopleUsage, summarizeUsage, type PersonRow, type UsageDetailRow, type UsageEvent, type UsageSummary } from './stats.js'

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

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/** 只认明确的 id 字段。不从 jobId 里拆会话号或消息号。 */
function idField(value: unknown): string {
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text || text.length > 80) return ''
    return text
  }
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 1e15) return String(value)
  return ''
}

function parseEvents(text: string): UsageEvent[] {
  const rows: UsageEvent[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const raw = JSON.parse(line) as Record<string, unknown>
      const ts = String(raw.ts || '')
      if (!ts) continue
      const sessionId = idField(raw.session_id)
      const messageId = idField(raw.message_id)
      rows.push({
        ts,
        source: String(raw.source || 'llm'),
        provider: String(raw.provider || ''),
        model: String(raw.model || ''),
        userId: String(raw.user_id || ''),
        prompt: num(raw.prompt_tokens),
        completion: num(raw.completion_tokens),
        cacheRead: num(raw.cache_read_tokens),
        total: num(raw.total_tokens),
        jobId: String(raw.job_id || ''),
        lane: String(raw.lane || ''),
        ...(sessionId ? { sessionId } : {}),
        ...(messageId ? { messageId } : {}),
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

function newestFile(env: NodeJS.ProcessEnv, home: string, name: string): string {
  let best = ''
  let bestMtime = -1
  for (const root of roots(env, home)) {
    const path = join(root, 'auth', name)
    const mtime = fileMtime(path)
    if (mtime >= 0 && mtime >= bestMtime) {
      best = path
      bestMtime = mtime
    }
  }
  return best
}

/** 桌面侧栏的当前登录。只读用户名和角色，不读密码。 */
function desktopLoginDirs(env: NodeJS.ProcessEnv, home: string): string[] {
  const out: string[] = []
  const push = (path: string) => {
    if (path && !out.includes(path)) out.push(path)
  }
  const appData = (env.APPDATA || '').trim()
  if (appData) push(join(appData, '@deepseek-ai', 'dsh-desktop', 'local-login'))
  push(join(home, 'Library', 'Application Support', '@deepseek-ai', 'dsh-desktop', 'local-login'))
  push(join(home, 'AppData', 'Roaming', '@deepseek-ai', 'dsh-desktop', 'local-login'))
  return out
}

function parseDesktopSession(text: string, now: number): { username: string, displayName: string } | null {
  try {
    const raw = JSON.parse(text) as Record<string, unknown>
    const username = String(raw.username || '').trim()
    if (!username || username.length > 80) return null
    const exp = Number(raw.expiresAt)
    if (!Number.isFinite(exp) || exp <= 0) return null
    const expMs = exp > 1e12 ? exp : exp * 1000
    if (expMs <= now) return null
    const displayName = typeof raw.displayName === 'string' ? raw.displayName.trim().slice(0, 80) : ''
    return { username, displayName }
  } catch {
    return null
  }
}

function desktopRole(text: string, username: string): string {
  try {
    const raw = JSON.parse(text) as { users?: unknown }
    const list = Array.isArray(raw.users) ? raw.users : []
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      const row = item as Record<string, unknown>
      if (String(row.username || '') !== username) continue
      const role = String(row.role || '')
      return role === 'admin' || role === 'user' ? role : ''
    }
  } catch {
    return ''
  }
  return ''
}

function pickDesktopLogin(
  env: NodeJS.ProcessEnv,
  home: string,
  read: (path: string) => string | null,
  now: number,
): { username: string, displayName: string, role: string } | null {
  for (const dir of desktopLoginDirs(env, home)) {
    const session = parseDesktopSession(read(join(dir, 'session.json')) || '', now)
    if (!session) continue
    const role = desktopRole(read(join(dir, 'users.json')) || '', session.username)
    if (!role) continue
    return { username: session.username, displayName: session.displayName || session.username, role }
  }
  return null
}

/** 登录和账本经常不在同一份副本里。桌面侧栏的登录是当前登录人的权威来源，
 *  引擎 active.json 只是兜底。 */
function pickAuth(
  env: NodeJS.ProcessEnv,
  home: string,
  read: (path: string) => string | null,
  now = Date.now(),
): { users: UserRow[], active: EngineBundle['active'] } {
  // 先从引擎拿用户列表（id、role 映射）
  const usersPath = newestFile(env, home, 'users.json')
  const users = usersPath ? parseUsers(read(usersPath) || '') : []

  // 桌面侧栏登录是权威来源
  const login = pickDesktopLogin(env, home, read, now)
  if (login) {
    const matched = users.find((user) => user.username === login.username)
    const listed = users.length ? users : [{
      id: login.username,
      username: login.username,
      displayName: login.displayName,
      role: login.role,
    }]
    return {
      users: listed,
      active: {
        id: matched?.id || login.username,
        role: matched?.role || login.role,
        displayName: matched?.displayName || login.displayName || login.username,
      },
    }
  }

  // 兜底：引擎 active.json
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
  if (bestPath && best) {
    const authUsers = parseUsers(read(join(bestPath, '..', 'users.json')) || '')
    return {
      users: authUsers.length ? authUsers : users,
      active: { id: best.id, role: best.role, displayName: best.displayName },
    }
  }
  return { users, active: null }
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
  const withMeter = mergeMeter(events, env, home, read)
  const ledgerTs = events.reduce((max, evt) => evt.ts > max ? evt.ts : max, '')
  const withSessions = mergeSessions(withMeter, env, home, ledgerTs, auth.users)
  const withUser = mergeUserUsage(withSessions, home, read)
  return {
    events: applyLedgerIdentity(withUser, home, read),
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

function eventFingerprint(evt: UsageEvent): string {
  return `${evt.ts.slice(0, 19)}|${evt.provider || ''}|${evt.model}|${evt.total}|${evt.prompt}|${evt.completion}`
}

/** 从已有事件里建 sessionId → userId 映射，供补充事件继承用户身份。 */
function sessionUserMap(events: UsageEvent[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const evt of events) {
    const sid = (evt.sessionId || '').replace(/^session-/, '')
    if (sid && evt.userId && !map.has(sid)) {
      map.set(sid, evt.userId)
    }
  }
  return map
}

/** 引擎尚未收进 usage 账本的 meter 行，加上标题生成和网页搜索的供应商用量。
 *  用户身份优先用行内 user_id，其次按 sessionId 从引擎已有事件继承，都没有就留空。 */
function mergeMeter(
  events: UsageEvent[],
  env: NodeJS.ProcessEnv,
  home: string,
  read: (path: string) => string | null,
): UsageEvent[] {
  const known = new Set(events.map((evt) => evt.jobId).filter(Boolean))
  const seen = new Set(events.map(eventFingerprint))
  const sessionUser = sessionUserMap(events)
  const extra: UsageEvent[] = []
  const take = (row: UsageEvent, dedupeFingerprint: boolean) => {
    if (!row.jobId || known.has(row.jobId)) return
    const fp = eventFingerprint(row)
    if (dedupeFingerprint && seen.has(fp)) return
    known.add(row.jobId)
    seen.add(fp)
    extra.push({ ...row, userId: row.userId || sessionUser.get(row.sessionId || '') || '' })
  }
  for (const path of meterFiles(env, home)) {
    if (!realFile(path)) continue
    for (const row of parseMeter(read(path) || '')) take(row, false)
  }
  const side = sideUsagePath(home)
  if (realFile(side)) {
    for (const row of parseMeter(read(side) || '')) {
      if (row.total <= 0) continue
      take(row, true)
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
      const task = typeof raw.task === 'string' ? raw.task.trim() : ''
      const sessionId = idField(raw.session_id)
      const messageId = idField(raw.message_id)
      rows.push({
        ts: String(raw.ts || ''),
        source: 'llm',
        provider: String(raw.provider || ''),
        model: String(raw.model || ''),
        userId: String(raw.user_id || ''),
        prompt,
        completion,
        cacheRead,
        total,
        jobId: rawId.startsWith('meter_') || rawId.startsWith('kqside_') ? rawId.slice(0, 80) : `meter_${rawId}`.slice(0, 80),
        lane: lane.startsWith('dsh_') ? lane : 'dsh_other',
        ...(task ? { task } : {}),
        ...(rawId.startsWith('kqside_') && cacheWrite > 0 ? { cacheWrite } : {}),
        ...(sessionId ? { sessionId } : {}),
        ...(messageId ? { messageId } : {}),
      })
    } catch {
      // 坏行跳过
    }
  }
  return rows.filter((row) => row.ts)
}

function sessionRoots(env: NodeJS.ProcessEnv, home: string): string[] {
  const out: string[] = []
  const push = (path: string) => {
    if (path && existsSync(path) && !out.includes(path)) out.push(path)
  }
  const local = (env.LOCALAPPDATA || '').trim()
  if (local) push(join(local, 'ZR_DSH', 'dsh-home', 'sessions'))
  push(join(home, 'AppData', 'Local', 'ZR_DSH', 'dsh-home', 'sessions'))
  push(join(home, 'Library', 'Application Support', 'zr-workbuddy-desktop', 'dsh-home', 'sessions'))
  push(join(home, '.dsh', 'sessions'))
  const dsh = (env.DSH_HOME || '').trim() || join(home, '.dsh')
  push(join(dsh, 'sessions'))
  return out
}

function shanghaiIso(ms: number): string {
  const sh = new Date(ms + 8 * 60 * 60 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${sh.getUTCFullYear()}-${p(sh.getUTCMonth() + 1)}-${p(sh.getUTCDate())}T${p(sh.getUTCHours())}:${p(sh.getUTCMinutes())}:${p(sh.getUTCSeconds())}+08:00`
}

/** 一次遍历同时提取 title、cwd username、usage rows。避免 3 次 split + 3 次遍历。 */
function parseSessionFile(
  text: string,
  sessionId: string,
  afterTs: string,
): { taskName: string, cwdUser: string, rows: UsageEvent[] } {
  const lines = text.split('\n')
  let taskName = ''
  let cwdUser = ''
  const rows: UsageEvent[] = []
  // 文件只有 1 行（元信息）直接跳过 usage 解析
  if (lines.length <= 1) {
    const first = lines.find((l) => l.trim()) || ''
    try {
      const ev = JSON.parse(first) as Record<string, unknown>
      if (ev.type === 'session' && typeof ev.cwd === 'string') {
        const m = ev.cwd.match(/\/Users\/([^\/]+)/i) || ev.cwd.match(/\/home\/([^\/]+)/i) || ev.cwd.match(/[A-Z]:\\Users\\([^\\]+)/i)
        if (m) cwdUser = m[1].toLowerCase()
      }
    } catch { /* ignore */ }
    return { taskName, cwdUser, rows }
  }
  for (const line of lines) {
    if (!line.trim()) continue
    // 快速预判：先看行里有没有需要的关键字，避免每个都 JSON.parse
    const has = line.includes('"type"')
    if (!has) continue
    let ev: Record<string, unknown>
    try { ev = JSON.parse(line) as Record<string, unknown> } catch { continue }
    const t = ev.type
    // session/title → 任务名（最后一条覆盖前面的）
    if (t === 'session/title') {
      const data = ev.data && typeof ev.data === 'object' ? ev.data as Record<string, unknown> : {}
      const name = String(data.title || '').trim()
      if (name) taskName = name
      continue
    }
    // session 元信息 → 提取 cwd 用户名
    if (t === 'session' && typeof ev.cwd === 'string') {
      if (!cwdUser) {
        const m = ev.cwd.match(/\/Users\/([^\/]+)/i) || ev.cwd.match(/\/home\/([^\/]+)/i) || ev.cwd.match(/[A-Z]:\\Users\\([^\\]+)/i)
        if (m) cwdUser = m[1].toLowerCase()
      }
      continue
    }
    // assistant/message → usage 行
    if (t === 'assistant/message') {
      const seq = Number(ev.seq)
      const time = Number(ev.time)
      if (!Number.isInteger(seq) || seq < 0 || !Number.isFinite(time)) continue
      const ms = time < 1e12 ? time * 1000 : time
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
      const ts = shanghaiIso(ms)
      if (afterTs && ts <= afterTs) continue
      const turn = Number(data.turn)
      const step = Number(data.step)
      const message = data.message && typeof data.message === 'object' ? data.message as Record<string, unknown> : {}
      const source = message.source && typeof message.source === 'object' ? message.source as Record<string, unknown> : {}
      const provider = String(source.provider || '')
      const cursor = /cursor/i.test(provider) && !/deepseek/i.test(provider)
      rows.push({
        ts,
        source: cursor ? 'cursor' : 'llm',
        provider,
        model: String(source.model || ''),
        userId: '',
        prompt,
        completion,
        cacheRead,
        total: total > 0 ? total : base,
        jobId: `sess_${sessionId}_${seq}`.slice(0, 80),
        lane: cursor ? 'cursor_code' : 'dsh_chat',
        task: taskName,
        ...(sessionId.trim() ? { sessionId: sessionId.trim().slice(0, 80) } : {}),
        messageId: String(seq),
        ...(Number.isInteger(turn) && turn > 0 ? { turn } : {}),
        ...(Number.isInteger(step) && step > 0 ? { step } : {}),
      })
    }
  }
  return { taskName, cwdUser, rows }
}

/** 侧栏上的会话标题。文件按追加写入，最后一条 session/title 是当前任务名。 */
function sessionTaskName(text: string): string {
  let title = ''
  for (const line of text.split('\n')) {
    if (!line.includes('"session/title"')) continue
    let ev: Record<string, unknown>
    try {
      ev = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    if (ev.type !== 'session/title') continue
    const data = ev.data && typeof ev.data === 'object' ? ev.data as Record<string, unknown> : {}
    const name = String(data.title || '').trim()
    if (name) title = name
  }
  return title
}

/** 从 session.jsonl.zstd 第一行（session 元信息）的 cwd 里提取操作系统用户名（/Users/XXX）。 */
function sessionCwdUsername(text: string): string {
  const first = text.split('\n').find((l) => l.includes('"type"') && l.includes('"session"') && !l.includes('session/title')) || ''
  let ev: Record<string, unknown>
  try { ev = JSON.parse(first) as Record<string, unknown> } catch { return '' }
  const cwd = String(ev.cwd || '').trim()
  const m = cwd.match(/\/Users\/([^\/]+)/i) || cwd.match(/\/home\/([^\/]+)/i) || cwd.match(/[A-Z]:\\Users\\([^\\]+)/i)
  return m ? m[1].toLowerCase() : ''
}

/** 会话里的供应商 usage。引擎账本停更之后的才补，避免和已入库的流水叠记。 */
function usageFromSession(text: string, sessionId: string, afterTs: string): UsageEvent[] {
  const task = sessionTaskName(text)
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
    const ms = time < 1e12 ? time * 1000 : time
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
    const ts = shanghaiIso(ms)
    if (afterTs && ts <= afterTs) continue
    const turn = Number(data.turn)
    const step = Number(data.step)
    const message = data.message && typeof data.message === 'object' ? data.message as Record<string, unknown> : {}
    const source = message.source && typeof message.source === 'object' ? message.source as Record<string, unknown> : {}
    const provider = String(source.provider || '')
    const cursor = /cursor/i.test(provider) && !/deepseek/i.test(provider)
    rows.push({
      ts,
      source: cursor ? 'cursor' : 'llm',
      provider,
      model: String(source.model || ''),
      userId: '',
      prompt,
      completion,
      cacheRead,
      total: total > 0 ? total : base,
      jobId: `sess_${sessionId}_${seq}`.slice(0, 80),
      lane: cursor ? 'cursor_code' : 'dsh_chat',
      task,
      ...(sessionId.trim() ? { sessionId: sessionId.trim().slice(0, 80) } : {}),
      messageId: String(seq),
      ...(Number.isInteger(turn) && turn > 0 ? { turn } : {}),
      ...(Number.isInteger(step) && step > 0 ? { step } : {}),
    })
  }
  return rows
}

function isZstdMagic(buf: Buffer, offset: number): boolean {
  return offset + 4 <= buf.length
    && buf[offset] === 0x28 && buf[offset + 1] === 0xb5
    && buf[offset + 2] === 0x2f && buf[offset + 3] === 0xfd
}

/** 按帧头和块长度算出这一帧的字节数。压缩块里碰巧出现魔数时不会被当成新帧。 */
function zstdFrameSize(buf: Buffer, offset: number): number | null {
  if (!isZstdMagic(buf, offset) || offset + 6 > buf.length) return null
  let p = offset + 4
  const desc = buf[p++]
  if ((desc & 0x08) !== 0) return null
  const fcsFlag = desc >>> 6
  const single = (desc & 0x20) !== 0
  const checksum = (desc & 0x04) !== 0
  const didFlag = desc & 0x03
  if (!single) {
    if (p >= buf.length) return null
    p += 1
  }
  p += [0, 1, 2, 4][didFlag]
  const fcsSize = single && fcsFlag === 0 ? 1 : [0, 2, 4, 8][fcsFlag]
  p += fcsSize
  if (p > buf.length) return null
  while (p + 3 <= buf.length) {
    const header = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16)
    p += 3
    const last = header & 1
    const type = (header >>> 1) & 3
    const size = header >>> 3
    if (type === 0) p += size
    else if (type === 1) p += 1
    else if (type === 2) p += size
    else return null
    if (p > buf.length) return null
    if (last) {
      if (checksum) p += 4
      if (p > buf.length) return null
      return p - offset
    }
  }
  return null
}

function sessionTextByMagic(buf: Buffer): string {
  const starts: number[] = []
  for (let i = 0; i <= buf.length - 4; i++) {
    if (isZstdMagic(buf, i)) starts.push(i)
  }
  if (starts.length <= 1) return zstdDecompressSync(buf).toString('utf8')
  const parts: string[] = []
  for (let n = 0; n < starts.length; n++) {
    try {
      parts.push(zstdDecompressSync(buf.subarray(starts[n], starts[n + 1] ?? buf.length)).toString('utf8'))
    } catch {
      // 这一段解不开就跳过，后面的帧继续
    }
  }
  if (!parts.length) return zstdDecompressSync(buf).toString('utf8')
  return parts.join('\n')
}

/** 会话文件是多帧 zstd 拼在一起，每帧一行。单帧整文件（测试夹具）也能解开。 */
function sessionText(buf: Buffer): string {
  if (!isZstdMagic(buf, 0)) return zstdDecompressSync(buf).toString('utf8')
  const parts: string[] = []
  let offset = 0
  while (offset < buf.length) {
    const size = zstdFrameSize(buf, offset)
    if (!size) return sessionTextByMagic(buf)
    try {
      parts.push(zstdDecompressSync(buf.subarray(offset, offset + size)).toString('utf8'))
    } catch {
      return sessionTextByMagic(buf)
    }
    offset += size
  }
  return parts.join('\n')
}

function mergeSessions(events: UsageEvent[], env: NodeJS.ProcessEnv, home: string, afterTs: string, users: Array<{ id: string, username?: string, displayName?: string }> = []): UsageEvent[] {
  const roots = sessionRoots(env, home)
  if (!roots.length) return events
  const known = new Set(events.map((evt) => evt.jobId).filter(Boolean))
  const fingerprints = new Set(events
    .filter((evt) => evt.lane !== 'dsh_title' && evt.lane !== 'dsh_search')
    .map((evt) => `${evt.ts.slice(0, 19)}|${evt.model}|${evt.total}|${evt.prompt}|${evt.completion}`))
  const sessionUser = sessionUserMap(events)
  // 从已有事件里提取出现过的 sessionId，只处理这些 session（避免全量解压所有历史 session）
  const activeSessionIds = new Set<string>()
  for (const evt of events) {
    const sid = (evt.sessionId || '').replace(/^session-/, '')
    if (sid) activeSessionIds.add(sid)
  }
  // username (lower) → userId，用于从 session cwd 提取用户名后找 userId
  const usernameToId = new Map<string, string>()
  for (const u of users) {
    if (u.username) usernameToId.set(u.username.toLowerCase(), u.id)
    if (u.displayName) usernameToId.set(u.displayName.toLowerCase(), u.id)
  }
  const extra: UsageEvent[] = []
  const sessionTaskMap = new Map<string, string>()
  for (const root of roots) {
    let workspaces: string[] = []
    try {
      workspaces = readdirSync(root, { withFileTypes: true }).filter((ent) => ent.isDirectory()).map((ent) => ent.name)
    } catch {
      continue
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
        const sessionId = name.slice('session-'.length)
        // 生产环境 events.jsonl 有 sessionId → 只处理出现过的；测试/空数据 → 全量处理
        const filterSessions = activeSessionIds.size > 0
        if (filterSessions && !activeSessionIds.has(sessionId)) continue
        let file = join(root, workspace, name, 'session.v4.jsonl.zstd')
        if (!existsSync(file)) file = join(root, workspace, name, 'session.jsonl.zstd')
        if (!existsSync(file)) continue
        let text = ''
        try {
          text = sessionText(readFileSync(file))
        } catch {
          continue
        }
        const parsed = parseSessionFile(text, sessionId, afterTs)
        if (parsed.taskName && !sessionTaskMap.has(sessionId)) sessionTaskMap.set(sessionId, parsed.taskName)
        // 最后一条 session/title 是最终任务名，用它覆盖 rows 里中间态的 taskName
        const finalTask = sessionTaskMap.get(sessionId) || parsed.taskName
        if (!sessionUser.has(sessionId) && parsed.cwdUser) {
          const uid = usernameToId.get(parsed.cwdUser) || ''
          if (uid) sessionUser.set(sessionId, uid)
        }
        for (const row of parsed.rows) {
          const fingerprint = `${row.ts.slice(0, 19)}|${row.model}|${row.total}|${row.prompt}|${row.completion}`
          if (!row.jobId || known.has(row.jobId) || fingerprints.has(fingerprint)) continue
          known.add(row.jobId)
          fingerprints.add(fingerprint)
          extra.push({ ...row, task: finalTask || row.task, userId: sessionUser.get(sessionId) || row.userId || '' })
        }
      }
      // `.dsh/sessions` 部分目录不带 "session-" 前缀，兜底遍历
      for (const name of sessions) {
        if (name.startsWith('session-')) continue
        if (!/^[0-9a-f]{8}-/i.test(name)) continue
        const filterSessions = activeSessionIds.size > 0
        if (filterSessions && !activeSessionIds.has(name)) continue
        let file = join(root, workspace, name, 'session.jsonl.zstd')
        if (!existsSync(file)) file = join(root, workspace, name, 'session.v4.jsonl.zstd')
        if (!existsSync(file)) continue
        let text = ''
        try {
          text = sessionText(readFileSync(file))
        } catch {
          continue
        }
        const sessionId = name
        const parsed = parseSessionFile(text, sessionId, afterTs)
        if (parsed.taskName && !sessionTaskMap.has(sessionId)) sessionTaskMap.set(sessionId, parsed.taskName)
        const finalTask = sessionTaskMap.get(sessionId) || parsed.taskName
        if (!sessionUser.has(sessionId) && parsed.cwdUser) {
          const uid = usernameToId.get(parsed.cwdUser) || ''
          if (uid) sessionUser.set(sessionId, uid)
        }
        for (const row of parsed.rows) {
          const fingerprint = `${row.ts.slice(0, 19)}|${row.model}|${row.total}|${row.prompt}|${row.completion}`
          if (!row.jobId || known.has(row.jobId) || fingerprints.has(fingerprint)) continue
          known.add(row.jobId)
          fingerprints.add(fingerprint)
          extra.push({ ...row, task: finalTask || row.task, userId: sessionUser.get(sessionId) || row.userId || '' })
        }
      }
    }
  }
  // 回填已有事件的 task 和 userId
  const merged = extra.length ? events.concat(extra) : events
  for (const evt of merged) {
    const sid = (evt.sessionId || '').replace(/^session-/, '')
    if (!evt.task && sid && sessionTaskMap.has(sid)) {
      evt.task = sessionTaskMap.get(sid) || ''
    }
    if (!evt.userId && sid && sessionUser.has(sid)) {
      evt.userId = sessionUser.get(sid) || ''
    }
  }
  return merged
}

/** 插件自己的用户用量台账是用户身份的权威来源。
 *  按指纹匹配已有事件，用台账里的 user_id 覆盖（修正引擎可能写错/漏写的身份）；
 *  匹配不上的台账行直接追加。 */
function mergeUserUsage(events: UsageEvent[], home: string, read: (path: string) => string | null): UsageEvent[] {
  const path = userUsagePath(home)
  if (!realFile(path)) return events
  const byFp = new Map<string, UsageEvent>()
  for (const evt of events) {
    const fp = eventFingerprint(evt)
    if (!byFp.has(fp)) byFp.set(fp, evt)
  }
  let changed = false
  const extra: UsageEvent[] = []
  for (const row of parseMeter(read(path) || '')) {
    if (row.total <= 0) continue
    const fp = eventFingerprint(row)
    const existing = byFp.get(fp)
    if (existing) {
      if (row.userId && existing.userId !== row.userId) {
        existing.userId = row.userId
        changed = true
      }
      if (row.sessionId && !existing.sessionId) {
        existing.sessionId = row.sessionId
        changed = true
      }
    } else {
      extra.push(row)
    }
  }
  if (!changed && extra.length === 0) return events
  return events.concat(extra)
}

/** 用户台账（user-usage.jsonl + side-usage.jsonl）是身份的权威来源。
 *  mergeUserUsage 只修正了指纹匹配的事件，这里把同一 session 下其余事件的身份也统一成台账里的 user_id。
 *  没有台账记录的事件保留引擎身份（非空则信任，空则不归任何人）。 */
function applyLedgerIdentity(events: UsageEvent[], home: string, read: (path: string) => string | null): UsageEvent[] {
  const ledgerRows: UsageEvent[] = []
  for (const p of [userUsagePath(home), sideUsagePath(home)]) {
    if (!realFile(p)) continue
    for (const row of parseMeter(read(p) || '')) {
      if (row.total > 0) ledgerRows.push(row)
    }
  }
  if (ledgerRows.length === 0) return events
  const ledgerFps = new Set(ledgerRows.map(eventFingerprint))
  const sessionUser = new Map<string, string>()
  for (const row of ledgerRows) {
    if (!row.sessionId || !row.userId) continue
    const key = row.sessionId.replace(/^session-/, '')
    if (!sessionUser.has(key)) sessionUser.set(key, row.userId)
  }
  for (const evt of events) {
    if (ledgerFps.has(eventFingerprint(evt))) continue
    if (evt.sessionId && sessionUser.has(evt.sessionId)) {
      evt.userId = sessionUser.get(evt.sessionId)!
    }
  }
  return events
}

function namesOf(bundle: EngineBundle): Map<string, string> {
  const names = new Map<string, string>()
  for (const user of bundle.users) {
    const name = user.displayName || user.username || ''
    if (user.id && name) names.set(user.id, name)
  }
  if (bundle.active?.id && bundle.active.displayName && !names.has(bundle.active.id)) {
    names.set(bundle.active.id, bundle.active.displayName)
  }
  return names
}

function memberDetail(row: UsageDetailRow): UsageDetailRow {
  return {
    ts: row.ts,
    provider: row.provider,
    model: row.model,
    source: row.source,
    lane: row.lane,
    tokens: row.tokens,
    task: row.task,
  }
}

/** 同一用户出现两把不同的后四位时不猜是哪一把。 */
export function tailsByUser(assigned: Array<{ assigneeUserId?: string, tail?: string }>): Map<string, string> {
  const found = new Map<string, string[]>()
  for (const row of assigned) {
    const id = String(row.assigneeUserId || '').trim()
    const tail = String(row.tail || '').trim()
    if (!id || !tail || tail.length > 8) continue
    const list = found.get(id) || []
    if (!list.includes(tail)) list.push(tail)
    found.set(id, list)
  }
  const out = new Map<string, string>()
  for (const [id, tails] of found) {
    if (tails.length === 1) out.set(id, tails[0])
  }
  return out
}

/** 任务名：没有就用 lane 中文映射 + sessionId 缩写。 */
const LANE_NAMES: Record<string, string> = {
  dsh_chat: '对话',
  dsh_title: '标题生成',
  dsh_memory: '记忆写入',
  dsh_search: '网页搜索',
  dsh_cursor: '写码',
  dev_pipeline_prd: '开发流水线',
  dev_pipeline_prg: '开发流水线',
  dev_pipeline_review: '开发流水线',
  dev_pipeline_merge: '开发流水线',
  dev_pipeline_commit: '开发流水线',
  code_review: '代码审查',
  code_commit: '代码提交',
  code_refactor: '代码重构',
  code_test: '代码测试',
}
function readableTask(row: { task?: string, lane?: string, sessionId?: string, source?: string }): string {
  const t = (row.task || '').trim()
  if (t) return t
  const sid = (row.sessionId || '').replace(/^session-/, '')
  const shortSid = sid ? sid.slice(0, 8) : ''
  // 有 sessionId 但没标题 → 统一用 "会话（sid前8位）"
  if (shortSid) return `会话 ${shortSid}`
  // 没 sessionId 时用 lane 可读映射
  const lane = (row.lane || '').trim()
  const sname = LANE_NAMES[lane] || (lane ? lane.replace(/^dsh_/, '').replace(/_/g, ' ') : '')
  if (sname) return sname
  return row.source === 'cursor' ? '写码' : '对话'
}

export function keyTailForCall(provider: string, userId: string, tails: ReadonlyMap<string, string>): string {
  if (!userId || !/deepseek/i.test(provider)) return ''
  return tails.get(userId) || ''
}

/** 只写入后四位。调用方传入的密文、keyId 不会出现在结果里。 */
export function stampKeyTails(
  rows: UsageDetailRow[],
  assigned: Array<{ assigneeUserId?: string, tail?: string }>,
): UsageDetailRow[] {
  const tails = tailsByUser(assigned)
  return rows.map((row) => ({
    ...row,
    keyTail: keyTailForCall(row.provider, row.userId || '', tails),
  }))
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
  const names = namesOf(bundle)
  usage.detail = viewerAdmin
    ? usage.detail.map((row) => ({
      ...row,
      userId: row.userId || '',
      userName: names.get(row.userId || '') || '',
      task: readableTask(row),
    }))
    : usage.detail.map((row) => ({
      ...memberDetail(row),
      task: readableTask(row),
    }))
  const from = query.grain === 'month' ? usage.month_from : usage.on
  const to = query.grain === 'month' ? usage.month_to : usage.on
  const people = scope === 'enterprise' ? peopleUsage(bundle.events, bundle.users, from, to) : null
  return { usage, people, viewerAdmin, scope, loaded: bundle.events.length > 0 }
}
