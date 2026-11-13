import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { loadConfig } from './config.js'
import { formatChatConclusion } from './conclusion.js'
import type { CursorCodingJob, JobStatus, StreamEvent } from './types.js'
import { cancelUserChoice } from './userChoice.js'

const JOB_ENDED: JobStatus[] = ['succeeded', 'failed', 'cancelled', 'blocked_no_runner']

function jobsDir(): string {
  const cfg = loadConfig()
  const dir = join(cfg.dataRoot, 'jobs')
  mkdirSync(dir, { recursive: true })
  return dir
}

function jobPath(id: string): string {
  return join(jobsDir(), `${id}.json`)
}

type JobChangeListener = (jobId: string, status: JobStatus) => void
const jobChangeListeners = new Set<JobChangeListener>()

/** SSE 订阅账本写入：终态必须立刻推封口帧，不能等 400ms 轮询。 */
export function onJobChange(fn: JobChangeListener): () => void {
  jobChangeListeners.add(fn)
  return () => {
    jobChangeListeners.delete(fn)
  }
}

function emitJobChange(job: CursorCodingJob): void {
  for (const fn of jobChangeListeners) {
    try {
      fn(job.id, job.status)
    } catch {
      /* 监听失败不得打断落盘 */
    }
  }
}

export function newJobId(): string {
  const d = new Date()
  const stamp = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
    '-',
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0'),
    String(d.getSeconds()).padStart(2, '0'),
  ].join('')
  return `cch-${stamp}-${randomBytes(2).toString('hex')}`
}

function migrateJob(raw: CursorCodingJob): CursorCodingJob {
  return {
    ...raw,
    parent_job_id: raw.parent_job_id ?? null,
    dsh_session_id: raw.dsh_session_id ?? null,
    dsh_call_id: raw.dsh_call_id ?? null,
    images: Array.isArray(raw.images) ? raw.images : undefined,
    deleted_files: raw.deleted_files || [],
    deferred_files: raw.deferred_files || [],
    synced_files: raw.synced_files || [],
    last_synced_files: raw.last_synced_files || raw.synced_files || [],
    write_scope: raw.write_scope || [],
    sandbox_path: raw.sandbox_path ?? null,
    sandbox_skipped_files: raw.sandbox_skipped_files || [],
    agent_id: raw.agent_id ?? null,
    run_id: raw.run_id ?? null,
    continue_count: raw.continue_count ?? 0,
    conclusion_delivered: Boolean(raw.conclusion_delivered),
    conclusion_at: raw.conclusion_at ?? null,
    assistant_text: raw.assistant_text || '',
    thinking_text: raw.thinking_text || '',
    transcript: Array.isArray(raw.transcript) ? raw.transcript : [],
    review_in_scope: raw.review_in_scope || [],
    review_deleted: raw.review_deleted || [],
    review_deferred: raw.review_deferred || [],
    review_gate: raw.review_gate ?? null,
    events: raw.events || [],
    work_kind: raw.work_kind === 'ops' || raw.work_kind === 'code' ? raw.work_kind : undefined,
  }
}

export function loadJob(id: string): CursorCodingJob | null {
  const path = jobPath(String(id || '').trim())
  if (!existsSync(path)) return null
  try {
    return migrateJob(JSON.parse(readFileSync(path, 'utf8')) as CursorCodingJob)
  } catch {
    return null
  }
}

export function saveJob(job: CursorCodingJob): CursorCodingJob {
  job.updated_at = new Date().toISOString()
  // 运行中用紧凑 JSON：thinking/tool 高频落盘时 pretty 会拖慢 SSE 体感
  const pretty = job.status !== 'running' && job.status !== 'queued'
  writeFileSync(
    jobPath(job.id),
    (pretty ? JSON.stringify(job, null, 2) : JSON.stringify(job)) + '\n',
    'utf8',
  )
  emitJobChange(job)
  return job
}

/** 进度卡对账用：不含 events，避免大 JSON 拖死 fetch。 */
export function jobCardView(job: CursorCodingJob): Record<string, unknown> {
  return {
    id: job.id,
    status: job.status,
    detail: job.detail,
    workspace: job.workspace,
    requirement: job.requirement,
    work_kind: job.work_kind === 'ops' ? 'ops' : 'code',
    transcript: job.transcript || [],
    review_in_scope: job.review_in_scope || [],
    review_deleted: job.review_deleted || [],
    review_deferred: job.review_deferred || [],
    review_gate: job.review_gate ?? null,
    synced_files: job.synced_files || [],
    backend_restart: job.backend_restart || null,
    backend_restart_hint: job.backend_restart_hint || null,
    pending_user_choice: job.pending_user_choice || null,
    updated_at: job.updated_at,
    chat_conclusion: formatChatConclusion(job),
  }
}

export function appendEvent(
  job: CursorCodingJob,
  ev: Omit<StreamEvent, 'at'> & { at?: string },
): CursorCodingJob {
  const full: StreamEvent = {
    ...ev,
    at: ev.at || new Date().toISOString(),
  }
  job.events.push(full)
  if (job.events.length > 500) {
    job.events = job.events.slice(-400)
  }
  return saveJob(job)
}

