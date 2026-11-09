/**
 * 对话写码 SDK usage → 本机用量账 events.jsonl（source=cursor）。
 *
 * 只写 Cursor SDK 给出的 token；没有 usage 或合计为 0 不落盘、不编造。
 * 与 dsh-key-quota 写码卡同账本；不碰 LLM / 网关路径。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type SdkTokenUsage = {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  totalTokens?: number
  reasoningTokens?: number
}

export type CursorSdkLedgerRow = {
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
  quality: 'sdk'
  ok: true
  job_id: string
  error_class: string
  user_id: string
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

function shanghaiIso(ms = Date.now()): string {
  return new Date(ms + 8 * 60 * 60 * 1000).toISOString().slice(0, 19) + '+08:00'
}

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
    try { key = realpathSync(path) } catch { /* keep */ }
    if (seen.has(key)) continue
    seen.add(key)
    out.push(path)
  }
  return out
}

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
      // 试下一处
    }
  }
  return []
}

function activeUserId(env: NodeJS.ProcessEnv, home: string, now = Date.now()): string {
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
      // 坏文件跳过
    }
  }
  return best
}

function sanitizeId(raw: string): string {
  return String(raw || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 80)
}

/** job 前缀 + run_id → 账本唯一 job_id（≤80）。 */
export function sanitizeLedgerKey(jobPrefix: string | undefined, runId: string): string {
  const prefix = sanitizeId(jobPrefix || 'cch')
  const run = sanitizeId(runId) || `t${Date.now().toString(36)}`
  return sanitizeId(`${prefix}-${run}`) || `cch-${Date.now()}`
}

/** 从 SDK usage 组一行。合计为 0 或没有有效 id 时返回 null。 */
export function sdkLedgerRow(opts: {
  usage: SdkTokenUsage
  jobKey: string
  model: string
  userId: string
  nowMs?: number
}): CursorSdkLedgerRow | null {
  const prompt = num(opts.usage.inputTokens)
  const completion = num(opts.usage.outputTokens)
  const cacheRead = num(opts.usage.cacheReadTokens)
  const cacheWrite = num(opts.usage.cacheWriteTokens)
  const reasoning = num(opts.usage.reasoningTokens)
  // 与 key-quota 写码账一致：分项相加；reasoning 只明细不加合计
  const total = prompt + completion + cacheRead + cacheWrite
  const jobId = sanitizeId(opts.jobKey)
  if (total <= 0 || !jobId) return null
  return {
    id: jobId,
    ts: shanghaiIso(opts.nowMs ?? Date.now()),
    source: 'cursor',
    lane: 'cursor_code',
    provider: 'cursor',
    model: String(opts.model || 'cursor').slice(0, 120),
    prompt_tokens: prompt,
    completion_tokens: completion,
    cache_read_tokens: cacheRead,
    cache_write_tokens: cacheWrite,
    reasoning_tokens: reasoning,
    total_tokens: total,
    quality: 'sdk',
    ok: true,
    job_id: jobId,
    error_class: '',
    user_id: String(opts.userId || '').replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 80),
  }
}

export function pickSdkUsage(...candidates: Array<SdkTokenUsage | null | undefined>): SdkTokenUsage | null {
  for (const raw of candidates) {
    if (!raw || typeof raw !== 'object') continue
    const prompt = num(raw.inputTokens)
    const completion = num(raw.outputTokens)
    const cacheRead = num(raw.cacheReadTokens)
    const cacheWrite = num(raw.cacheWriteTokens)
    if (prompt + completion + cacheRead + cacheWrite > 0) return raw
  }
  return null
}

/** 把一行写进本机用量账。已存在同 job_id 则跳过。失败不抛。 */
export function appendSdkUsage(opts: {
  usage: SdkTokenUsage
  jobKey: string
  model: string
  env?: NodeJS.ProcessEnv
  home?: string
  nowMs?: number
  ledgerPaths?: string[]
  userId?: string
}): { appended: number } {
  try {
    const env = opts.env ?? process.env
    const home = opts.home ?? homedir()
    const paths = opts.ledgerPaths ?? ensureLedgerFiles(env, home)
    if (paths.length === 0) return { appended: 0 }
    const userId = opts.userId ?? activeUserId(env, home, opts.nowMs ?? Date.now())
    const row = sdkLedgerRow({
      usage: opts.usage,
      jobKey: opts.jobKey,
      model: opts.model,
      userId,
      nowMs: opts.nowMs,
    })
    if (!row) return { appended: 0 }
    let appended = 0
    for (const path of paths) {
      let text = ''
      try { text = readFileSync(path, 'utf8') } catch { continue }
      if (text.includes(`"job_id":${JSON.stringify(row.job_id)}`)) continue
      appendFileSync(path, JSON.stringify(row) + '\n', 'utf8')
      appended += 1
    }
    return { appended }
  } catch {
    return { appended: 0 }
  }
}
