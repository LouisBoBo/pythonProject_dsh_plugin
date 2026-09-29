/**
 * 确认卡闸门：begin 只出确认卡；用户点确认后才创建 Job。
 * 权威在 DSH 会话节点（call_id）；本表只给「execute 尚未返回」时对账用，不自管聊天会话。
 * 落盘：宿主工具创建 pending，子进程 HTTP 确认时可同读。
 */
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { readJsonFile, storeDir, withFileLock, writeJsonAtomic } from './diskStore.js'

export type PendingConfirm = {
  id: string
  workspace: string
  requirement: string
  parent_job_id?: string
  /** DSH tool/call id，刷新后仍在同一张卡上 */
  call_id?: string
  /** DSH 会话 id，无 call_id 时的次级隔离 */
  session_id?: string
  created_at: number
  /** claiming 开始时间；进程崩溃后超时回 waiting，避免确认卡永久锁死 */
  claiming_at?: number
  job_id?: string
  status: 'waiting' | 'claiming' | 'started' | 'cancelled'
}

type PendingDisk = Record<string, PendingConfirm>

function storePath(): string {
  return join(storeDir('state'), 'pending-confirms.json')
}

function lockPath(): string {
  return storePath() + '.lock'
}

const CLAIM_STALE_MS = 120_000
const WAITING_TTL_MS = 7 * 86_400_000
const DONE_TTL_MS = 2 * 86_400_000

function healStale(map: PendingDisk): void {
  const now = Date.now()
  for (const [k, row] of Object.entries(map)) {
    if (!row) {
      delete map[k]
      continue
    }
    if (row.status === 'claiming') {
      const at = Number(row.claiming_at || 0)
      if (!at || now - at > CLAIM_STALE_MS) {
        row.status = 'waiting'
        delete row.claiming_at
      }
    }
    const created = Number(row.created_at || 0)
    if (!created) continue
    if (row.status === 'waiting' && now - created > WAITING_TTL_MS) delete map[k]
    if ((row.status === 'started' || row.status === 'cancelled') && now - created > DONE_TTL_MS) {
      delete map[k]
    }
  }
}

function mutate<T>(fn: (map: PendingDisk) => T): T {
  return withFileLock(lockPath(), () => {
    const map = readJsonFile<PendingDisk>(storePath(), {})
    healStale(map)
    const out = fn(map)
    writeJsonAtomic(storePath(), map)
    return out
  })
}

function readAll(): PendingDisk {
  const map = readJsonFile<PendingDisk>(storePath(), {})
  healStale(map)
  return map
}

export function createPendingConfirm(opts: {
  workspace: string
  requirement: string
  parent_job_id?: string
  call_id?: string
  session_id?: string
}): PendingConfirm {
  const id = 'pcf-' + randomBytes(10).toString('hex')
  const row: PendingConfirm = {
    id,
    workspace: String(opts.workspace || '').trim(),
    requirement: String(opts.requirement || '').trim(),
    created_at: Date.now(),
    status: 'waiting',
  }
  if (opts.parent_job_id) row.parent_job_id = String(opts.parent_job_id).trim()
  if (opts.call_id) row.call_id = String(opts.call_id).trim()
  if (opts.session_id) row.session_id = String(opts.session_id).trim()
  mutate((map) => {
    map[id] = row
  })
  return row
}

export function loadPendingConfirm(id: string): PendingConfirm | null {
  const row = readAll()[String(id || '').trim()]
  return row || null
}

/**
 * 原子认领：waiting → claiming，只成功一次。
 * 已 claiming/started 时返回当前行（含已有 job_id），调用方勿再 createJob。
 */
export function claimPendingConfirm(id: string): {
  ok: boolean
  pending: PendingConfirm | null
  detail?: string
  code?: string
} {
  return mutate((map) => {
    const row = map[String(id || '').trim()]
    if (!row || row.status === 'cancelled') {
      return { ok: false, pending: null, detail: '确认令牌无效', code: 'pending_invalid' }
    }
    if (row.status === 'started' || row.status === 'claiming') {
      return { ok: false, pending: { ...row }, detail: '该确认已开工或正在开工', code: 'pending_already' }
    }
    if (row.status !== 'waiting') {
      return { ok: false, pending: { ...row }, detail: '确认状态异常', code: 'pending_bad_status' }
    }
    row.status = 'claiming'
    row.claiming_at = Date.now()
    map[row.id] = row
    return { ok: true, pending: { ...row } }
  })
}

/** 认领失败回滚（createJob 前失败时） */
export function releasePendingClaim(id: string): void {
  mutate((map) => {
    const row = map[String(id || '').trim()]
    if (!row || row.status !== 'claiming') return
    row.status = 'waiting'
    delete row.claiming_at
    map[row.id] = row
  })
}

export function bindPendingJob(id: string, jobId: string): PendingConfirm | null {
  return mutate((map) => {
    const row = map[String(id || '').trim()]
    if (!row) return null
    row.job_id = String(jobId || '').trim()
    row.status = 'started'
    delete row.claiming_at
    map[row.id] = row
    return { ...row }
  })
}

/** 按 DSH 工具调用节点取确认单（含已开工：同一张卡刷新后对账） */
export function findPendingForCall(callId: string): PendingConfirm | null {
  const id = String(callId || '').trim()
  if (!id) return null
  let best: PendingConfirm | null = null
  for (const row of Object.values(readAll())) {
    if (row.call_id !== id) continue
    if (row.status === 'cancelled') continue
    if (!best || row.created_at > best.created_at) best = row
  }
  return best ? { ...best } : null
}

/**
 * 确认卡轮询：只认「当前这张卡」。
 * - 有 call_id：精确匹配（可已开工）
 * - 无 call_id：必须同时带 session_id + requirement，且只返回 waiting
 * - 禁止仅 workspace 兜底（防本机 CSRF 偷 confirm_token）
 */
export function findPendingForCard(opts: {
  workspace: string
  call_id?: string
  session_id?: string
  requirement?: string
}): PendingConfirm | null {
  const callId = String(opts.call_id || '').trim()
  if (callId) return findPendingForCall(callId)

  const ws = String(opts.workspace || '').trim()
  const req = String(opts.requirement || '').trim()
  const sid = String(opts.session_id || '').trim()
  if (!ws || !req || !sid) return null

  let best: PendingConfirm | null = null
  for (const row of Object.values(readAll())) {
    if (row.workspace !== ws) continue
    if (row.status !== 'waiting') continue
    if (row.requirement !== req) continue
    if (!row.session_id || row.session_id !== sid) continue
    if (!best || row.created_at > best.created_at) best = row
  }
  return best ? { ...best } : null
}

export function cancelPendingConfirm(id: string): void {
  mutate((map) => {
    const row = map[String(id || '').trim()]
    if (!row) return
    row.status = 'cancelled'
    map[row.id] = row
  })
}

/** 测试用 */
export function _resetPendingConfirmForTests(): void {
  mutate((map) => {
    for (const k of Object.keys(map)) delete map[k]
  })
}
