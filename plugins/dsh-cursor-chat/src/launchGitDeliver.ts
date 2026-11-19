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
  postPrReviewComment,
  prepareGitDeliverPlan,
  type GitDeliverPlan,
  type GitDeliverResult,
} from './gitDeliver.js'
import { runGitDeliverHighFix } from './gitDeliverFix.js'
import {
  buildPrReviewComment,
  resolveGitDeliverReviewBackend,
  runBatchCodeReview,
  writeBatchReviewReport,
  type BatchReviewResult,
} from './gitDeliverReview.js'
import {
  cancelGitDeliverWait,
  waitForGitDeliverConfirm,
  waitForGitDeliverRisk,
} from './gitDeliverWait.js'
import { appendEvent, createJob, listJobs, loadJob, patchJob, setStatus } from './jobs.js'
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

/** 审码进度是同一条：本批 N 个文件，以及随后的（2/8）（3/8）只改这一条，不另起一行。 */
const REVIEW_PROGRESS_LINE = /^正在审码（\s*\d+\s*\/\s*\d+\s*）|^正在审码本批/

function pushGitProgress(jobId: string, message: string, status?: CursorCodingJob['status']): void {
  const job = loadJob(jobId)
  if (!job) return
  const text = String(message || '').trim()
  if (!text) return
  const transcript = job.transcript || []
  // 连续同文案不重复入账（心跳可改秒数；阶段切换必出）
  const prev = [...transcript].reverse().find((it) => it && it.kind === 'status')
  if (prev && String(prev.text || '').trim() === text) {
    patchJob(jobId, { detail: text })
    return
  }
  // 审码进度改同一条：找到已有的「正在审码」状态，只换正文
  if (REVIEW_PROGRESS_LINE.test(text)) {
    let idx = -1
    for (let i = 0; i < transcript.length; i++) {
      const it = transcript[i]
      if (it && it.kind === 'status' && REVIEW_PROGRESS_LINE.test(String(it.text || '').trim())) idx = i
    }
    if (idx >= 0) {
      const nextTranscript = transcript.map((it, i) =>
        i === idx ? { ...it, text, at: new Date().toISOString() } : it,
      )
      patchJob(jobId, { transcript: nextTranscript, detail: text })
      const live = loadJob(jobId)
      if (!live) return
      if (status && status !== live.status) {
        setStatus(live, status, text)
        return
      }
      appendEvent(live, { type: 'status', status: live.status, message: text })
      return
    }
  }
  const item = {
    id: newTranscriptId('git'),
    kind: 'status' as const,
    at: new Date().toISOString(),
    text,
  }
  const nextTranscript = [...transcript, item].slice(-240)
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
    `• 提交分支：${plan.target_branch}\n` +
    `• 合并到：${plan.base_branch}\n` +
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
  paused?: boolean
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
  paused?: boolean
  detail: string
  code?: string
  conclusion: string
  job?: CursorCodingJob
  confirm_token?: string
  plan?: GitDeliverPlan
}

const MAX_RISK_FIX_ROUNDS = 2

/** 暂停后模型常在数秒内再调 git_deliver；此窗内禁止重开确认卡 */
const PAUSED_REENTRY_GUARD_MS = 90_000

function normWorkspaceKey(ws: string): string {
  try {
    return resolve(String(ws || '').trim()).replace(/\\/g, '/').toLowerCase()
  } catch {
    return String(ws || '').trim().replace(/\\/g, '/').toLowerCase()
  }
}

/**
 * 同会话+同工作区刚暂停过：复用该结论，禁止再 prepare 出确认卡。
 * 过窗后用户再说「提交代码」可正常开新卡。
 */
export function findRecentPausedGitDeliver(
  sessionId: string | null | undefined,
  workspace: string,
  withinMs = PAUSED_REENTRY_GUARD_MS,
): CursorCodingJob | null {
  const sid = String(sessionId || '').trim()
  const wsKey = normWorkspaceKey(workspace)
  if (!sid || !wsKey) return null
  const now = Date.now()
  const ttl = Math.max(5_000, Math.min(10 * 60_000, withinMs))
  for (const j of listJobs(40)) {
    if (j.work_kind !== 'git_deliver') continue
    if (String(j.dsh_session_id || '').trim() !== sid) continue
    if (normWorkspaceKey(j.workspace || '') !== wsKey) continue
    if (String(j.git_deliver?.stage || '') !== 'paused') continue
    const at = Date.parse(String(j.updated_at || j.created_at || '')) || 0
    if (!at || now - at < 0 || now - at >= ttl) continue
    return j
  }
  return null
}

