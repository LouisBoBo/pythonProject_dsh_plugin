/**
 * Git 交付出口：独立于写码 begin/continue。
 *
 * 人审走中间件：prepare 出计划后 **waitForGitDeliverConfirm 阻塞**（与 ask_user_choice 同级），
 * 进度卡经 jobs-by-call / pending-latest / SSE 水合确认 UI；用户点确认后工具才 commit/push 并返回。
 * 禁止工具提前返回——宿主会收起 toolview，确认卡一闪即失。
 */
import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  executeGitDeliver,
  formatGitDeliverConclusion,
  isGitDeliverIdleDetail,
  prepareGitDeliverPlan,
  type GitDeliverPlan,
  type GitDeliverResult,
} from './gitDeliver.js'
import {
  cancelGitDeliverWait,
  waitForGitDeliverConfirm,
} from './gitDeliverWait.js'
import { appendEvent, createJob, loadJob, patchJob, setStatus } from './jobs.js'
import {
  bindPendingJobAwaitConfirm,
  cancelPendingConfirm,
  createPendingConfirm,
} from './pendingConfirm.js'
import { newTranscriptId } from './transcript.js'
import type { CursorCodingJob } from './types.js'

export type LaunchGitDeliverInput = {
  workspace: string
  requirement?: string
  commit_message?: string
  target_branch?: string
  base_branch?: string
  create_pr?: boolean
  sessionId?: string | null
  callId?: string | null
}

export type GitDeliverPrepared = {
  ok: true
  job: CursorCodingJob
  confirm_token: string
  plan: GitDeliverPlan
  chat_body: string
}

export type GitDeliverPrepareFail = {
  ok: false
  detail: string
  code?: string
  conclusion: string
  job?: CursorCodingJob
  /** 无改动可提交：友好空结果，不当失败 */
  idle?: boolean
}

export type GitDeliverIdleOk = {
  ok: true
  idle: true
  detail: string
  code: 'no_changes'
  conclusion: string
  job: CursorCodingJob
}

function failConclusion(detail: string, plan?: GitDeliverPlan | null, code?: string) {
  if (isGitDeliverIdleDetail(detail, code)) {
    return formatGitDeliverConclusion({
      status: 'idle',
      plan: plan || undefined,
      detail,
      code: code || 'no_changes',
    })
  }
  return formatGitDeliverConclusion({
    status: 'failed',
    plan: plan || undefined,
    result: {
      ok: false,
      stage: 'inspect',
      detail,
      remote_url: plan?.remote_url || '',
      current_branch: plan?.current_branch || '',
      target_branch: plan?.target_branch || '',
      base_branch: plan?.base_branch || '',
      commit_sha: '',
      commit_short: '',
      pushed: false,
      pr_url: '',
      pr_manual_hint: '',
      committed_files: [],
    },
  })
}

function pushGitProgress(jobId: string, message: string, status?: CursorCodingJob['status']): void {
  const job = loadJob(jobId)
  if (!job) return
  const text = String(message || '').trim()
  if (!text) return
  // 连续同文案不重复入账（心跳可改秒数；阶段切换必出）
  const prev = [...(job.transcript || [])].reverse().find((it) => it && it.kind === 'status')
  if (prev && String(prev.text || '').trim() === text) {
    patchJob(jobId, { detail: text })
    return
  }
  const item = {
    id: newTranscriptId('git'),
    kind: 'status' as const,
    at: new Date().toISOString(),
    text,
  }
  const nextTranscript = [...(job.transcript || []), item].slice(-80)
  patchJob(jobId, { transcript: nextTranscript, detail: text })
  const live = loadJob(jobId)
  if (!live) return
  // 状态跃迁走 setStatus（内部会 appendEvent）；同态进度也必须 SSE，否则确认后灰条不刷新
  if (status && status !== live.status) {
    setStatus(live, status, text)
    return
  }
  appendEvent(live, { type: 'status', status: live.status, message: text })
}

