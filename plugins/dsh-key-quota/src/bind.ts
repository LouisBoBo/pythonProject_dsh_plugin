import { keyIdOf, tailOf } from './key-id.js'

export type AssignedRow = {
  keyId: string
  tail: string
  assigneeUserId?: string
  sealed?: string
}

export type AssignedKey = {
  ok: true
  apiKey: string
  keyId: string
  tail: string
} | {
  ok: false
  code: 'not_signed_in' | 'key_unassigned' | 'key_ambiguous'
}

/** 只认平台用户 id。对不上、对上多把、密文打不开，都不返回 Key。 */
export function resolveAssignedKey(input: {
  viewerId: string
  rows: AssignedRow[]
  open: (sealed: string) => string | null
}): AssignedKey {
  const viewerId = input.viewerId.trim()
  if (!viewerId) return { ok: false, code: 'not_signed_in' }
  const mine = input.rows.filter((row) => row.assigneeUserId === viewerId)
  if (mine.length === 0) return { ok: false, code: 'key_unassigned' }
  if (mine.length > 1) return { ok: false, code: 'key_ambiguous' }
  const row = mine[0]
  if (!row.sealed) return { ok: false, code: 'key_unassigned' }
  const apiKey = input.open(row.sealed)
  if (!apiKey) return { ok: false, code: 'key_unassigned' }
  if (keyIdOf(apiKey) !== row.keyId) return { ok: false, code: 'key_unassigned' }
  if (row.tail && tailOf(apiKey) !== row.tail) return { ok: false, code: 'key_unassigned' }
  return { ok: true, apiKey, keyId: row.keyId, tail: row.tail }
}

export function assignDenyMessage(code: 'not_signed_in' | 'key_unassigned' | 'key_ambiguous'): string {
  if (code === 'not_signed_in') return '还没有平台登录，本次调用不发出。'
  if (code === 'key_ambiguous') return '当前账号对上了多把 Key，本次调用不发出。'
  return '当前账号还没有可用的 Key。请管理员在 Key 管理里重新保存。'
}

/**
 * 账本里还没有分给任何平台账号的 Key 时，不拦截官方路线。
 * 宿主继续用系统配置里的 Key。一旦有人被分配，未分配账号仍拒绝。
 */
export function hasAssignee(rows: readonly { assigneeUserId?: string }[]): boolean {
  return rows.some((row) => typeof row.assigneeUserId === 'string' && row.assigneeUserId.trim().length > 0)
}

/** 官方 API Key 路线才换 Key。账号登录路线保持原样。 */
export function usesDeepseekApiKey(options: unknown): boolean {
  const provider = options && typeof options === 'object' ? (options as { provider?: unknown }).provider : undefined
  if (typeof provider !== 'string' || !provider.trim()) return false
  if (/account/i.test(provider)) return false
  return /deepseek/i.test(provider)
}
