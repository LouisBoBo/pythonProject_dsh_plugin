/**
 * Git 交付高危修复：独立写码 Job（无二次写码确认卡），不复用 git_deliver call_id。
 * 故意绕开 launchCodingJob 的 session/call 复用，避免误吃进行中的 Git 交付单。
 */
import { createJob, forceCancelJob, loadJob, patchJob, setStatus } from './jobs.js'
import { healStalePendingReview, runJobBackground } from './orchestrator/runJob.js'
import type { ReviewFinding } from './gitDeliverReview.js'
import { formatHighFindingsForFix } from './gitDeliverReview.js'
import type { TranscriptItem } from './transcript.js'
import type { CursorCodingJob } from './types.js'

const FINISH = new Set(['succeeded', 'failed', 'cancelled', 'blocked_no_runner'])

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('已取消'))
      return
    }
    const t = setTimeout(resolve, Math.max(0, ms))
    if (!signal) return
    const onAbort = () => {
      clearTimeout(t)
      reject(new Error('已取消'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function scopeFromFindings(files: string[], high: ReviewFinding[]): string[] {
  const set = new Set<string>()
  for (const f of files) {
    const p = String(f || '').trim().replace(/\\/g, '/')
    if (p) set.add(p)
  }
  for (const h of high) {
    const p = String(h.file || '').trim().replace(/\\/g, '/')
    if (p) set.add(p)
  }
  return [...set]
}

/**
 * 把高危修复写码单的过程并进 Git 交付卡。
 * 修复单不绑会话，用户只能看到交付卡；这里按 id 覆盖更新，思考和工具行会跟着变，不重复堆。
 */
export function mergeFixTranscript(
  gitItems: TranscriptItem[],
  fixItems: TranscriptItem[],
): TranscriptItem[] | null {
  const copies = (fixItems || [])
    .filter((it) => it && it.kind !== 'user' && it.id)
    .map((it) => ({ ...it, id: it.id.startsWith('fix:') ? it.id : `fix:${it.id}` }))
  if (!copies.length) return null
  const next = [...(gitItems || [])]
  const indexById = new Map<string, number>()
  next.forEach((it, i) => indexById.set(it.id, i))
  let changed = false
  for (const copy of copies) {
    const idx = indexById.get(copy.id)
    if (idx == null) {
      indexById.set(copy.id, next.length)
      next.push(copy)
      changed = true
      continue
    }
    const prev = next[idx]
    if (
      prev.text !== copy.text ||
      prev.tool_status !== copy.tool_status ||
      prev.snippet !== copy.snippet ||
      prev.streaming !== copy.streaming ||
      prev.thinking_duration_ms !== copy.thinking_duration_ms ||
      prev.path !== copy.path ||
      prev.command !== copy.command
    ) {
      next[idx] = copy
      changed = true
    }
  }
  if (!changed) return null
  return next.slice(-240)
}

export async function runGitDeliverHighFix(opts: {
  workspace: string
  selectedFiles: string[]
  highFindings: ReviewFinding[]
  /** 保留参数位；故意不写入 Job，避免污染会话复用 */
  sessionId?: string | null
  /** Git 交付卡的 job。过程镜像到这张卡，不改修复单自己的账。 */
  gitJobId?: string | null
  signal?: AbortSignal | null
  onProgress?: (message: string) => void
}): Promise<{ ok: boolean; job: CursorCodingJob | null; detail: string }> {
  const workspace = String(opts.workspace || '').trim()
  const high = opts.highFindings || []
  if (!high.length) return { ok: true, job: null, detail: '无高危项，无需修复' }
  const scope = scopeFromFindings(opts.selectedFiles || [], high)
  const requirement = formatHighFindingsForFix(high)
  opts.onProgress?.(`正在修复 ${high.length} 处高危（范围 ${scope.length} 个文件）…`)

  let job: CursorCodingJob
  try {
    job = createJob({
      workspace,
      requirement,
      parent_job_id: null,
      // 故意不绑 session/call：避免占用会话「进行中」槽，被 zr_cchat_begin 复用逻辑误吃
      dsh_session_id: null,
      dsh_call_id: null,
      write_scope: scope.length ? scope : [],
      write_scope_source: scope.length ? 'config' : 'open',
      work_kind: 'code',
    })
  } catch (err) {
    return { ok: false, job: null, detail: `创建高危修复任务失败：${String(err).slice(0, 160)}` }
  }

  setStatus(job, 'queued', 'Git 交付闸：修复高危…')
  runJobBackground(job.id)

  const signal = opts.signal || null
  const deadline = Date.now() + 15 * 60 * 1000
  try {
    while (Date.now() < deadline) {
      if (signal?.aborted) {
        forceCancelJob(job.id)
        return { ok: false, job: loadJob(job.id), detail: '用户停止，高危修复已取消' }
      }
      healStalePendingReview(job.id)
      const live = loadJob(job.id)
      if (!live) return { ok: false, job: null, detail: '高危修复任务丢失' }
      if (opts.gitJobId) {
        const merged = mergeFixTranscript(loadJob(opts.gitJobId)?.transcript || [], live.transcript || [])
        if (merged) patchJob(opts.gitJobId, { transcript: merged })
      }
      if (FINISH.has(live.status)) {
        const ok = live.status === 'succeeded'
        return {
          ok,
          job: live,
          detail: ok
            ? `高危修复完成（${(live.synced_files || []).length} 个文件已同步）`
            : `高危修复未成功：${live.detail || live.status}`,
        }
      }
      // 卡在人工审清单：Git 闸场景默认自动同步已开；若仍 await_user，提示进度即可
      if (live.status === 'pending_review' && live.review_gate === 'await_user') {
        opts.onProgress?.('高危修复待确认同步，请在写码进度卡勾选同步…')
      }
      await sleep(1500, signal)
    }
    forceCancelJob(job.id)
    return { ok: false, job: loadJob(job.id), detail: '高危修复超时（15 分钟）' }
  } catch (err) {
    if (signal?.aborted || /已取消/.test(String(err || ''))) {
      forceCancelJob(job.id)
      return { ok: false, job: loadJob(job.id), detail: '用户停止，高危修复已取消' }
    }
    return { ok: false, job: loadJob(job.id), detail: String((err as Error)?.message || err).slice(0, 200) }
  } finally {
    // 标记关联，便于账本检索（不改变权威控制流）
    try {
      patchJob(job.id, {
        detail: String(loadJob(job.id)?.detail || '') + ' · from=git_deliver_risk_fix',
      })
    } catch {
      /* ignore */
    }
  }
}
