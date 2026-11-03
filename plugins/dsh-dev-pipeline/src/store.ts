/** 账本落盘：原子写 JSON，按会话查找活跃 Run。 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import type { Epic, PipelineConfig, Run, RunEvent, StepId, StepState } from './types.js'
import { STEP_IDS, STEP_SKILLS, STEP_TITLES } from './types.js'

export interface StorePaths {
  root: string
  runs: string
  epics: string
}

export function storePaths(cfg: PipelineConfig): StorePaths {
  return {
    root: cfg.dataRoot,
    runs: join(cfg.dataRoot, 'runs'),
    epics: join(cfg.dataRoot, 'epics'),
  }
}

export function ensureStore(cfg: PipelineConfig): StorePaths {
  const p = storePaths(cfg)
  mkdirSync(p.runs, { recursive: true })
  mkdirSync(p.epics, { recursive: true })
  return p
}

function atomicWriteJson(path: string, value: unknown): void {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(tmp, path)
}

function readJson<T>(path: string): T | null {
  try {
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return null
  }
}

/** 账本 id 只允许字母数字和连字符，防止 `../` 把读写带出 runs/epics 目录。 */
function idFile(dir: string, id: string): string | null {
  const safe = String(id || '').trim()
  if (!/^[A-Za-z0-9-]{1,120}$/.test(safe)) return null
  return join(dir, `${safe}.json`)
}

export function newId(prefix: 'epic' | 'run'): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  const rand = Math.random().toString(36).slice(2, 6)
  return `${prefix}-${stamp}-${rand}`
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function initSteps(): StepState[] {
  return STEP_IDS.map((id) => ({
    step_id: id,
    skill: STEP_SKILLS[id],
    title: STEP_TITLES[id],
    status: 'pending',
    summary: '',
    detail: '',
    attempts: 0,
    started_at: '',
    ended_at: '',
    evidence: {},
  }))
}

export function saveEpic(cfg: PipelineConfig, epic: Epic): void {
  const p = ensureStore(cfg)
  const file = idFile(p.epics, epic.id)
  if (!file) throw new Error(`非法账本 id：${epic.id}`)
  epic.updated_at = nowIso()
  atomicWriteJson(file, epic)
}

export function loadEpic(cfg: PipelineConfig, id: string): Epic | null {
  const p = ensureStore(cfg)
  const file = idFile(p.epics, id)
  return file ? readJson<Epic>(file) : null
}

export function saveRun(cfg: PipelineConfig, run: Run): void {
  const p = ensureStore(cfg)
  const file = idFile(p.runs, run.id)
  if (!file) throw new Error(`非法任务 id：${run.id}`)
  run.updated_at = nowIso()
  if (run.events.length > 500) run.events = run.events.slice(-500)
  atomicWriteJson(file, run)
}

export function loadRun(cfg: PipelineConfig, id: string): Run | null {
  const p = ensureStore(cfg)
  const file = idFile(p.runs, id)
  return file ? readJson<Run>(file) : null
}

export function listRuns(cfg: PipelineConfig): Run[] {
  const p = ensureStore(cfg)
  const out: Run[] = []
  for (const name of readdirSync(p.runs)) {
    if (!name.endsWith('.json')) continue
    const run = readJson<Run>(join(p.runs, name))
    if (run) out.push(run)
  }
  out.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  return out
}

const OPEN: ReadonlySet<string> = new Set(['queued', 'running', 'paused', 'waiting_hitl'])

export function findOpenRunForSession(cfg: PipelineConfig, sessionId: string): Run | null {
  if (!sessionId) return null
  return listRuns(cfg).find((r) => r.session_id === sessionId && OPEN.has(r.status)) || null
}

export function findLatestRunForSession(cfg: PipelineConfig, sessionId: string): Run | null {
  if (!sessionId) return null
  return listRuns(cfg).find((r) => r.session_id === sessionId) || null
}

export function appendEvent(
  run: Run,
  kind: RunEvent['kind'],
  message: string,
  stepId?: StepId,
): void {
  run.events.push({
    ts: nowIso(),
    step_id: stepId,
    kind,
    message: String(message || '').slice(0, 4000),
  })
}

export function markStep(
  run: Run,
  stepId: StepId,
  patch: Partial<StepState>,
): StepState {
  const step = run.steps.find((s) => s.step_id === stepId)
  if (!step) throw new Error(`未知步骤：${stepId}`)
  Object.assign(step, patch)
  return step
}

/** 宿主重启后把遗留的 running/queued 改成 paused，避免留下假运行的幽灵任务。 */
export function recoverOrphanedRuns(cfg: PipelineConfig): number {
  let n = 0
  for (const run of listRuns(cfg)) {
    if (run.status !== 'running' && run.status !== 'queued') continue
    run.status = 'paused'
    run.error = '宿主重启，任务已暂停；调用 zr_pipeline_advance 继续'
    const step = run.steps.find((s) => s.step_id === run.current_step)
    if (step && step.status === 'running') step.status = 'pending'
    appendEvent(run, 'warn', run.error, run.current_step)
    saveRun(cfg, run)
    n += 1
  }
  return n
}