function mergeGitDeliverPatch(
  jobId: string,
  patch: NonNullable<CursorCodingJob['git_deliver']>,
): void {
  const live = loadJob(jobId)
  const prev = (live && live.git_deliver) || {}
  patchJob(jobId, { git_deliver: { ...prev, ...patch } })
}

function persistReviewReport(opts: {
  workspace: string
  jobId: string
  review: BatchReviewResult | null | undefined
  files?: string[]
}): string {
  if (!opts.review?.ran || !opts.workspace) return ''
  const written = writeBatchReviewReport({
    workspace: opts.workspace,
    jobId: opts.jobId,
    review: opts.review,
    files: opts.files,
  })
  return written.ok ? written.rel : ''
}

function sealPausedGitDeliver(opts: {
  jobId: string
  plan: GitDeliverPlan
  detail: string
  review?: BatchReviewResult | null
  confirmToken?: string
}): { conclusion: string; job: CursorCodingJob | null } {
  const titles = (opts.review?.high_findings || []).map((f) => {
    const loc = f.line ? `${f.file}:${f.line}` : f.file
    return `${loc} — ${f.title}`
  })
  const conclusion = formatGitDeliverConclusion({
    status: 'paused',
    plan: opts.plan,
    detail: opts.detail,
    riskSummary: opts.review?.summary || '',
    highTitles: titles,
  })
  const jobId = String(opts.jobId || '').trim()
  const job = jobId ? loadJob(jobId) : null
  const tok = String(opts.confirmToken || '').trim()
  if (tok) {
    try {
      cancelPendingConfirm(tok)
    } catch {
      /* pending 清理失败不影响暂停封口 */
    }
  }
  const reportRel = persistReviewReport({
    workspace: opts.plan.workspace,
    jobId,
    review: opts.review,
    files: opts.review?.findings?.map((f) => f.file),
  })
  if (job && jobId) {
    mergeGitDeliverPatch(jobId, {
      risk_gate: null,
      stage: 'paused',
      high_count: opts.review?.high_count,
      medium_count: opts.review?.medium_count,
      low_count: opts.review?.low_count,
      risk_summary: opts.review?.summary || opts.detail,
      report_id: opts.review?.report_id || '',
      review_report_rel: reportRel || undefined,
      high_titles: titles.slice(0, 12),
    })
    patchJob(jobId, {
      assistant_text: conclusion,
      conclusion_delivered: true,
      conclusion_at: new Date().toISOString(),
      cancelled: true,
      review_gate: null,
      review_in_scope: [],
      synced_files: [],
      last_synced_files: [],
      changed_files: [],
    })
    // 暂停 ≠ 业务失败：用 cancelled 态封口工具，但结论用 paused 文案（未 commit）
    setStatus(loadJob(jobId) || job, 'cancelled', opts.detail)
  }
  return { conclusion, job: jobId ? loadJob(jobId) : null }
}

/** 侧栏 begin-ui 进行中的会话锁，防止连点重复 prepare */
const uiDeliverLocks = new Set<string>()

function uiDeliverLockKey(sessionId: string, workspace: string): string {
  return `${String(sessionId || '').trim()}::${normWorkspaceKey(workspace)}`
}

export type GitDeliverUiStart =
  | {
      ok: true
      reused?: boolean
      idle?: boolean
      job: CursorCodingJob
      confirm_token?: string
      plan?: GitDeliverPlan
      chat_body: string
      detail?: string
      code?: string
    }
  | {
      ok: false
      detail: string
      code?: string
      conclusion?: string
      job?: CursorCodingJob
    }

/**
 * 任务上下文侧栏入口：prepare 后在本进程挂 waiter，确认卡仍走现有 turnTail / confirm API。
 * 禁止在此函数内直接 commit；确认后走 completeGitDeliverFromConfirm（含审码闸）。
 */
