/**
 * 立即创建并后台启动写码 Job（无确认卡、无 HITL 二次点击）。
 */
import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadConfig } from './config.js'
import { createJob, findLatestJobByCallId, listJobs, loadJob, setStatus } from './jobs.js'
import { runJobBackground } from './orchestrator/runJob.js'
import { expandWriteScopeWithCompanions } from './scopeCompanions.js'
import { bindPendingJob, createPendingConfirm } from './pendingConfirm.js'
import type { ChatImageRef } from './images.js'
import type { CursorCodingJob } from './types.js'
import { classifyWork, opsWantsRunningService } from './workKind.js'

export type LaunchJobInput = {
  workspace: string
  requirement: string
  images?: ChatImageRef[]
  parentJobId?: string | null
  sessionId?: string | null
  callId?: string | null
}

export type LaunchJobResult =
  | { ok: true; job: CursorCodingJob }
  | { ok: false; detail: string }

const ACTIVE_JOB = new Set(['queued', 'running', 'syncing', 'pending_review'])

function normRequirement(s: string): string {
  return String(s || '').replace(/\s+/g, '').slice(0, 48)
}

/** 同一通会话里宿主重试 / 模型再调 begin 时，复用已有任务，禁止再开一单 Cursor。 */
function reuseExistingJob(
  input: LaunchJobInput,
  workspace: string,
  requirement: string,
): CursorCodingJob | null {
  const callId = String(input.callId || '').trim()
  if (callId) {
    const sameCall = findLatestJobByCallId(callId)
    if (sameCall) return sameCall
  }
  const sid = String(input.sessionId || '').trim()
  if (!sid) return null
  const req = normRequirement(requirement)
  const now = Date.now()
  for (const j of listJobs(20)) {
    if (j.dsh_session_id !== sid || j.workspace !== workspace) continue
    if (ACTIVE_JOB.has(j.status)) return j
    const age = now - (Date.parse(String(j.updated_at || j.created_at || '')) || 0)
    if (j.status === 'succeeded' && normRequirement(j.requirement) === req && age >= 0 && age < 90_000) {
      return j
    }
  }
  return null
}

export function launchCodingJob(input: LaunchJobInput): LaunchJobResult {
  const abs = resolve(String(input.workspace || '').trim())
  const requirement = String(input.requirement || '').trim()
  if (!requirement) return { ok: false, detail: '缺少写码诉求' }
  if (!abs || !existsSync(abs)) return { ok: false, detail: `工程路径不存在：${abs || '(空)'}` }
  try {
    if (!statSync(abs).isDirectory()) return { ok: false, detail: `工程路径须为目录：${abs}` }
  } catch {
    return { ok: false, detail: `无法读取工程路径：${abs}` }
  }

  const parentJobId = String(input.parentJobId || '').trim() || null
  if (parentJobId) {
    const parent = loadJob(parentJobId)
    if (!parent) return { ok: false, detail: `parent_job_id 不存在：${parentJobId}` }
    if (parent.workspace !== abs) {
      return { ok: false, detail: '续改要求 parent 与当前 workspace 一致；否则请走首轮 begin' }
    }
  }

  const existing = reuseExistingJob(input, abs, requirement)
  if (existing) {
    console.log('[cursor-chat] 复用已有任务，不二次开工', existing.id, existing.status)
    return { ok: true, job: existing }
  }

  const cfg = loadConfig()
  const workKind = classifyWork(requirement)
  let job: CursorCodingJob
  try {
    job = createJob({
      workspace: abs,
      requirement,
      images: input.images,
      parent_job_id: parentJobId,
      dsh_session_id: input.sessionId || null,
      dsh_call_id: input.callId || null,
      write_scope: expandWriteScopeWithCompanions(cfg.writeScope),
      continue_count: parentJobId ? (loadJob(parentJobId)?.continue_count || 0) + 1 : 0,
      work_kind: workKind,
    })
  } catch (err) {
    return { ok: false, detail: `创建任务失败：${String(err).slice(0, 160)}` }
  }

  const queuedDetail =
    workKind === 'ops'
      ? opsWantsRunningService(requirement)
        ? '已开工，按项目命令启动/重启服务，不改代码…'
        : '已开工，直接在项目终端处理，不改代码…'
      : '已开工，后台准备沙箱与 Cursor…'
  setStatus(job, 'queued', queuedDetail)
  // 落盘 pending(call_id→job_id)：begin 阻塞未返回时，进度卡用 pending-latest 挂 SSE
  // （兼容尚未热加载 jobs-by-call 的旧 HTTP 子进程）
  try {
    const callId = String(input.callId || '').trim()
    if (callId) {
      const pending = createPendingConfirm({
        workspace: abs,
        requirement,
        images: input.images,
        parent_job_id: parentJobId || undefined,
        call_id: callId,
        session_id: String(input.sessionId || '').trim() || undefined,
      })
      bindPendingJob(pending.id, job.id)
    }
  } catch (err) {
    console.warn('[cursor-chat] pending bind for live card failed', err)
  }
  setImmediate(() => runJobBackground(job.id))
  const live = loadJob(job.id) || job
  return { ok: true, job: live }
}