/** 只准备确认卡：立刻返回，不阻塞等用户点击。无改动时返回 idle 友好收口。 */
export async function prepareGitDeliverSession(
  input: LaunchGitDeliverInput,
): Promise<GitDeliverPrepared | GitDeliverIdleOk | GitDeliverPrepareFail> {
  const abs = resolve(String(input.workspace || '').trim())
  const requirement = String(
    input.requirement || input.commit_message || '提交当前工作区改动并开 PR',
  ).trim()
  if (!abs || !existsSync(abs)) {
    const detail = `工程路径不存在：${abs || '(空)'}`
    return { ok: false, detail, code: 'not_dir', conclusion: failConclusion(detail) }
  }
  try {
    if (!statSync(abs).isDirectory()) {
      const detail = `工程路径须为目录：${abs}`
      return { ok: false, detail, code: 'not_dir', conclusion: failConclusion(detail) }
    }
  } catch {
    const detail = `无法读取工程路径：${abs}`
    return { ok: false, detail, code: 'not_dir', conclusion: failConclusion(detail) }
  }

  let job: CursorCodingJob
  try {
    job = createJob({
      workspace: abs,
      requirement,
      dsh_session_id: input.sessionId || null,
      dsh_call_id: input.callId || null,
      work_kind: 'git_deliver',
      write_scope: [],
      write_scope_source: 'open',
    })
  } catch (err) {
    const detail = `创建 Git 交付任务失败：${String(err).slice(0, 160)}`
    return { ok: false, detail, conclusion: failConclusion(detail) }
  }

  setStatus(job, 'running', '正在读取仓库地址、当前分支与未提交改动…')
  pushGitProgress(job.id, `工作区：${abs}`)
  pushGitProgress(job.id, '正在读取 Git 状态（仓库地址 / 当前分支 / 改动文件）…')

  const prepared = await prepareGitDeliverPlan(abs, {
    requirement,
    commit_message: input.commit_message,
    target_branch: input.target_branch,
    base_branch: input.base_branch,
    create_pr: input.create_pr !== false,
  })
  if (!prepared.ok) {
    const idle = isGitDeliverIdleDetail(prepared.detail, prepared.code)
    const conclusion = failConclusion(prepared.detail, null, prepared.code)
    pushGitProgress(job.id, prepared.detail)
    patchJob(job.id, {
      assistant_text: conclusion,
      conclusion_delivered: true,
      conclusion_at: new Date().toISOString(),
      review_gate: null,
      // 空结果不冒充已编辑
      review_in_scope: [],
      synced_files: [],
      last_synced_files: [],
      changed_files: [],
    })
    // 无改动：友好成功收口，禁止标 failed 触发 ❌ 失败模板
    setStatus(loadJob(job.id) || job, idle ? 'succeeded' : 'failed', prepared.detail)
    if (idle) {
      return {
        ok: true,
        idle: true,
        detail: prepared.detail,
        code: 'no_changes',
        conclusion,
        job: loadJob(job.id)!,
      }
    }
    return {
      ok: false,
      detail: prepared.detail,
      code: prepared.code,
      conclusion,
      job: loadJob(job.id) || undefined,
    }
  }
  const plan = prepared.plan

  pushGitProgress(
    job.id,
    `仓库：${plan.remote_url} · 当前分支：${plan.current_branch} · 可提交 ${plan.selected_files.length} 个文件` +
      (plan.held_sensitive_files.length ? `（已排除敏感 ${plan.held_sensitive_files.length}）` : ''),
  )
  pushGitProgress(job.id, '请确认下方仓库 / 分支 / 文件后提交（确认前不会 commit）')

  const pending = createPendingConfirm({
    workspace: abs,
    requirement,
    kind: 'git_deliver',
    git_plan: plan,
    call_id: String(input.callId || '').trim() || undefined,
    session_id: String(input.sessionId || '').trim() || undefined,
  })
  bindPendingJobAwaitConfirm(pending.id, job.id)

  patchJob(job.id, {
    git_deliver: {
      remote_url: plan.remote_url,
      current_branch: plan.current_branch,
      target_branch: plan.target_branch,
      base_branch: plan.base_branch,
      commit_message: plan.commit_message,
      create_pr: plan.create_pr,
      selected_files: plan.selected_files,
      held_sensitive_files: plan.held_sensitive_files,
      confirm_token: pending.id,
    },
    review_in_scope: plan.selected_files.slice(),
    review_deferred: plan.held_sensitive_files.slice(),
    review_gate: 'await_user',
  })
  setStatus(loadJob(job.id) || job, 'pending_review', '请确认仓库 / 分支 / 文件后提交')

  const chat_body =
    `请在下方确认卡核对后提交：\n` +
    `• 仓库：${plan.remote_url}\n` +
    `• 当前分支：${plan.current_branch}\n` +
    `• 将提交到：${plan.target_branch}\n` +
    `• 文件：${plan.selected_files.length} 个` +
    (plan.held_sensitive_files.length ? `（已排除敏感 ${plan.held_sensitive_files.length}）` : '') +
    `\n点「确认提交并开 PR」后才会 commit / push。`

  return {
    ok: true,
    job: loadJob(job.id) || job,
    confirm_token: pending.id,
    plan,
    chat_body,
  }
}

