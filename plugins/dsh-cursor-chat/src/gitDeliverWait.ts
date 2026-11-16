/**
 * Git 交付确认卡等待：与 ask_user_choice 同级。
 * 权威唤醒必须可跨进程：默认 HTTP 在子进程、工具阻塞在宿主进程，仅靠内存 Map 会永远挂起
 * （UI 已「已取消」但宿主仍「深度搜索中」）。落盘决策 + 轮询 pending/job 终态。
 */
import { join } from 'node:path'
import { readJsonFile, storeDir, withFileLock, writeJsonAtomic } from './diskStore.js'
import type { GitDeliverPlan } from './gitDeliver.js'
import { loadPendingConfirm } from './pendingConfirm.js'

export type GitDeliverConfirmPayload = {
  selected_files: string[]
  commit_message: string
  target_branch: string
  base_branch: string
  create_pr: boolean
}

export type GitDeliverWaitResult =
  | { ok: true; payload: GitDeliverConfirmPayload }
  | { ok: false; cancelled: boolean; detail: string }

type Decision =
  | { v: 1; kind: 'confirm'; at: number; payload: GitDeliverConfirmPayload }
  | { v: 1; kind: 'cancel'; at: number; detail: string }

type Waiter = {
  plan: GitDeliverPlan
  jobId?: string
  resolve: (value: GitDeliverWaitResult) => void
  timer?: ReturnType<typeof setTimeout>
  poll?: ReturnType<typeof setInterval>
}

const waiters = new Map<string, Waiter>()

const DEFAULT_TTL_MS = 30 * 60_000
const POLL_MS = 350

function decisionPath(token: string): string {
  return join(storeDir('state'), 'git-deliver-decisions', `${String(token || '').trim()}.json`)
}

function decisionLock(token: string): string {
  return decisionPath(token) + '.lock'
}

function writeDecision(token: string, decision: Decision): void {
  const id = String(token || '').trim()
  if (!id) return
  withFileLock(decisionLock(id), () => {
    writeJsonAtomic(decisionPath(id), decision)
  })
}

function readDecision(token: string): Decision | null {
  const id = String(token || '').trim()
  if (!id) return null
  const raw = readJsonFile<Decision | null>(decisionPath(id), null)
  if (!raw || raw.v !== 1) return null
  if (raw.kind !== 'confirm' && raw.kind !== 'cancel') return null
  return raw
}

function clearDecision(token: string): void {
  const id = String(token || '').trim()
  if (!id) return
  try {
    withFileLock(decisionLock(id), () => {
      writeJsonAtomic(decisionPath(id), null)
    })
  } catch {
    /* 清理失败不影响主路径 */
  }
}

/**
 * 跨进程可读：磁盘决策 / pending 取消。
 * 不读 jobs（避免 forceCancel→cancelWait 循环依赖）；停止须写 pending/decision。
 */
function pollExternal(id: string): GitDeliverWaitResult | null {
  const decision = readDecision(id)
  if (decision?.kind === 'confirm') {
    return { ok: true, payload: decision.payload }
  }
  if (decision?.kind === 'cancel' && Number(decision.at) > 0) {
    return { ok: false, cancelled: true, detail: decision.detail || '用户取消 Git 交付' }
  }
  const pending = loadPendingConfirm(id)
  if (pending?.status === 'cancelled') {
    return { ok: false, cancelled: true, detail: '用户取消 Git 交付' }
  }
  return null
}

export function getGitDeliverWaitPlan(confirmToken: string): GitDeliverPlan | null {
  const w = waiters.get(String(confirmToken || '').trim())
  return w ? w.plan : null
}

export function waitForGitDeliverConfirm(opts: {
  confirmToken: string
  plan: GitDeliverPlan
  jobId?: string
  ttlMs?: number
}): Promise<GitDeliverWaitResult> {
  const id = String(opts.confirmToken || '').trim()
  if (!id) {
    return Promise.resolve({ ok: false, cancelled: false, detail: '缺少 confirm_token' })
  }
  const prev = waiters.get(id)
  if (prev) {
    if (prev.timer) clearTimeout(prev.timer)
    if (prev.poll) clearInterval(prev.poll)
    prev.resolve({ ok: false, cancelled: true, detail: '已被新的 Git 交付确认替换' })
    waiters.delete(id)
  }
  try {
    clearDecision(id)
  } catch {
    /* ignore */
  }

  const ttl = Math.max(60_000, Math.min(60 * 60_000, opts.ttlMs ?? DEFAULT_TTL_MS))
  const jobId = String(opts.jobId || '').trim()

  return new Promise((resolve) => {
    let settled = false
    const resolveOnce = (value: GitDeliverWaitResult) => {
      if (settled) return
      settled = true
      const cur = waiters.get(id)
      if (cur) {
        if (cur.timer) clearTimeout(cur.timer)
        if (cur.poll) clearInterval(cur.poll)
        waiters.delete(id)
      }
      resolve(value)
    }

    const timer = setTimeout(() => {
      resolveOnce({
        ok: false,
        cancelled: true,
        detail: `用户未在 ${Math.round(ttl / 60000)} 分钟内确认 Git 交付`,
      })
    }, ttl)

    const poll = setInterval(() => {
      const hit = pollExternal(id)
      if (hit) resolveOnce(hit)
    }, POLL_MS)

    waiters.set(id, {
      plan: opts.plan,
      jobId: jobId || undefined,
      timer,
      poll,
      resolve: resolveOnce,
    })

    const early = pollExternal(id)
    if (early) resolveOnce(early)
  })
}

