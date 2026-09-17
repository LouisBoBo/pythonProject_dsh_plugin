import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Automation, AutomationRun, AutomationSource, RunStatus, ScheduleType } from './types.js'
import { fingerprintPrompt, newId, nowSec, withLock, writeJsonAtomic } from './util.js'
import { enrichSchedule } from './schedule.js'
import { sanitizeCwds } from './paths.js'
import { getTemplate } from './templates.js'

const STATUSES = new Set(['active', 'paused'])
const MAX_RUNS = 100

function safeId(id: string): string | null {
  if (!id || /[^a-zA-Z0-9_-]/.test(id)) return null
  return id
}

function dirOf(dataRoot: string): string {
  const d = join(dataRoot, 'data')
  mkdirSync(d, { recursive: true })
  return d
}

function defPath(dataRoot: string): string {
  return join(dirOf(dataRoot), 'automations.json')
}

function runsPath(dataRoot: string): string {
  return join(dirOf(dataRoot), 'runs.json')
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback
  try {
    const raw = readFileSync(path, 'utf8')
    if (!raw.trim()) return fallback
    const data = JSON.parse(raw) as T
    return data ?? fallback
  } catch {
    return fallback
  }
}

export function listAutomations(dataRoot: string): Automation[] {
  const items = readJson<unknown[]>(defPath(dataRoot), [])
  const out: Automation[] = []
  for (const item of items) {
    if (item && typeof item === 'object' && (item as Automation).id) {
      out.push(item as Automation)
    }
  }
  out.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
  return out
}

export function getAutomation(dataRoot: string, id: string): Automation | null {
  const safe = safeId(id)
  if (!safe) return null
  return listAutomations(dataRoot).find((x) => x.id === safe) || null
}

export type CreateFields = {
  name?: string
  prompt?: string
  source?: AutomationSource
  template_id?: string | null
  status?: string
  schedule_type?: string
  rrule?: string
  scheduled_at?: string | null
  valid_from?: string | null
  valid_until?: string | null
  cwds?: unknown
  push_to_wecom?: boolean
}

function normalizeStatus(v: unknown, fallback: 'active' | 'paused' = 'active'): 'active' | 'paused' {
  const s = String(v || fallback).trim().toLowerCase()
  return STATUSES.has(s) ? (s as 'active' | 'paused') : fallback
}

function normalizeScheduleType(v: unknown, fallback: ScheduleType = 'recurring'): ScheduleType {
  const s = String(v || fallback).trim().toLowerCase()
  return s === 'once' || s === 'recurring' ? s : fallback
}

export async function createAutomation(dataRoot: string, fields: CreateFields): Promise<Automation> {
  const now = nowSec()
  let source: AutomationSource = fields.source === 'template' ? 'template' : 'custom'
  let templateId = fields.template_id ? String(fields.template_id) : null
  const tpl = templateId ? getTemplate(templateId) : null
  if (templateId && !tpl) {
    templateId = null
    source = 'custom'
  }
  const prompt = String(fields.prompt ?? tpl?.prompt ?? '').trim().slice(0, 8000)
  if (!prompt) {
    throw new Error('执行指令不能为空')
  }
  const name = String(fields.name ?? tpl?.title ?? '未命名任务').trim().slice(0, 120) || '未命名任务'
  const item: Automation = {
    id: newId('auto'),
    name,
    prompt,
    source: tpl ? 'template' : source,
    template_id: tpl ? tpl.id : null,
    prompt_fingerprint: fingerprintPrompt(prompt),
    status: normalizeStatus(fields.status, 'active'),
    schedule_type: normalizeScheduleType(fields.schedule_type, tpl?.schedule_type || 'recurring'),
    rrule: String(fields.rrule ?? tpl?.rrule ?? '').trim().slice(0, 500),
    scheduled_at: fields.scheduled_at ?? null,
    valid_from: fields.valid_from ?? null,
    valid_until: fields.valid_until ?? null,
    cwds: sanitizeCwds(fields.cwds),
    push_to_wecom: Boolean(fields.push_to_wecom ?? tpl?.push_to_wecom ?? false),
    next_run_at: null,
    last_run_at: null,
    created_at: now,
    updated_at: now,
  }
  const saved = enrichSchedule(item)
  await withLock(() => {
    const items = listAutomations(dataRoot)
    items.push(saved)
    writeJsonAtomic(defPath(dataRoot), items)
  })
  return saved
}