export async function startGitDeliverFromUi(
  input: LaunchGitDeliverInput,
): Promise<GitDeliverUiStart> {
  const sid = String(input.sessionId || '').trim()
  if (!sid) {
    return { ok: false, detail: '缺少 session_id', code: 'session_required' }
  }
  const abs = resolve(String(input.workspace || '').trim())
  if (!abs) {
    return { ok: false, detail: '缺少工作区路径', code: 'not_dir' }
  }
  const lockKey = uiDeliverLockKey(sid, abs)
  if (uiDeliverLocks.has(lockKey)) {
    return { ok: false, detail: '提交流程已在进行中，请到对话区确认卡操作', code: 'busy' }
  }

  // 同会话同工作区已有待确认：复用，不新建 Job
  for (const j of listJobs(40)) {
    if (j.work_kind !== 'git_deliver') continue
    if (j.status !== 'pending_review') continue
    if (String(j.dsh_session_id || '').trim() !== sid) continue
    if (normWorkspaceKey(j.workspace || '') !== normWorkspaceKey(abs)) continue
    const token = String(j.git_deliver?.confirm_token || '').trim()
    return {
      ok: true,
      reused: true,
      job: j,
      confirm_token: token || undefined,
      chat_body: '已有待确认的 Git 交付，请在对话区确认卡核对后提交。',
      detail: 'reused_pending',
    }
  }

  const priorPaused = findRecentPausedGitDeliver(sid, abs)
  if (priorPaused) {
    const detail =
      String(priorPaused.detail || '').trim() || '用户已选择暂停提交（未 commit）'
    return {
      ok: false,
      detail,
      code: 'risk_paused_replay',
      conclusion: String(priorPaused.assistant_text || '').trim() || detail,
      job: priorPaused,
    }
  }

  uiDeliverLocks.add(lockKey)
  let prepared: Awaited<ReturnType<typeof prepareGitDeliverSession>>
  try {
    prepared = await prepareGitDeliverSession({ ...input, sessionId: sid })
  } catch (err) {
    uiDeliverLocks.delete(lockKey)
    const detail = `准备 Git 交付失败：${String(err).slice(0, 160)}`
    return { ok: false, detail, code: 'prepare_error' }
  }

  if (!prepared.ok) {
    uiDeliverLocks.delete(lockKey)
    return {
      ok: false,
      detail: prepared.detail,
      code: prepared.code,
      conclusion: prepared.conclusion,
      job: prepared.job,
    }
  }
  if ('idle' in prepared && prepared.idle) {
    uiDeliverLocks.delete(lockKey)
    return {
      ok: true,
      idle: true,
      job: prepared.job,
      chat_body: prepared.conclusion,
      detail: prepared.detail,
      code: prepared.code,
    }
  }

  const ready = prepared as GitDeliverPrepared
  const { job, confirm_token, plan, chat_body } = ready

  // 后台挂 waiter：与工具路径同盘决策；确认 API 只唤醒，不在侧栏进程外另起 commit
  void (async () => {
    try {
      const waited = await waitForGitDeliverConfirm({
        confirmToken: confirm_token,
        plan,
        jobId: job.id,
      })
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
            review_in_scope: [],
            synced_files: [],
            last_synced_files: [],
            changed_files: [],
          })
          setStatus(loadJob(job.id) || live, 'cancelled', cancelDetail)
        }
        return
      }
      await completeGitDeliverFromConfirm({
        jobId: job.id,
        plan,
        selected_files: waited.payload.selected_files,
        commit_message: waited.payload.commit_message,
        target_branch: waited.payload.target_branch,
        base_branch: waited.payload.base_branch,
        create_pr: waited.payload.create_pr,
        confirm_token,
        sessionId: sid,
      })
    } catch (err) {
      const live = loadJob(job.id)
      if (live && !['succeeded', 'failed', 'cancelled'].includes(live.status)) {
        const detail = `Git 交付后台执行异常：${String(err).slice(0, 160)}`
        patchJob(job.id, {
          assistant_text: formatGitDeliverConclusion({
            status: 'failed',
            plan,
            result: {
              ok: false,
              stage: 'inspect',
              detail,
              remote_url: plan.remote_url,
              current_branch: plan.current_branch,
              target_branch: plan.target_branch,
              base_branch: plan.base_branch,
              commit_sha: '',
              commit_short: '',
              pushed: false,
              pr_url: '',
              pr_manual_hint: '',
              committed_files: [],
            },
          }),
          conclusion_delivered: true,
          conclusion_at: new Date().toISOString(),
        })
        setStatus(loadJob(job.id) || live, 'failed', detail)
      }
    } finally {
      uiDeliverLocks.delete(lockKey)
    }
  })()

  return {
    ok: true,
    job: loadJob(job.id) || job,
    confirm_token,
    plan,
    chat_body,
  }
}

