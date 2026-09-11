import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { ReviewEvent, ReviewJob, JobStatus } from './types.js'
import { loadConfig } from './config.js'

function jobsDir(): string {
  const dir = join(loadConfig().dataRoot, 'jobs')
  mkdirSync(dir, { recursive: true })
  return dir
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
  return `rr-${stamp}-${randomBytes(8).toString('hex')}`
}

export function createJob(event: ReviewEvent): ReviewJob {
  const now = new Date().toISOString()
  const job: ReviewJob = {
    id: newJobId(),
    createdAt: now,
    updatedAt: now,
    status: event.skip ? 'skipped' : 'queued',
    event,
    detail: event.skipReason,
  }
  saveJob(job)
  return job
}

export function saveJob(job: ReviewJob): ReviewJob {
  job.updatedAt = new Date().toISOString()
  writeFileSync(join(jobsDir(), `${job.id}.json`), JSON.stringify(job, null, 2) + '\n', 'utf8')
  return job
}

export function patchJob(id: string, patch: Partial<ReviewJob> & { status?: JobStatus }): ReviewJob {
  const job = loadJob(id)
  if (!job) throw new Error(`任务不存在：${id}`)
  const next = { ...job, ...patch, id: job.id, event: patch.event || job.event }
  return saveJob(next)
}

export function loadJob(id: string): ReviewJob | null {
  const safe = (id || '').replace(/[^a-zA-Z0-9._-]/g, '')
  if (!safe || safe !== id) return null
  const path = join(jobsDir(), `${safe}.json`)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ReviewJob
  } catch {
    return null
  }
}

export function listJobs(limit = 20): ReviewJob[] {
  const files = readdirSync(jobsDir())
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse()
  const out: ReviewJob[] = []
  for (const f of files.slice(0, Math.max(1, limit))) {
    try {
      out.push(JSON.parse(readFileSync(join(jobsDir(), f), 'utf8')) as ReviewJob)
    } catch {
      /* skip */
    }
  }
  return out
}

export function jobSummary(job: ReviewJob): string {
  const commit = (job.event.commit || '').slice(0, 8) || '—'
  const feishu = job.feishuUrl || (job.status.startsWith('feishu') ? job.detail : '') || ''
  return `${job.id}｜${job.status}｜${job.event.repo}@${commit}｜${feishu || job.detail || ''}`
}