export function setStatus(job: CursorCodingJob, status: JobStatus, detail?: string): CursorCodingJob {
  // 终态不可改写：succeeded/failed 后再写 running 会把进度卡钉死在「写码中」
  if (JOB_ENDED.includes(job.status) && job.status !== status) {
    return loadJob(job.id) || job
  }
  job.status = status
  if (detail !== undefined) job.detail = detail
  appendEvent(job, { type: 'status', status, message: detail || status })
  const saved = saveJob(job)

  // 审计日志：终态变化时追加一行 JSON（机器可读，用于运营回溯）
  if (JOB_ENDED.includes(status)) {
    tryWriteAudit(saved, status)
  }

  return saved
}

/** 审计日志：job 终态时写一行 JSONL */
function tryWriteAudit(job: CursorCodingJob, status: JobStatus): void {
  try {
    const cfg = loadConfig()
    const auditPath = join(cfg.dataRoot, 'audit.jsonl')
    const created = new Date(job.created_at).getTime()
    const updated = new Date(job.updated_at).getTime()
    const durationMs = updated > created ? updated - created : 0
    const qualityReport = job.quality_report
    const syncedCount = Array.isArray(job.last_synced_files)
      ? job.last_synced_files.length
      : Array.isArray(job.synced_files)
        ? job.synced_files.length
        : 0
    const entry = {
      ts: new Date().toISOString(),
      job_id: job.id,
      status,
      workspace: job.workspace,
      requirement_len: (job.requirement || '').length,
      parent_job_id: job.parent_job_id || null,
      agent_id: job.agent_id || null,
      duration_ms: durationMs,
      quality_score: qualityReport?.score ?? null,
      quality_status: qualityReport?.status ?? null,
      verify_ok: job.verify_ok ?? null,
      delivery_audit_ok: job.delivery_audit ? job.delivery_audit.ok : null,
      synced_files: syncedCount,
      changed_files: job.changed_files?.length ?? 0,
      deleted_files: job.deleted_files?.length ?? 0,
      continue_count: job.continue_count ?? 0,
      reason: detailForAudit(status, job.detail),
    }
    const line = JSON.stringify(entry) + '\n'
    const fs = require('node:fs') as typeof import('node:fs')
    fs.appendFileSync(auditPath, line, 'utf8')
  } catch {
    /* 审计日志失败不得影响主流程 */
  }
}

function detailForAudit(status: JobStatus, detail?: string): string {
  if (!detail) return status
  const trimmed = detail.replace(/\s+/g, ' ').trim()
  return trimmed.length > 200 ? trimmed.slice(0, 200) + '…' : trimmed
}

export function createJob(input: {
  workspace: string
  requirement: string
  images?: import('./images.js').ChatImageRef[]
  parent_job_id?: string | null
  dsh_session_id?: string | null
  dsh_call_id?: string | null
  write_scope?: string[]
  continue_count?: number
  work_kind?: 'code' | 'ops'
}): CursorCodingJob {
  const now = new Date().toISOString()
  const workKind = input.work_kind === 'ops' ? 'ops' : 'code'
  const job: CursorCodingJob = {
    id: newJobId(),
    status: 'queued',
    workspace: String(input.workspace || '').trim(),
    requirement: String(input.requirement || '').trim(),
    work_kind: workKind,
    images: input.images && input.images.length ? input.images.slice(0, 8) : undefined,
    parent_job_id: input.parent_job_id ? String(input.parent_job_id).trim() : null,
    dsh_session_id: input.dsh_session_id ? String(input.dsh_session_id).trim() : null,
    dsh_call_id: input.dsh_call_id ? String(input.dsh_call_id).trim() : null,
    created_at: now,
    updated_at: now,
    detail: workKind === 'ops' ? '已开工，直接在项目终端处理，不改代码' : '已入队',
    events: [],
    changed_files: [],
    deleted_files: [],
    deferred_files: [],
    synced_files: [],
    last_synced_files: [],
    write_scope: input.write_scope || [],
    sandbox_path: null,
    sandbox_skipped_files: [],
    agent_id: null,
    run_id: null,
    continue_count: input.continue_count ?? 0,
    conclusion_delivered: false,
    conclusion_at: null,
    assistant_text: '',
    thinking_text: '',
    transcript: [],
    review_in_scope: [],
    review_deleted: [],
    review_deferred: [],
    review_gate: null,
    cancelled: false,
  }
  saveJob(job)
  appendEvent(job, {
    type: 'status',
    status: 'queued',
    message: workKind === 'ops' ? '已开工，直接在项目终端处理，不改代码' : '已入队',
  })
  return loadJob(job.id)!
}

export function listJobs(limit = 20): CursorCodingJob[] {
  const dir = jobsDir()
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse()
  const out: CursorCodingJob[] = []
  for (const f of files.slice(0, Math.max(1, limit))) {
    try {
      out.push(migrateJob(JSON.parse(readFileSync(join(dir, f), 'utf8')) as CursorCodingJob))
    } catch {
      /* skip */
    }
  }
  return out
}