/**
 * 中间件人审全程：prepare → 阻塞等确认卡 → commit/push。
 * 写码 begin/continue 不走此函数。
 */
export async function runGitDeliverWithHitl(
  input: LaunchGitDeliverInput & { signal?: AbortSignal | null },
): Promise<GitDeliverHitlOk | GitDeliverHitlFail> {
  // 暂停后模型常立刻再调：先挡重入，禁止再出确认卡
  const priorPaused = findRecentPausedGitDeliver(input.sessionId, input.workspace)
  if (priorPaused) {
    const detail =
      String(priorPaused.detail || '').trim() || '用户已选择暂停提交（未 commit）'
    const conclusion =
      String(priorPaused.assistant_text || '').trim() ||
      formatGitDeliverConclusion({
        status: 'paused',
        detail,
        highTitles: priorPaused.git_deliver?.high_titles || [],
        riskSummary: priorPaused.git_deliver?.risk_summary || '',
      })
    return {
      ok: false,
      paused: true,
      cancelled: true,
      detail,
      code: 'risk_paused_replay',
      conclusion,
      job: priorPaused,
    }
  }
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
    confirm_token,
    sessionId: input.sessionId,
    signal,
  })
  if (done.paused) {
    return {
      ok: false,
      paused: true,
      detail: done.result.detail,
      code: done.code,
      conclusion: done.conclusion,
      job: done.job || undefined,
      confirm_token,
      plan,
    }
  }
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

/**
 * 确认后：本批审码闸 →（可选修）→ commit/push/PR。
 * HTTP 兜底与工具人审共用，禁止绕过审码闸。
 */
