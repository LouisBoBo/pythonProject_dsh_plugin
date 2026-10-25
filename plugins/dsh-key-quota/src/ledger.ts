import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type KeyRole = 'member' | 'admin'

export type KeyRow = {
  alias: string
  tail: string
  role: KeyRole
  blocked: boolean
  limitTokens: number | null
  assigneeUserId?: string
  assigneeName?: string
  /** 密文。页面和上报接口不读这个字段。 */
  sealed?: string
  months: Record<string, { used: number }>
}

export type LedgerState = {
  v: 1
  keys: Record<string, KeyRow>
}

export type ReportInput = {
  callId: string
  keyId: string
  tail: string
  period: string
  source: string
  model: string
  quality: 'provider' | 'missing'
  prompt_tokens: number
  completion_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  reasoning_tokens: number
  total_tokens: number
}

const MAX_CALLS_BYTES = 52_428_800

function emptyState(): LedgerState {
  return { v: 1, keys: {} }
}

function emptyRow(tail: string): KeyRow {
  return { alias: '', tail, role: 'member', blocked: false, limitTokens: null, months: {} }
}

export class Ledger {
  private state: LedgerState
  private callIds: Set<string>
  private queue: Promise<void> = Promise.resolve()

  constructor(readonly dir: string, private readonly maxCallsBytes = MAX_CALLS_BYTES) {
    mkdirSync(dir, { recursive: true })
    this.state = this.readState()
    this.callIds = this.readCallIds()
  }

  get(keyId: string): KeyRow | undefined {
    return this.state.keys[keyId]
  }

  used(keyId: string, period: string): number {
    return this.state.keys[keyId]?.months[period]?.used ?? 0
  }

  entries(): Array<{ keyId: string } & KeyRow> {
    return Object.entries(this.state.keys).map(([keyId, row]) => ({ keyId, ...row }))
  }

  ensure(keyId: string, tail: string, _period: string): KeyRow {
    const existing = this.state.keys[keyId]
    if (existing) {
      if (tail) existing.tail = tail
      return existing
    }
    const row = emptyRow(tail)
    this.state.keys[keyId] = row
    this.save()
    return row
  }

  async report(input: ReportInput): Promise<{ duplicate: boolean, used: number }> {
    return this.run(() => {
      this.ensure(input.keyId, input.tail, input.period)
      const usedBefore = this.used(input.keyId, input.period)
      if (this.callIds.has(input.callId)) return { duplicate: true, used: usedBefore }
      const add = input.quality === 'provider' ? Math.max(0, Math.floor(input.total_tokens) || 0) : 0
      const row = this.state.keys[input.keyId]
      const bucket = row.months[input.period] ?? { used: 0 }
      bucket.used += add
      row.months[input.period] = bucket
      this.callIds.add(input.callId)
      this.appendCall(input)
      this.save()
      return { duplicate: false, used: bucket.used }
    })
  }

  async appoint(keyId: string): Promise<{ ok: true } | { ok: false, code: 'not_found' }> {
    return this.run(() => {
      if (!this.state.keys[keyId]) return { ok: false as const, code: 'not_found' as const }
      for (const [id, row] of Object.entries(this.state.keys)) {
        row.role = id === keyId ? 'admin' : 'member'
      }
      this.save()
      return { ok: true as const }
    })
  }

  async remove(keyId: string): Promise<{ ok: true } | { ok: false, code: 'not_found' }> {
    return this.run(() => {
      if (!this.state.keys[keyId]) return { ok: false as const, code: 'not_found' as const }
      delete this.state.keys[keyId]
      this.save()
      return { ok: true as const }
    })
  }

  async assign(input: {
    keyId: string
    tail: string
    assigneeUserId: string
    assigneeName: string
    limitTokens: number | null
    sealed?: string
  }): Promise<void> {
    return this.run(() => {
      this.ensure(input.keyId, input.tail, '')
      this.applyAssignee(input.keyId, input.assigneeUserId, input.assigneeName)
      const row = this.state.keys[input.keyId]
      row.limitTokens = input.limitTokens
      if (input.sealed) row.sealed = input.sealed
      this.save()
    })
  }

  async patch(keyId: string, patch: {
    alias?: string
    blocked?: boolean
    limitTokens?: number | null
    hasLimit: boolean
    assigneeUserId?: string
    assigneeName?: string
  }): Promise<{ ok: true } | { ok: false, code: 'not_found' }> {
    return this.run(() => {
      const row = this.state.keys[keyId]
      if (!row) return { ok: false as const, code: 'not_found' as const }
      if (typeof patch.alias === 'string') row.alias = patch.alias.trim().slice(0, 40)
      if (typeof patch.blocked === 'boolean') row.blocked = patch.blocked
      if (patch.hasLimit) {
        if (patch.limitTokens == null) row.limitTokens = null
        else if (Number.isFinite(patch.limitTokens) && patch.limitTokens >= 0) row.limitTokens = Math.floor(patch.limitTokens)
      }
      if (patch.assigneeUserId) this.applyAssignee(keyId, patch.assigneeUserId, patch.assigneeName || '')
      this.save()
      return { ok: true as const }
    })
  }

  private applyAssignee(keyId: string, assigneeUserId: string, assigneeName: string): void {
    for (const [id, other] of Object.entries(this.state.keys)) {
      if (id !== keyId && other.assigneeUserId === assigneeUserId) {
        other.assigneeUserId = ''
        other.assigneeName = ''
      }
    }
    const row = this.state.keys[keyId]
    row.assigneeUserId = assigneeUserId
    row.assigneeName = assigneeName
  }

  private run<T>(fn: () => T): Promise<T> {
    const next = this.queue.then(fn, fn)
    this.queue = next.then(() => undefined, () => undefined)
    return next
  }

  private statePath(): string {
    return join(this.dir, 'state.json')
  }

  private callsPath(): string {
    return join(this.dir, 'calls.jsonl')
  }

  private readState(): LedgerState {
    try {
      const parsed = JSON.parse(readFileSync(this.statePath(), 'utf8')) as LedgerState
      if (!parsed || parsed.v !== 1 || !parsed.keys || typeof parsed.keys !== 'object') return emptyState()
      return parsed
    } catch {
      return emptyState()
    }
  }

  private readCallIds(): Set<string> {
    const ids = new Set<string>()
    if (!existsSync(this.callsPath())) return ids
    const text = readFileSync(this.callsPath(), 'utf8')
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        const row = JSON.parse(line) as { callId?: string }
        if (row.callId) ids.add(row.callId)
      } catch {
        // 坏行跳过，不打断账本加载
      }
    }
    return ids
  }

  private save(): void {
    const path = this.statePath()
    const tmp = `${path}.tmp`
    writeFileSync(tmp, JSON.stringify(this.state, null, 2))
    renameSync(tmp, path)
  }

  private appendCall(input: ReportInput): void {
    const path = this.callsPath()
    try {
      if (existsSync(path) && statSync(path).size > this.maxCallsBytes) {
        renameSync(path, `${path}.${Date.now()}`)
      }
    } catch {
      // 轮转失败仍尝试追加
    }
    const line = `${JSON.stringify({ v: 1, ...input })}\n`
    appendFileSync(path, line, 'utf8')
  }
}