export type GitDeliverHitlOk = {
  ok: true
  cancelled?: false
  idle?: boolean
  job: CursorCodingJob
  confirm_token?: string
  plan?: GitDeliverPlan
  result?: GitDeliverResult
  conclusion: string
  detail?: string
  code?: string
}

export type GitDeliverHitlFail = {
  ok: false
  cancelled?: boolean
  detail: string
  code?: string
  conclusion: string
  job?: CursorCodingJob
  confirm_token?: string
  plan?: GitDeliverPlan
}

/**
 * 中间件人审全程：prepare → 阻塞等确认卡 → commit/push。
 * 写码 begin/continue 不走此函数。
 */
export async function runGitDeliverWithHitl(
  input: LaunchGitDeliverInput & { signal?: AbortSignal | null },
): Promise<GitDeliverHitlOk | GitDeliverHitlFail> {
  const prepared = await prepareGitDeliverSession(input)
  if (!prepared.ok) {
    return {
      ok: false,
      detail: prepared.detail,
      code: prepared.code,
      conclusion: prepared.conclusion,
      job: prepared.job,
    }
  }
  // 无改动：友好收口，不进人审卡
  if ('idle' in prepared && prepared.idle) {
    return {
      ok: true,
      idle: true,
      job: prepared.job,
      conclusion: prepared.conclusion,
      detail: prepared.detail,
      code: prepared.code,
    }
  }
  const { job, confirm_token, plan } = prepared as GitDeliverPrepared
  const signal = input.signal || null
  const onAbort = () => {
    // 宿主停止：须落盘取消，子进程 HTTP / 宿主轮询才能唤醒阻塞工具
    cancelPendingConfirm(confirm_token)
    cancelGitDeliverWait(confirm_token, '用户停止')
  }
  if (signal) {
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  let waited: Awaited<ReturnType<typeof waitForGitDeliverConfirm>>
  try {
    waited = await waitForGitDeliverConfirm({
      confirmToken: confirm_token,
      plan,
      jobId: job.id,
    })
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort)
  }
  if (!waited.ok) {
    const live = loadJob(job.id)
    const cancelDetail = waited.detail || '用户取消 Git 交付'
    if (live && !['succeeded', 'failed', 'cancelled'].includes(live.status)) {
      const conclusion = formatGitDeliverConclusion({
        status: 'cancelled',
        plan,
        cancelDetail,
      })
      patchJob(job.id, {
        cancelled: true,
        assistant_text: conclusion,
        conclusion_delivered: true,
        conclusion_at: new Date().toISOString(),
        review_gate: null,
        // 取消后不得把候选清单留给结论区「已编辑」卡
        review_in_scope: [],
        synced_files: [],
        last_synced_files: [],
        changed_files: [],
      })
      setStatus(loadJob(job.id) || live, 'cancelled', cancelDetail)
      return {
        ok: false,
        cancelled: true,
        detail: cancelDetail,
        conclusion,
        job: loadJob(job.id) || undefined,
        confirm_token,
        plan,
      }
    }
    const conclusion =
      (live && String(live.assistant_text || '').trim()) ||
      formatGitDeliverConclusion({ status: 'cancelled', plan, cancelDetail })
    return {
      ok: false,
      cancelled: true,
      detail: cancelDetail,
      conclusion,
      job: live || undefined,
      confirm_token,
      plan,
    }
  }
  const done = await completeGitDeliverFromConfirm({
    jobId: job.id,
    plan,
    selected_files: waited.payload.selected_files,
    commit_message: waited.payload.commit_message,
    target_branch: waited.payload.target_branch,
    base_branch: waited.payload.base_branch,
    create_pr: waited.payload.create_pr,
  })
  if (!done.ok) {
    return {
      ok: false,
      detail: done.result.detail,
      conclusion: done.conclusion,
      job: done.job || undefined,
      confirm_token,
      plan,
    }
  }
  return {
    ok: true,
    job: done.job || job,
    confirm_token,
    plan,
    result: done.result,
    conclusion: done.conclusion,
  }
}