export async function updateAutomation(
  dataRoot: string,
  id: string,
  fields: CreateFields & { last_run_at?: number | null; next_run_at?: number | null },
): Promise<Automation | null> {
  const safe = safeId(id)
  if (!safe) return null
  return withLock(() => {
    const items = listAutomations(dataRoot)
    const idx = items.findIndex((x) => x.id === safe)
    if (idx < 0) return null
    const item = { ...items[idx] }
    if (fields.name !== undefined) {
      item.name = String(fields.name || '').trim().slice(0, 120) || item.name
    }
    if (fields.prompt !== undefined) {
      item.prompt = String(fields.prompt || '').trim().slice(0, 8000)
      item.prompt_fingerprint = fingerprintPrompt(item.prompt)
    }
    if (fields.status !== undefined) item.status = normalizeStatus(fields.status, item.status)
    if (fields.schedule_type !== undefined) {
      item.schedule_type = normalizeScheduleType(fields.schedule_type, item.schedule_type)
    }
    if (fields.rrule !== undefined) item.rrule = String(fields.rrule || '').trim().slice(0, 500)
    if (fields.scheduled_at !== undefined) item.scheduled_at = fields.scheduled_at
    if (fields.valid_from !== undefined) item.valid_from = fields.valid_from
    if (fields.valid_until !== undefined) item.valid_until = fields.valid_until
    if (fields.cwds !== undefined) item.cwds = sanitizeCwds(fields.cwds)
    if (fields.push_to_wecom !== undefined) item.push_to_wecom = Boolean(fields.push_to_wecom)
    if (fields.last_run_at !== undefined) item.last_run_at = fields.last_run_at
    if (fields.next_run_at !== undefined) item.next_run_at = fields.next_run_at
    item.updated_at = nowSec()
    const scheduleKeys = ['status', 'schedule_type', 'rrule', 'scheduled_at', 'valid_from', 'valid_until']
    const touched = scheduleKeys.some((k) => k in fields)
    const next = fields.next_run_at === undefined && touched ? enrichSchedule(item) : item
    items[idx] = next
    writeJsonAtomic(defPath(dataRoot), items)
    return next
  })
}

export async function deleteAutomation(dataRoot: string, id: string): Promise<boolean> {
  const safe = safeId(id)
  if (!safe) return false
  return withLock(() => {
    const items = listAutomations(dataRoot)
    const next = items.filter((x) => x.id !== safe)
    if (next.length === items.length) return false
    writeJsonAtomic(defPath(dataRoot), next)
    return true
  })
}

export function listRuns(
  dataRoot: string,
  page = 1,
  pageSize = 10,
): { items: AutomationRun[]; total: number; page: number; page_size: number } {
  const items = readJson<unknown[]>(runsPath(dataRoot), [])
    .filter((x): x is AutomationRun => Boolean(x && typeof x === 'object' && (x as AutomationRun).id))
    .sort((a, b) => (b.started_at || 0) - (a.started_at || 0))
  const total = items.length
  const p = Math.max(1, page)
  const ps = Math.max(1, Math.min(100, pageSize))
  const start = (p - 1) * ps
  return { items: items.slice(start, start + ps), total, page: p, page_size: ps }
}

export async function appendRun(dataRoot: string, fields: Partial<AutomationRun> & Pick<AutomationRun, 'automation_id'>): Promise<AutomationRun> {
  const rec: AutomationRun = {
    id: fields.id || newId('run'),
    automation_id: fields.automation_id,
    automation_name: String(fields.automation_name || ''),
    status: (fields.status || 'running') as RunStatus,
    summary: String(fields.summary || ''),
    error: fields.error ?? null,
    started_at: fields.started_at || nowSec(),
    finished_at: fields.finished_at ?? null,
    cwd: fields.cwd ?? null,
    skip_reason: fields.skip_reason,
    delivery_status: fields.delivery_status,
    delivery_error: fields.delivery_error,
  }
  await withLock(() => {
    const items = readJson<AutomationRun[]>(runsPath(dataRoot), [])
    items.unshift(rec)
    items.sort((a, b) => (b.started_at || 0) - (a.started_at || 0))
    writeJsonAtomic(runsPath(dataRoot), items.slice(0, MAX_RUNS))
  })
  return rec
}

export async function updateRun(
  dataRoot: string,
  runId: string,
  patch: Partial<AutomationRun>,
): Promise<AutomationRun | null> {
  const safe = safeId(runId)
  if (!safe) return null
  return withLock(() => {
    const items = readJson<AutomationRun[]>(runsPath(dataRoot), [])
    const idx = items.findIndex((x) => x.id === safe)
    if (idx < 0) return null
    const cur = items[idx]
    const settled = cur.status === 'succeeded' || cur.status === 'failed' || cur.status === 'cancelled'
    if (settled && patch.status && patch.status !== cur.status) {
      const rest = { ...patch }
      delete rest.status
      delete rest.error
      delete rest.summary
      items[idx] = { ...cur, ...rest }
    } else {
      items[idx] = { ...cur, ...patch }
    }
    writeJsonAtomic(runsPath(dataRoot), items)
    return items[idx]
  })
}

export async function recoverOrphanRuns(dataRoot: string): Promise<number> {
  return withLock(() => {
    const items = readJson<AutomationRun[]>(runsPath(dataRoot), [])
    let n = 0
    const finished = nowSec()
    for (const item of items) {
      if (item.status === 'running') {
        item.status = 'failed'
        item.finished_at = finished
        item.error = { code: 'interrupted', message: '进程中断，本轮未完成' }
        n += 1
      }
    }
    if (n) writeJsonAtomic(runsPath(dataRoot), items)
    return n
  })
}

export function usesTemplatePipeline(item: Automation): boolean {
  if (!item.template_id) return false
  const tpl = getTemplate(item.template_id)
  if (!tpl) return false
  return item.prompt_fingerprint === fingerprintPrompt(tpl.prompt)
}