export function confirmGitDeliverWait(
  confirmToken: string,
  payload: GitDeliverConfirmPayload,
): { ok: boolean; detail?: string } {
  const id = String(confirmToken || '').trim()
  if (!id) return { ok: false, detail: '缺少 confirm_token' }
  const normalized: GitDeliverConfirmPayload = {
    selected_files: Array.isArray(payload.selected_files) ? payload.selected_files : [],
    commit_message: String(payload.commit_message || '').trim(),
    target_branch: String(payload.target_branch || '').trim(),
    base_branch: String(payload.base_branch || '').trim(),
    create_pr: payload.create_pr !== false,
  }
  // 先落盘，保证子进程 HTTP 也能唤醒宿主工具 waiter
  writeDecision(id, { v: 1, kind: 'confirm', at: Date.now(), payload: normalized })
  const w = waiters.get(id)
  if (w) {
    w.resolve({ ok: true, payload: normalized })
    return { ok: true }
  }
  // 无本进程 waiter：磁盘决策仍会唤醒另一进程的 wait 轮询
  return { ok: true, detail: 'decision_persisted' }
}

export function cancelGitDeliverWait(
  confirmToken: string,
  detail?: string,
): { ok: boolean; detail?: string } {
  const id = String(confirmToken || '').trim()
  if (!id) return { ok: false, detail: '缺少 confirm_token' }
  const reason = detail || '用户取消 Git 交付'
  writeDecision(id, { v: 1, kind: 'cancel', at: Date.now(), detail: reason })
  const w = waiters.get(id)
  if (w) {
    w.resolve({ ok: false, cancelled: true, detail: reason })
    return { ok: true }
  }
  // 同步取消进行中的高危二次人审
  decideGitDeliverRisk(id, 'pause', reason)
  return { ok: true, detail: 'decision_persisted' }
}

// ── 高危二次人审（与确认决策分文件，避免互相覆盖）──

/** fix=修高危；continue=引擎不可用时仍提交；pause=暂停 */
export type GitDeliverRiskChoice = 'fix' | 'pause' | 'continue'

export type GitDeliverRiskWaitResult =
  | { ok: true; decision: 'fix' | 'continue' }
  | { ok: false; decision: 'pause'; detail: string }

type RiskDecision =
  | { v: 1; kind: 'fix'; at: number }
  | { v: 1; kind: 'continue'; at: number }
  | { v: 1; kind: 'pause'; at: number; detail: string }

type RiskWaiter = {
  resolve: (value: GitDeliverRiskWaitResult) => void
  timer?: ReturnType<typeof setTimeout>
  poll?: ReturnType<typeof setInterval>
}

const riskWaiters = new Map<string, RiskWaiter>()

function riskPath(token: string): string {
  return join(storeDir('state'), 'git-deliver-risk-decisions', `${String(token || '').trim()}.json`)
}

function riskLock(token: string): string {
  return riskPath(token) + '.lock'
}

function writeRiskDecision(token: string, decision: RiskDecision): void {
  const id = String(token || '').trim()
  if (!id) return
  withFileLock(riskLock(id), () => {
    writeJsonAtomic(riskPath(id), decision)
  })
}

function readRiskDecision(token: string): RiskDecision | null {
  const id = String(token || '').trim()
  if (!id) return null
  const raw = readJsonFile<RiskDecision | null>(riskPath(id), null)
  if (!raw || raw.v !== 1) return null
  if (raw.kind !== 'fix' && raw.kind !== 'pause' && raw.kind !== 'continue') return null
  return raw
}

