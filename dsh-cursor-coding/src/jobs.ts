import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { loadConfig } from './config.js'
import type { CursorCodingJob, JobStatus, StreamEvent } from './types.js'

function jobsDir(): string {
  const cfg = loadConfig()
  const dir = join(cfg.dataRoot, 'jobs')
  mkdirSync(dir, { recursive: true })
  return dir
}

function jobPath(id: string): string {
  return join(jobsDir(), `${id}.json`)
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
  return `ccj-${stamp}-${randomBytes(2).toString('hex')}`
}

function migrateJob(raw: CursorCodingJob): CursorCodingJob {
  return {
    ...raw,
    deleted_files: raw.deleted_files || [],
    deferred_files: raw.deferred_files || [],
    synced_files: raw.synced_files || [],
    last_synced_files: raw.last_synced_files || raw.synced_files || [],
    write_scope: raw.write_scope || [],
    sandbox_path: raw.sandbox_path ?? null,
    agent_id: raw.agent_id ?? null,
    run_id: raw.run_id ?? null,
    continue_count: raw.continue_count ?? 0,
    assistant_text: raw.assistant_text || '',
    thinking_text: raw.thinking_text || '',
    transcript: Array.isArray(raw.transcript) ? raw.transcript : [],
    review_in_scope: raw.review_in_scope || [],
    review_deleted: raw.review_deleted || [],
    review_deferred: raw.review_deferred || [],
    events: raw.events || [],
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
  writeFileSync(jobPath(job.id), JSON.stringify(job, null, 2) + '\n', 'utf8')
  return job
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
  job.status = status
  if (detail !== undefined) job.detail = detail
  appendEvent(job, { type: 'status', status, message: detail || status })
  return loadJob(job.id)!
}

export function createJob(input: {
  workspace: string
  requirement: string
  parent_job_id?: string | null
  write_scope?: string[]
  continue_count?: number
}): CursorCodingJob {
  const now = new Date().toISOString()
  const job: CursorCodingJob = {
    id: newJobId(),
    status: 'queued',
    workspace: String(input.workspace || '').trim(),
    requirement: String(input.requirement || '').trim(),
    parent_job_id: input.parent_job_id ? String(input.parent_job_id).trim() : null,
    created_at: now,
    updated_at: now,
    detail: '已入队',
    events: [],
    changed_files: [],
    deleted_files: [],
    deferred_files: [],
    synced_files: [],
    last_synced_files: [],
    write_scope: input.write_scope || [],
    sandbox_path: null,
    agent_id: null,
    run_id: null,
    continue_count: input.continue_count ?? 0,
    assistant_text: '',
    thinking_text: '',
    transcript: [],
    review_in_scope: [],
    review_deleted: [],
    review_deferred: [],
    cancelled: false,
  }
  saveJob(job)
  appendEvent(job, { type: 'status', status: 'queued', message: '已入队' })
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

export function findLatestSucceeded(workspace: string): CursorCodingJob | null {
  const ws = String(workspace || '').trim()
  if (!ws) return null
  for (const j of listJobs(50)) {
    if (j.workspace === ws && j.status === 'succeeded') return j
  }
  return null
}

export function patchJob(id: string, patch: Partial<CursorCodingJob>): CursorCodingJob | null {
  const job = loadJob(id)
  if (!job) return null
  Object.assign(job, patch)
  return saveJob(job)
}
