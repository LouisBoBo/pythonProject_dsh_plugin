import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  Automation,
  AutomationRun,
  AutomationSource,
  BitableSync,
  FeishuDocSync,
  RunStatus,
  ScheduleType,
  YuqueDocSync,
} from './types.js'
import { fingerprintPrompt, newId, nowSec, withLock, writeJsonAtomic } from './util.js'
import { enrichSchedule } from './schedule.js'
import { sanitizeCwds } from './paths.js'
import { getTemplate } from './templates.js'
import { normalizeWikiToken } from './wiki_token.js'
import { looksLikeYuqueSecret, normalizeYuqueBook } from './yuque_book.js'

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
  bitable_sync?: BitableSync | null
  feishu_doc?: FeishuDocSync | null
  yuque_doc?: YuqueDocSync | null
}

function normalizeStatus(v: unknown, fallback: 'active' | 'paused' = 'active'): 'active' | 'paused' {
  const s = String(v || fallback).trim().toLowerCase()
  return STATUSES.has(s) ? (s as 'active' | 'paused') : fallback
}

function sanitizeBitableSync(raw: unknown): BitableSync {
  if (!raw || typeof raw !== 'object') {
    return { enabled: false, app_token: '', table_id: '', mode: 'append' }
  }
  const o = raw as Record<string, unknown>
  const mode = String(o.mode || 'append').trim().toLowerCase() === 'upsert' ? 'upsert' : 'append'
  return {
    enabled: Boolean(o.enabled),
    app_token: String(o.app_token || '').trim().slice(0, 128),
    table_id: String(o.table_id || '').trim().slice(0, 128),
    mode,
  }
}

function sanitizeFeishuDoc(raw: unknown): FeishuDocSync {
  if (!raw || typeof raw !== 'object') {
    return { enabled: false, parent_token: '' }
  }
  const o = raw as Record<string, unknown>
  let parent = String(o.parent_token || '').trim().slice(0, 512)
  if (parent) parent = normalizeWikiToken(parent).slice(0, 512)
  return {
    enabled: Boolean(o.enabled),
    parent_token: parent,
  }
}

function sanitizeYuqueDoc(raw: unknown): YuqueDocSync {
  if (!raw || typeof raw !== 'object') {
    return { enabled: false, book: '' }
  }
  const o = raw as Record<string, unknown>
  const enabled = Boolean(o.enabled)
  const input = String(o.book || '').trim().slice(0, 512)
  if (looksLikeYuqueSecret(input)) {
    throw new Error('语雀 Cookie/Token 不能写进任务。请放到本机凭证文件，不要改仓库配置文件')
  }
  if (!input) return { enabled, book: '' }
  try {
    return { enabled, book: normalizeYuqueBook(input).slice(0, 128) }
  } catch (e) {
    if (enabled) throw e
    return { enabled: false, book: '' }
  }
}

function looksLikeBitableAppToken(token: string): boolean {
  const t = token.trim().toLowerCase()
  return t.startsWith('basc') || t.startsWith('bascn') || t.startsWith('app')
}

/** 任务级飞书文档目标。旧任务若把知识库 token 填进了写表字段，按父页面沿用，不写表。 */
export function resolveFeishuDocSync(item: Automation): FeishuDocSync {
  const doc = sanitizeFeishuDoc(item.feishu_doc)
  if (doc.enabled && doc.parent_token) return doc
  const b = item.bitable_sync
  if (b?.enabled) {
    const token = String(b.app_token || '').trim()
    if (token && !looksLikeBitableAppToken(token)) {
      return { enabled: true, parent_token: token }
    }
  }
  return { enabled: false, parent_token: '' }
}

export function resolveYuqueDocSync(item: Automation): YuqueDocSync {
  return sanitizeYuqueDoc(item.yuque_doc)
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
    push_to_wecom: Boolean(fields.push_to_wecom),
    bitable_sync: sanitizeBitableSync(fields.bitable_sync),
    feishu_doc: sanitizeFeishuDoc(fields.feishu_doc),
    yuque_doc: sanitizeYuqueDoc(fields.yuque_doc),
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
    if (fields.bitable_sync !== undefined) item.bitable_sync = sanitizeBitableSync(fields.bitable_sync)
    if (fields.feishu_doc !== undefined) item.feishu_doc = sanitizeFeishuDoc(fields.feishu_doc)
    if (fields.yuque_doc !== undefined) item.yuque_doc = sanitizeYuqueDoc(fields.yuque_doc)
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
    charts: fields.charts,
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
