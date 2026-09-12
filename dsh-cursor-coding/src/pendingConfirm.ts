/**
 * 确认卡闸门：begin 只出确认卡；用户点确认后才创建 Job。
 * finish(confirm_token) 阻塞等待确认 + 写码结束。
 */
import { randomBytes } from 'node:crypto'

export type PendingConfirm = {
  id: string
  workspace: string
  requirement: string
  parent_job_id?: string
  created_at: number
  job_id?: string
  status: 'waiting' | 'started' | 'cancelled'
}

const STORE = new Map<string, PendingConfirm>()

export function createPendingConfirm(opts: {
  workspace: string
  requirement: string
  parent_job_id?: string
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
  STORE.set(id, row)
  return row
}

export function loadPendingConfirm(id: string): PendingConfirm | null {
  const row = STORE.get(String(id || '').trim())
  return row || null
}

export function bindPendingJob(id: string, jobId: string): PendingConfirm | null {
  const row = STORE.get(String(id || '').trim())
  if (!row) return null
  row.job_id = String(jobId || '').trim()
  row.status = 'started'
  STORE.set(row.id, row)
  return row
}

/** 按工作区取最近一条待确认/已开工的确认单（finish 可不传 token） */
export function findLatestPendingForWorkspace(workspace: string): PendingConfirm | null {
  const ws = String(workspace || '').trim()
  if (!ws) return null
  let best: PendingConfirm | null = null
  for (const row of STORE.values()) {
    if (row.workspace !== ws) continue
    if (row.status === 'cancelled') continue
    if (!best || row.created_at > best.created_at) best = row
  }
  return best
}

export function cancelPendingConfirm(id: string): void {
  const row = STORE.get(String(id || '').trim())
  if (!row) return
  row.status = 'cancelled'
  STORE.set(row.id, row)
}

/** 测试用 */
export function _resetPendingConfirmForTests(): void {
  STORE.clear()
}