/** 确认卡点确认后：执行 commit/push/PR 并写回 Job。 */
export async function completeGitDeliverFromConfirm(opts: {
  jobId: string
  plan: GitDeliverPlan
  selected_files: string[]
  commit_message: string
  target_branch: string
  base_branch: string
  create_pr: boolean
}): Promise<{ ok: boolean; result: GitDeliverResult; conclusion: string; job: CursorCodingJob | null }> {
  const jobId = String(opts.jobId || '').trim()
  const job = loadJob(jobId)
  if (job) {
    pushGitProgress(jobId, '已确认，正在 commit / push…', 'running')
  }
  const result = await executeGitDeliver(
    opts.plan,
    {
      selected_files: opts.selected_files,
      commit_message: opts.commit_message,
      target_branch: opts.target_branch,
      base_branch: opts.base_branch,
      create_pr: opts.create_pr,
    },
    {
      onProgress: (message) => {
        if (jobId) pushGitProgress(jobId, message, 'running')
      },
    },
  )
  if (result.commit_short) pushGitProgress(jobId, `Commit：${result.commit_short}`)
  if (result.pushed) pushGitProgress(jobId, `已推送 ${result.target_branch}`)
  if (result.pr_url) pushGitProgress(jobId, `PR：${result.pr_url}`)
  else if (result.pr_manual_hint) pushGitProgress(jobId, result.pr_manual_hint)

  const conclusion = formatGitDeliverConclusion({
    status: result.ok ? 'succeeded' : 'failed',
    plan: opts.plan,
    result,
  })
  if (job) {
    patchJob(jobId, {
      assistant_text: conclusion,
      conclusion_delivered: true,
      conclusion_at: new Date().toISOString(),
      review_gate: null,
      synced_files: result.committed_files.slice(),
      last_synced_files: result.committed_files.slice(),
      changed_files: result.committed_files.slice(),
      git_deliver: {
        remote_url: result.remote_url || opts.plan.remote_url,
        current_branch: opts.plan.current_branch,
        target_branch: result.target_branch,
        base_branch: result.base_branch,
        commit_message: opts.commit_message || opts.plan.commit_message,
        create_pr: opts.create_pr,
        selected_files: result.committed_files,
        held_sensitive_files: opts.plan.held_sensitive_files,
        commit_sha: result.commit_sha,
        commit_short: result.commit_short,
        pr_url: result.pr_url,
        stage: result.stage,
        pushed: result.pushed,
      },
    })
    setStatus(loadJob(jobId) || job, result.ok ? 'succeeded' : 'failed', result.detail)
  }
  return { ok: result.ok, result, conclusion, job: loadJob(jobId) }
}

/** @deprecated 保留别名，避免外部旧引用 */
export const launchGitDeliver = prepareGitDeliverSession
