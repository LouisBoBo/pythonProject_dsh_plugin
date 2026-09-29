import { randomBytes } from 'node:crypto'
import type { CallMeta } from './classify.js'
import type { TokenBreakdown } from './usage.js'

export const SCHEMA_VERSION = 1

export type MeterEvent = {
  v: typeof SCHEMA_VERSION
  id: string
  ts: string
  source: CallMeta['source']
  provider: string
  model: string
  session_id: string
  ok: boolean
  finish: string
  error: string
  quality: 'provider' | 'missing'
  prompt_tokens: number
  completion_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  reasoning_tokens: number
  total_tokens: number
  duration_ms: number
  prompt_chars: number
}

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000

export function formatTsShanghai(d: Date): string {
  return new Date(d.getTime() + SHANGHAI_OFFSET_MS).toISOString().replace('Z', '+08:00')
}

export function newEventId(d = new Date()): string {
  const stamp = new Date(d.getTime() + SHANGHAI_OFFSET_MS)
    .toISOString()
    .replace(/[-:T.Z]/g, '')
    .slice(0, 14)
  return `meter_${stamp}_${randomBytes(3).toString('hex')}`
}

export function clipError(message: unknown, max = 200): string {
  const text = String(message ?? '').replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return text.slice(0, max)
}

export function buildEvent(input: {
  meta: CallMeta
  usage: TokenBreakdown | null
  started: number
  ended?: number
  finishKind: string
  errMsg: string
  ok: boolean
  now?: Date
}): MeterEvent {
  const now = input.now ?? new Date()
  const usage = input.usage
  const duration = Math.max(0, (input.ended ?? Date.now()) - input.started)
  return {
    v: SCHEMA_VERSION,
    id: newEventId(now),
    ts: formatTsShanghai(now),
    source: input.meta.source,
    provider: input.meta.provider,
    model: input.meta.model,
    session_id: input.meta.sessionId,
    ok: input.ok,
    finish: input.finishKind || '',
    error: clipError(input.errMsg),
    quality: usage ? 'provider' : 'missing',
    prompt_tokens: usage?.input ?? 0,
    completion_tokens: usage?.output ?? 0,
    cache_read_tokens: usage?.cacheRead ?? 0,
    cache_write_tokens: usage?.cacheWrite ?? 0,
    reasoning_tokens: usage?.reasoning ?? 0,
    total_tokens: usage?.total ?? 0,
    duration_ms: duration,
    prompt_chars: input.meta.promptChars,
  }
}