export function jobSummary(job: CursorCodingJob): string {
  return `${job.id}｜${job.status}｜${job.workspace || '（无路径）'}｜${job.detail || ''}`
}

export function findLatestJobForSession(opts: {
  workspace: string
  session_id?: string
  statuses?: JobStatus[]
  /**
   * 无 session_id 时是否退回「同工作区任意成功 Job」。
   * 续改默认 false（禁止按工作区抢别人的会话）；仅兼容排查可开。
   */
  allowWorkspaceFallback?: boolean
}): CursorCodingJob | null {
  const ws = String(opts.workspace || '').trim()
  if (!ws) return null
  const sid = String(opts.session_id || '').trim()
  const statuses = opts.statuses && opts.statuses.length ? opts.statuses : (['succeeded'] as JobStatus[])
  const ok = (j: CursorCodingJob) => j.workspace === ws && statuses.includes(j.status)
  const jobs = listJobs(80)
  if (sid) {
    return jobs.find((j) => ok(j) && j.dsh_session_id === sid) || null
  }
  if (opts.allowWorkspaceFallback) {
    return jobs.find(ok) || null
  }
  return null
}

/** @deprecated 排查用；续改请用带 session_id 的 findLatestJobForSession */
export function findLatestSucceeded(workspace: string): CursorCodingJob | null {
  return findLatestJobForSession({ workspace, allowWorkspaceFallback: true })
}

/** begin 阻塞未返回时，进度卡用 DSH callId 对账本机 Job */
export function findLatestJobByCallId(callId: string): CursorCodingJob | null {
  const id = String(callId || '').trim()
  if (!id) return null
  return listJobs(40).find((j) => String(j.dsh_call_id || '').trim() === id) || null
}

/** 按 DSH 会话取最近已交付结论的写码任务（重开会话按轮次挂载；新→旧） */
export function listConcludedJobsBySessionId(sessionId: string, limit = 20): CursorCodingJob[] {
  const sid = String(sessionId || '').trim()
  if (!sid) return []
  return listJobs(80)
    .filter(
      (j) =>
        String(j.dsh_session_id || '').trim() === sid &&
        j.conclusion_delivered === true &&
        (j.status === 'succeeded' || j.status === 'failed' || j.status === 'cancelled'),
    )
    .slice(0, Math.max(1, limit))
}

export function patchJob(id: string, patch: Partial<CursorCodingJob>): CursorCodingJob | null {
  const job = loadJob(id)
  if (!job) return null
  Object.assign(job, patch)
  return saveJob(job)
}

function sealedTranscript(job: CursorCodingJob): CursorCodingJob['transcript'] {
  return (job.transcript || []).map((it) => (it.streaming ? { ...it, streaming: false } : it))
}

/**
 * 用户取消：立刻终态。封住思考流，通知 SSE。
 * - 进行中（queued/running/pending_review/syncing）：cancelled=true + status=cancelled + done
 * - 已终态 succeeded/failed/blocked：只封流并推 done 停转，**不得**再写 cancelled=true
 *   （否则成功任务被标成取消，续改/编排会误判）
 * - 已 status=cancelled 但 cancelled 标志仍为 false：补写 cancelled=true（历史竞态修复）
 */
export function forceCancelJob(id: string): CursorCodingJob | null {
  const job = loadJob(String(id || '').trim())
  if (!job) return null

  if (JOB_ENDED.includes(job.status)) {
    const patch: Partial<CursorCodingJob> = { transcript: sealedTranscript(job) }
    // 仅补取消标志；禁止把 succeeded/failed 改写成取消
    if (job.status === 'cancelled' && !job.cancelled) {
      patch.cancelled = true
    }
    patchJob(job.id, patch)
    const cur = loadJob(job.id)!
    appendEvent(cur, { type: 'done', status: cur.status, message: '用户取消（封口）' })
    return loadJob(job.id)
  }

  cancelUserChoice(job.id, '用户取消')
  patchJob(job.id, {
    cancelled: true,
    transcript: sealedTranscript(job),
    pending_user_choice: null,
  })
  const cur = loadJob(job.id)!
  setStatus(cur, 'cancelled', '用户取消')
  appendEvent(loadJob(job.id)!, { type: 'done', status: 'cancelled', message: '用户取消' })
  return loadJob(job.id)
}

/**
 * 宿主点「停止」会 abort 工具 AbortSignal。立刻 forceCancel，避免只在 sleep 循环顶部检查时漏掉。
 * 返回解绑函数；wait/poll 结束时务必调用。
 */
export function bindAbortToForceCancel(jobId: string, signal?: AbortSignal): () => void {
  const id = String(jobId || '').trim()
  if (!id || !signal) return () => {}
  const onAbort = () => {
    forceCancelJob(id)
  }
  if (signal.aborted) {
    onAbort()
    return () => {}
  }
  signal.addEventListener('abort', onAbort, { once: true })
  return () => {
    signal.removeEventListener('abort', onAbort)
  }
}
