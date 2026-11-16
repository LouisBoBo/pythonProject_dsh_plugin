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
}
