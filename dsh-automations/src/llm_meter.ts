import { randomBytes } from 'node:crypto'
import { appendFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'

/**
 * 自动化任务直连 chat/completions，不经过宿主 llm/stream，
 * llm-meter waterfall 看不见。补记同一本账本 ~/.dsh/llm-meter/events.jsonl。
 *
 * 硬约束（LOCKED 2026-09-17）：
 * - 不改 dsh-llm-meter/src/usage.ts、source 枚举、jsonl 字段名
 * - source 只用已有 dsh_other（禁止新增 dsh_automations）
 * - 合计：有供应商 total 用原样；否则 input+output+cacheRead+cacheWrite；reasoning 只明细
 * - 记账失败不得打断 LLM 主流程
 */

export const METER_SOURCE = 'dsh_other' as const
export const SCHEMA_VERSION = 1

export type ChatUsageBreakdown = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
  total: number
}

export type RecordChatCompletionInput = {
  usage: unknown
  provider: string
  model: string
  ok: boolean
  finish: string
  error: string
  started: number
  promptChars: number
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}

/** 只计字符数，不返回正文。 */
export function countMessageChars(messages: unknown): number {
  if (!Array.isArray(messages)) return 0
  let n = 0
  for (const msg of messages) {
    const content = asRecord(msg).content
    if (typeof content === 'string') n += content.length
  }
  return n
}

export function clipMeterError(message: unknown, max = 200): string {
  const text = String(message ?? '').replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return text.slice(0, max)
}

export function providerFromBaseUrl(base: string): string {
  try {
    const host = new URL(String(base || '').trim()).hostname
    if (/deepseek/i.test(host)) return 'deepseek'
    return host.slice(0, 80) || 'deepseek'
  } catch {
    return 'deepseek'
  }
}

/**
 * OpenAI/DeepSeek HTTP `usage` → 与 llm-meter 互斥分列 + 冻结合计口径。
 * 供应商把 cache 命中含进 prompt_tokens 时拆开，使 命中+未命中+输出 = 卡片 total。
 */
export function tokensFromChatUsage(raw: unknown): ChatUsageBreakdown | null {
  if (!raw || typeof raw !== 'object') return null
  const u = asRecord(raw)
  const detailsP = asRecord(u.prompt_tokens_details)
  const detailsC = asRecord(u.completion_tokens_details)
  let input = num(u.prompt_tokens ?? u.input_tokens ?? u.inputTokens)
  const output = num(u.completion_tokens ?? u.output_tokens ?? u.outputTokens)
  const cacheRead = num(
    u.prompt_cache_hit_tokens ?? u.cache_read_tokens ?? u.cacheReadTokens ?? detailsP.cached_tokens,
  )
  const cacheWrite = num(
    u.prompt_cache_write_tokens ?? u.cache_write_tokens ?? u.cacheWriteTokens ?? detailsP.cache_write_tokens,
  )
  const reasoning = num(u.reasoning_tokens ?? u.reasoningTokens ?? detailsC.reasoning_tokens)
  if (cacheRead > 0 && input >= cacheRead) input -= cacheRead
  const providerTotal = num(u.total_tokens ?? u.totalTokens)
  const parts = input + output + cacheRead + cacheWrite
  let total = providerTotal > 0 ? providerTotal : parts
  if (reasoning > 0 && total === parts + reasoning) total = parts
  if (parts <= 0 && reasoning <= 0 && providerTotal <= 0) return null
  return { input, output, cacheRead, cacheWrite, reasoning, total }
}

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000

export function formatTsShanghai(d: Date): string {
  return new Date(d.getTime() + SHANGHAI_OFFSET_MS).toISOString().replace('Z', '+08:00')
}

export function newMeterEventId(d = new Date()): string {
  const stamp = new Date(d.getTime() + SHANGHAI_OFFSET_MS)
    .toISOString()
    .replace(/[-:T.Z]/g, '')
    .slice(0, 14)
  return `meter_${stamp}_${randomBytes(3).toString('hex')}`
}

export function dshHome(): string {
  return process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
}

/** 只允许写在 DSH_HOME/llm-meter 下，避免被环境变量指到任意路径。 */
export function meterEventsPath(): string {
  const home = resolve(dshHome())
  const fallback = join(home, 'llm-meter', 'events.jsonl')
  const envDir = String(process.env.DSH_LLM_METER_DIR || '').trim()
  if (!envDir) return fallback
  const candidate = resolve(isAbsolute(envDir) ? envDir : join(home, envDir))
  const prefix = home.endsWith(sep) ? home : home + sep
  if (candidate === home || !candidate.startsWith(prefix)) return fallback
  return join(candidate, 'events.jsonl')
}

function buildEvent(input: RecordChatCompletionInput, now: Date): Record<string, unknown> {
  const usage = tokensFromChatUsage(input.usage)
  const duration = Math.max(0, Date.now() - input.started)
  return {
    v: SCHEMA_VERSION,
    id: newMeterEventId(now),
    ts: formatTsShanghai(now),
    source: METER_SOURCE,
    provider: String(input.provider || 'deepseek').slice(0, 80),
    model: String(input.model || '').slice(0, 120),
    session_id: '',
    ok: Boolean(input.ok),
    finish: String(input.finish || ''),
    error: clipMeterError(input.error),
    quality: usage ? 'provider' : 'missing',
    prompt_tokens: usage?.input ?? 0,
    completion_tokens: usage?.output ?? 0,
    cache_read_tokens: usage?.cacheRead ?? 0,
    cache_write_tokens: usage?.cacheWrite ?? 0,
    reasoning_tokens: usage?.reasoning ?? 0,
    total_tokens: usage?.total ?? 0,
    duration_ms: duration,
    prompt_chars: Math.max(0, Math.floor(Number(input.promptChars) || 0)),
  }
}

let chain: Promise<void> = Promise.resolve()

async function writeLine(event: Record<string, unknown>): Promise<void> {
  const filePath = meterEventsPath()
  const line = `${JSON.stringify(event)}\n`
  await mkdir(dirname(filePath), { recursive: true })
  await appendFile(filePath, line, 'utf8')
}

/** 追加一行 meter 流水。失败吞掉。 */
export function recordChatCompletion(input: RecordChatCompletionInput): Promise<void> {
  const run = async () => {
    try {
      await writeLine(buildEvent(input, new Date()))
    } catch {
      // 记账失败不得抛出
    }
  }
  chain = chain.then(run, run)
  return chain
}
