import { createHash } from 'node:crypto'
import { renameSync, writeFileSync } from 'node:fs'

export function nowSec(d = new Date()): number {
  return Math.floor(d.getTime() / 1000)
}

export function newId(prefix: string): string {
  return `${prefix}-${createHash('sha256').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 16)}`
}

export function fingerprintPrompt(prompt: string): string {
  return createHash('sha256').update(String(prompt || ''), 'utf8').digest('hex').slice(0, 16)
}

export function writeJsonAtomic(path: string, payload: unknown): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf8')
  renameSync(tmp, path)
}

export function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

export function asNumber(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function asBool(v: unknown, fallback = false): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (['1', 'true', 'yes', 'on'].includes(s)) return true
    if (['0', 'false', 'no', 'off'].includes(s)) return false
  }
  if (typeof v === 'number') return v !== 0
  return fallback
}

export function truncate(text: string, max = 16000): string {
  const s = String(text || '')
  if (s.length <= max) return s
  return s.slice(0, max - 12) + '\n…(truncated)'
}

let chain: Promise<unknown> = Promise.resolve()

export function withLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}