function clearRiskDecision(token: string): void {
  const id = String(token || '').trim()
  if (!id) return
  try {
    withFileLock(riskLock(id), () => {
      writeJsonAtomic(riskPath(id), null)
    })
  } catch {
    /* ignore */
  }
}

function pollRisk(id: string): GitDeliverRiskWaitResult | null {
  const decision = readRiskDecision(id)
  if (decision?.kind === 'fix') return { ok: true, decision: 'fix' }
  if (decision?.kind === 'continue') return { ok: true, decision: 'continue' }
  if (decision?.kind === 'pause') {
    return { ok: false, decision: 'pause', detail: decision.detail || '用户选择暂停提交' }
  }
  const pending = loadPendingConfirm(id)
  if (pending?.status === 'cancelled') {
    return { ok: false, decision: 'pause', detail: '用户取消 Git 交付' }
  }
  return null
}

export function waitForGitDeliverRisk(opts: {
  confirmToken: string
  ttlMs?: number
}): Promise<GitDeliverRiskWaitResult> {
  const id = String(opts.confirmToken || '').trim()
  if (!id) {
    return Promise.resolve({ ok: false, decision: 'pause', detail: '缺少 confirm_token' })
  }
  const prev = riskWaiters.get(id)
  if (prev) {
    if (prev.timer) clearTimeout(prev.timer)
    if (prev.poll) clearInterval(prev.poll)
    prev.resolve({ ok: false, decision: 'pause', detail: '已被新的高危决策等待替换' })
    riskWaiters.delete(id)
  }
  try {
    clearRiskDecision(id)
  } catch {
    /* ignore */
  }
  const ttl = Math.max(60_000, Math.min(60 * 60_000, opts.ttlMs ?? DEFAULT_TTL_MS))
  return new Promise((resolve) => {
    let settled = false
    const resolveOnce = (value: GitDeliverRiskWaitResult) => {
      if (settled) return
      settled = true
      const cur = riskWaiters.get(id)
      if (cur) {
        if (cur.timer) clearTimeout(cur.timer)
        if (cur.poll) clearInterval(cur.poll)
        riskWaiters.delete(id)
      }
      resolve(value)
    }
    const timer = setTimeout(() => {
      resolveOnce({
        ok: false,
        decision: 'pause',
        detail: `用户未在 ${Math.round(ttl / 60000)} 分钟内决定高危处理，已暂停提交`,
      })
    }, ttl)
    const poll = setInterval(() => {
      const hit = pollRisk(id)
      if (hit) resolveOnce(hit)
    }, POLL_MS)
    riskWaiters.set(id, { resolve: resolveOnce, timer, poll })
    const early = pollRisk(id)
    if (early) resolveOnce(early)
  })
}

export function decideGitDeliverRisk(
  confirmToken: string,
  decision: GitDeliverRiskChoice,
  detail?: string,
): { ok: boolean; detail?: string } {
  const id = String(confirmToken || '').trim()
  if (!id) return { ok: false, detail: '缺少 confirm_token' }
  if (decision !== 'fix' && decision !== 'pause' && decision !== 'continue') {
    return { ok: false, detail: 'decision 须为 fix / continue / pause' }
  }
  if (decision === 'fix') {
    writeRiskDecision(id, { v: 1, kind: 'fix', at: Date.now() })
  } else if (decision === 'continue') {
    writeRiskDecision(id, { v: 1, kind: 'continue', at: Date.now() })
  } else {
    writeRiskDecision(id, {
      v: 1,
      kind: 'pause',
      at: Date.now(),
      detail: detail || '用户选择暂停提交（未 commit）',
    })
  }
  const w = riskWaiters.get(id)
  if (w) {
    if (decision === 'fix') w.resolve({ ok: true, decision: 'fix' })
    else if (decision === 'continue') w.resolve({ ok: true, decision: 'continue' })
    else {
      w.resolve({
        ok: false,
        decision: 'pause',
        detail: detail || '用户选择暂停提交（未 commit）',
      })
    }
    return { ok: true }
  }
  return { ok: true, detail: 'decision_persisted' }
}

/** 测试用 */
export function _resetGitDeliverWaitForTests(): void {
  for (const [id, w] of [...waiters.entries()]) {
    if (w.timer) clearTimeout(w.timer)
    if (w.poll) clearInterval(w.poll)
    w.resolve({ ok: false, cancelled: true, detail: 'test reset' })
    waiters.delete(id)
  }
  for (const [id, w] of [...riskWaiters.entries()]) {
    if (w.timer) clearTimeout(w.timer)
    if (w.poll) clearInterval(w.poll)
    w.resolve({ ok: false, decision: 'pause', detail: 'test reset' })
    riskWaiters.delete(id)
  }
}