export async function completeGitDeliverFromConfirm(opts: {
  jobId: string
  plan: GitDeliverPlan
  selected_files: string[]
  commit_message: string
  target_branch: string
  base_branch: string
  create_pr: boolean
  confirm_token?: string
  sessionId?: string | null
  signal?: AbortSignal | null
}): Promise<{
  ok: boolean
  paused?: boolean
  code?: string
  result: GitDeliverResult
  conclusion: string
  job: CursorCodingJob | null
}> {
  const jobId = String(opts.jobId || '').trim()
  const job = loadJob(jobId)
  const confirm_token = String(opts.confirm_token || '').trim()
  const selected = opts.selected_files
  let lastReview: BatchReviewResult | null = null
  let fixRound = 0

  const pausedResult = (detail: string): GitDeliverResult => ({
    ok: false,
    stage: 'inspect',
    detail,
    remote_url: opts.plan.remote_url,
    current_branch: opts.plan.current_branch,
    target_branch: opts.target_branch || opts.plan.target_branch,
    base_branch: opts.base_branch || opts.plan.base_branch,
    commit_sha: '',
    commit_short: '',
    pushed: false,
    pr_url: '',
    pr_manual_hint: '',
    committed_files: [],
  })

  while (true) {
    // 关闸：不进 WorkBuddy HTTP / 不进人审风险卡，直接 commit（仅本函数；写码不动）
    if (resolveGitDeliverReviewBackend() === 'off') {
      if (jobId) {
        pushGitProgress(
          jobId,
          '本批审码闸已关闭，跳过审码，直接 commit / push…',
          'running',
        )
        mergeGitDeliverPatch(jobId, {
          risk_gate: null,
          stage: 'committing',
          selected_files: selected,
          confirm_token: confirm_token || undefined,
          risk_summary: '审码闸已关闭（跳过）',
        })
      }
      lastReview = null
      break
    }
    if (jobId) {
      pushGitProgress(
        jobId,
        `正在审码本批 ${selected.length} 个文件…`,
        'running',
      )
      mergeGitDeliverPatch(jobId, {
        risk_gate: null,
        stage: 'reviewing',
        selected_files: selected,
        confirm_token: confirm_token || undefined,
      })
    }
    const review = await runBatchCodeReview({
      workspace: opts.plan.workspace,
      files: selected,
      // 不把 commit message 当 focus，避免 prompt 注入左右审码结论
      focus: `本批 ${selected.length} 个待提交文件`,
      onProgress: jobId
        ? (done, total) => {
            if (total > 0) pushGitProgress(jobId, `正在审码（${done}/${total}）…`, 'running')
          }
        : undefined,
    })
    lastReview = review
    if (review.unavailable || !review.ran) {
      const detail = review.detail || '审码引擎不可用'
      if (!confirm_token) {
        const sealed = sealPausedGitDeliver({
          jobId,
          plan: opts.plan,
          detail,
          review,
          confirmToken: confirm_token,
        })
        return {
          ok: false,
          paused: true,
          code: 'review_unavailable',
          result: pausedResult(detail),
          conclusion: sealed.conclusion,
          job: sealed.job,
        }
      }
      // 引擎不可达：二次人审（仍继续 / 暂停），禁止静默吞掉整次提交+PR
      if (jobId) {
        pushGitProgress(
          jobId,
          `${detail}。请选择仍继续提交，或暂停`,
          'pending_review',
        )
        mergeGitDeliverPatch(jobId, {
          risk_gate: 'await_risk',
          stage: 'await_risk',
          risk_kind: 'engine_unavailable',
          risk_code: review.unavailable_code === 'files_skipped' ? 'files_skipped' : null,
          risk_summary: detail,
          high_count: 0,
          high_titles: [],
        })
        patchJob(jobId, { review_gate: 'await_user' })
      }
      const risk = await waitForGitDeliverRisk({ confirmToken: confirm_token })
      if (jobId) {
        mergeGitDeliverPatch(jobId, { risk_gate: null, risk_kind: null, risk_code: null })
        patchJob(jobId, { review_gate: null })
      }
      if (!risk.ok) {
        const pauseDetail =
          risk.detail || `审码引擎不可用，用户选择暂停提交：${detail}`
        const sealed = sealPausedGitDeliver({
          jobId,
          plan: opts.plan,
          detail: pauseDetail,
          review,
          confirmToken: confirm_token,
        })
        return {
          ok: false,
          paused: true,
          code: 'review_unavailable',
          result: pausedResult(pauseDetail),
          conclusion: sealed.conclusion,
          job: sealed.job,
        }
      }
      // continue 或误点 fix：均视为跳过审码继续交付（无高危清单可修）
      if (jobId) {
        pushGitProgress(jobId, '已选择跳过审码，继续 commit / push…')
      }
      lastReview = null
      break
    }
    if (jobId) {
      mergeGitDeliverPatch(jobId, {
        high_count: review.high_count,
        medium_count: review.medium_count,
        low_count: review.low_count,
        risk_summary: review.summary || review.detail,
        report_id: review.report_id,
        high_titles: review.high_findings.slice(0, 12).map((f) => {
          const loc = f.line ? `${f.file}:${f.line}` : f.file
          return `${loc} — ${f.title}`
        }),
      })
    }
    if (review.passed) {
      if (jobId) pushGitProgress(jobId, review.detail || '本批审码通过，准备 commit…')
      break
    }
    if (!confirm_token) {
      const detail = `本批存在 ${review.high_count} 处高危，且确认令牌已失效，已暂停提交`
      const sealed = sealPausedGitDeliver({
        jobId,
        plan: opts.plan,
        detail,
        review,
        confirmToken: confirm_token,
      })
      return {
        ok: false,
        paused: true,
        code: 'risk_paused',
        result: pausedResult(detail),
        conclusion: sealed.conclusion,
        job: sealed.job,
      }
    }
    if (jobId) {
      pushGitProgress(
        jobId,
        `本批存在 ${review.high_count} 处高危，请选择修复或暂停提交`,
        'pending_review',
      )
      mergeGitDeliverPatch(jobId, {
        risk_gate: 'await_risk',
        stage: 'await_risk',
        risk_kind: 'high',
      })
      patchJob(jobId, { review_gate: 'await_user' })
    }
    const risk = await waitForGitDeliverRisk({ confirmToken: confirm_token })
    if (jobId) {
      mergeGitDeliverPatch(jobId, { risk_gate: null, risk_kind: null, risk_code: null })
      patchJob(jobId, { review_gate: null })
    }
    if (!risk.ok) {
      const detail = risk.detail || '用户选择暂停提交（保留高危，未 commit）'
      const sealed = sealPausedGitDeliver({
        jobId,
        plan: opts.plan,
        detail,
        review,
        confirmToken: confirm_token,
      })
      return {
        ok: false,
        paused: true,
        code: 'risk_paused',
        result: pausedResult(detail),
        conclusion: sealed.conclusion,
        job: sealed.job,
      }
    }
    // 高危场景不允许 continue 跳过；若收到 continue 当暂停（防误放行高危）
    if (risk.decision === 'continue') {
      const detail = '本批仍有高危，不能跳过审码直接提交；已暂停'
      const sealed = sealPausedGitDeliver({
        jobId,
        plan: opts.plan,
        detail,
        review,
        confirmToken: confirm_token,
      })
      return {
        ok: false,
        paused: true,
        code: 'risk_paused',
        result: pausedResult(detail),
        conclusion: sealed.conclusion,
        job: sealed.job,
      }
    }
    // risk.decision === 'fix'
    if (fixRound >= MAX_RISK_FIX_ROUNDS) {
      const detail = `已达高危修复上限（${MAX_RISK_FIX_ROUNDS} 轮）仍未通过，已暂停提交`
      const sealed = sealPausedGitDeliver({
        jobId,
        plan: opts.plan,
        detail,
        review,
        confirmToken: confirm_token,
      })
      return {
        ok: false,
        paused: true,
        code: 'risk_fix_exhausted',
        result: pausedResult(detail),
        conclusion: sealed.conclusion,
        job: sealed.job,
      }
    }
    fixRound += 1
    if (jobId) {
      mergeGitDeliverPatch(jobId, { stage: 'fixing' })
      pushGitProgress(jobId, `正在修复高危（第 ${fixRound}/${MAX_RISK_FIX_ROUNDS} 轮）…`, 'running')
    }
    const fixed = await runGitDeliverHighFix({
      workspace: opts.plan.workspace,
      selectedFiles: selected,
      highFindings: review.high_findings,
      sessionId: opts.sessionId,
      gitJobId: jobId,
      signal: opts.signal || null,
      onProgress: (m) => {
        if (jobId) pushGitProgress(jobId, m, 'running')
      },
    })
    if (!fixed.ok) {
      const detail = fixed.detail || '高危修复失败，已暂停提交'
      const sealed = sealPausedGitDeliver({
        jobId,
        plan: opts.plan,
        detail,
        review,
        confirmToken: confirm_token,
      })
      return {
        ok: false,
        paused: true,
        code: 'risk_fix_failed',
        result: pausedResult(detail),
        conclusion: sealed.conclusion,
        job: sealed.job,
      }
    }
    if (jobId) pushGitProgress(jobId, '高危修复完成，重新审码本批…')
  }

  if (job) {
    mergeGitDeliverPatch(jobId, { risk_gate: null, stage: 'committing' })
    pushGitProgress(jobId, '审码已通过，正在 commit / push…', 'running')
  }
  let result = await executeGitDeliver(
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

  if (result.ok && result.pr_url && lastReview?.ran) {
    pushGitProgress(jobId, '正在把本批审码报告写入 PR 评论…')
    const comment = await postPrReviewComment({
      remoteUrl: result.remote_url || opts.plan.remote_url,
      prUrl: result.pr_url,
      body: buildPrReviewComment(lastReview),
    })
    result = {
      ...result,
      pr_comment_ok: comment.ok,
      pr_comment_detail: comment.detail,
    }
    if (comment.ok) pushGitProgress(jobId, '审码报告已写入 PR 评论')
    else if (comment.detail) pushGitProgress(jobId, comment.detail)
  }

  const reportRel = persistReviewReport({
    workspace: opts.plan.workspace,
    jobId,
    review: lastReview,
    files: opts.selected_files,
  })
  const conclusion = formatGitDeliverConclusion({
    status: result.ok ? 'succeeded' : 'failed',
    plan: opts.plan,
    result,
    review: lastReview?.ran
      ? {
          ran: true,
          passed: lastReview.passed,
          high_count: lastReview.high_count,
          medium_count: lastReview.medium_count,
          low_count: lastReview.low_count,
          report_rel: reportRel,
        }
      : null,
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
        risk_gate: null,
        high_count: lastReview?.high_count,
        medium_count: lastReview?.medium_count,
        low_count: lastReview?.low_count,
        risk_summary: lastReview?.summary || '',
        report_id: lastReview?.report_id || '',
        review_report_rel: reportRel || undefined,
      },
    })
    setStatus(loadJob(jobId) || job, result.ok ? 'succeeded' : 'failed', result.detail)
  }
  return { ok: result.ok, result, conclusion, job: loadJob(jobId) }
}

/** @deprecated 保留别名，避免外部旧引用 */
export const launchGitDeliver = prepareGitDeliverSession
