import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { sideUsagePath } from './side-usage.js'
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
        provider: String(raw.provider || ''),
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
    events: mergeSessions(withMeter, auth.active?.id || '', env, home, ledgerTs),
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

/** 引擎尚未收进 usage 账本的 meter 行，加上标题生成和网页搜索的供应商用量。归当前登录人。 */
function mergeMeter(
  events: UsageEvent[],
  activeId: string,
  env: NodeJS.ProcessEnv,
  home: string,
  read: (path: string) => string | null,
): UsageEvent[] {
  const known = new Set(events.map((evt) => evt.jobId).filter(Boolean))
  const seen = new Set(events.map(eventFingerprint))
  const extra: UsageEvent[] = []
  const take = (row: UsageEvent, dedupeFingerprint: boolean) => {
    if (!row.jobId || known.has(row.jobId)) return
    const fp = eventFingerprint(row)
    if (dedupeFingerprint && seen.has(fp)) return
    known.add(row.jobId)
    seen.add(fp)
    extra.push({ ...row, userId: row.userId || activeId })
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
      })
    } catch {
      // 坏行跳过
    }
  }
  return rows.filter((row) => row.ts)
}

function sessionRoot(env: NodeJS.ProcessEnv, home: string): string {
  const candidates: string[] = []
  const local = (env.LOCALAPPDATA || '').trim()
  if (local) candidates.push(join(local, 'ZR_DSH', 'dsh-home', 'sessions'))
  candidates.push(join(home, 'AppData', 'Local', 'ZR_DSH', 'dsh-home', 'sessions'))
  for (const path of candidates) {
    if (existsSync(path)) return path
  }
  return ''
}

function shanghaiIso(ms: number): string {
  const sh = new Date(ms + 8 * 60 * 60 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${sh.getUTCFullYear()}-${p(sh.getUTCMonth() + 1)}-${p(sh.getUTCDate())}T${p(sh.getUTCHours())}:${p(sh.getUTCMinutes())}:${p(sh.getUTCSeconds())}+08:00`
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

function mergeSessions(events: UsageEvent[], activeId: string, env: NodeJS.ProcessEnv, home: string, afterTs: string): UsageEvent[] {
  const root = sessionRoot(env, home)
  if (!root || !existsSync(root)) return events
  const known = new Set(events.map((evt) => evt.jobId).filter(Boolean))
  const fingerprints = new Set(events
    .filter((evt) => evt.lane !== 'dsh_title' && evt.lane !== 'dsh_search')
    .map((evt) => `${evt.ts.slice(0, 19)}|${evt.model}|${evt.total}|${evt.prompt}|${evt.completion}`))
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
        text = sessionText(readFileSync(file))
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
