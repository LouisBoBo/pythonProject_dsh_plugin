/**
 * 写码工具卡启动对账：禁止把上一轮已完成 job 挂到新 begin/continue 上。
 * 与 client.js 逻辑保持一致（自检用本模块）。
 */

export function normReq(s: string): string {
  return String(s || '')
    .replace(/\s+/g, '')
    .trim()
}

/** 两条诉求是否明显不是同一轮（用于拆掉陈旧 job_id） */
export function requirementsConflict(a: string, b: string): boolean {
  const na = normReq(a)
  const nb = normReq(b)
  if (!na || !nb) return false
  if (na === nb) return false
  const n = Math.min(80, na.length, nb.length)
  if (n >= 8 && na.slice(0, n) === nb.slice(0, n)) return false
  // 前缀不同即视为新诉求（如 点检 vs 维修）
  const head = Math.min(20, na.length, nb.length)
  return na.slice(0, head) !== nb.slice(0, head)
}

/** 与 client.js TERMINAL_JOB 一致：业务终态 */
export const TERMINAL_JOB_STATUS: Record<string, 1> = {
  succeeded: 1,
  failed: 1,
  cancelled: 1,
  blocked_no_runner: 1,
}

/**
 * 卡片相位用的 Job 状态：工具结果终态优先于 session 缓存的 running。
 * 禁止用 statusLabel 文案当 status。
 */
export function preferJobStatus(cacheStatus: string, uiStatus: string): string {
  const cache = String(cacheStatus || '').trim()
  const ui = String(uiStatus || '').trim()
  if (TERMINAL_JOB_STATUS[ui]) return ui
  if (TERMINAL_JOB_STATUS[cache]) return cache
  if (ui === 'pending_review') return ui
  if (cache === 'pending_review') return cache
  return cache || ui
}

/**
 * 本卡已对当前 job 封口后，运行中快照不得把相位打回「写码中」。
 * 仍允许终态快照刷新过程区。
 */
export function shouldApplyJobSnapshot(opts: { sealedStatus?: string; incomingStatus: string }): boolean {
  const sealed = String(opts.sealedStatus || '').trim()
  const incoming = String(opts.incomingStatus || '').trim()
  if (!TERMINAL_JOB_STATUS[sealed]) return true
  if (TERMINAL_JOB_STATUS[incoming]) return true
  return false
}

/** 已封口后，SSE 回放的 review/auto_apply 不得再把相位打回「写码中」。 */
export function sseMayForceRunning(sealedStatus?: string): boolean {
  return !TERMINAL_JOB_STATUS[String(sealedStatus || '').trim()]
}

/**
 * 进度卡可见相位：工具结果 / presentationMeta / 封口 status 优先于 React phase。
 * 宿主在工具返回后可能冻住 toolview；只要权威 status 已是终态，转圈必须停。
 */
export function cardVisiblePhase(opts: {
  phase: string
  sealedStatus?: string
  uiStatus?: string
  resultDone?: boolean
  resultStatus?: string
  resultJobId?: string
  liveJobId?: string
  cancelled?: boolean
}): string {
  if (opts.cancelled) return 'done'
  const live = String(opts.liveJobId || '').trim()
  const resultJob = String(opts.resultJobId || '').trim()
  const resultMatches = !live || !resultJob || resultJob === live
  const resultSt = opts.resultDone === true && resultMatches ? String(opts.resultStatus || '').trim() : ''
  const auth = preferJobStatus(
    preferJobStatus(String(opts.sealedStatus || ''), resultSt),
    String(opts.uiStatus || ''),
  )
  if (TERMINAL_JOB_STATUS[auth]) return 'done'
  return opts.phase
}

/** 只认工具 JSON 的 job_id / status / done，禁止扫正文。 */
export function readToolJobFields(value: unknown): {
  jobId: string
  status: string
  done: boolean
  detail: string
} {
  const empty = { jobId: '', status: '', done: false, detail: '' }
  const seen = new Set<unknown>()
  const walk = (v: unknown, depth: number): typeof empty => {
    if (v == null || depth > 4) return empty
    if (typeof v === 'string') {
      const t = v.trim()
      if (!t.startsWith('{') && !t.startsWith('[')) return empty
      try {
        return walk(JSON.parse(t) as unknown, depth + 1)
      } catch {
        return empty
      }
    }
    if (typeof v !== 'object') return empty
    if (seen.has(v)) return empty
    seen.add(v)
    const o = v as Record<string, unknown>
    const ui =
      o.cursor_chat_ui && typeof o.cursor_chat_ui === 'object'
        ? (o.cursor_chat_ui as Record<string, unknown>)
        : null
    const jobId = String(o.job_id || (ui && ui.job_id) || '').trim()
    const status = String(o.status || (ui && ui.status) || '').trim()
    const done = o.done === true
    const detail = String(o.detail || '').trim()
    if (jobId || status || done) return { jobId, status, done, detail }
    for (const k of ['result', 'value', 'output', 'data', 'json']) {
      const inner = walk(o[k], depth + 1)
      if (inner.jobId || inner.status || inner.done) return inner
    }
    if (Array.isArray(o.content)) {
      for (const c of o.content) {
        if (!c || typeof c !== 'object') continue
        const inner = walk((c as Record<string, unknown>).text, depth + 1)
        if (inner.jobId || inner.status || inner.done) return inner
      }
    }
    return empty
  }
  return walk(value, 0)
}

export function cardIdentity(opts: {
  callId?: string
  blockId?: string
  argsMessage?: string
  confirmToken?: string
}): string {
  const callId = String(opts.callId || '').trim()
  if (callId) return 'call:' + callId
  const blockId = String(opts.blockId || '').trim()
  if (blockId) return 'block:' + blockId
  const tok = String(opts.confirmToken || '').trim()
  if (tok) return 'tok:' + tok
  const msg = normReq(opts.argsMessage || '')
  if (msg) return 'msg:' + msg.slice(0, 96)
  return ''
}

/**
 * 若 presentationMeta / 结果里的 job 与本轮工具入参（或用户原话）冲突，必须拆掉 job，回到确认卡。
 */
export function detachStaleJobUi(opts: {
  ui: Record<string, unknown>
  argsMessage?: string
  lastUserMessage?: string
}): { ui: Record<string, unknown>; stale: boolean } {
  const uiRaw = opts.ui && typeof opts.ui === 'object' ? opts.ui : {}
  const jobId = String(uiRaw.job_id || '').trim()
  if (!jobId) return { ui: uiRaw, stale: false }

  const args = String(opts.argsMessage || '').trim()
  const user = String(opts.lastUserMessage || '').trim()
  const uiReq = String(uiRaw.requirement || uiRaw.original_goal || '').trim()
  const live = args || user

  let stale = false
  if (live && uiReq && requirementsConflict(live, uiReq)) stale = true
  else if (live && !uiReq) stale = true
  // 工具仍在跑、结果却带着「已完成」旧 job：只要 live 与 uiReq 冲突已覆盖；
  // 另：无 live 时无法判断，交给 callId 身份切换硬重置。

  if (!stale) return { ui: uiRaw, stale: false }

  return {
    stale: true,
    ui: {
      kind: String(uiRaw.parent_job_id || uiRaw.job_id ? 'continue' : uiRaw.kind || 'live'),
      workspace: uiRaw.workspace,
      requirement: live,
      parent_job_id: uiRaw.parent_job_id || uiRaw.job_id || '',
      service: uiRaw.service,
      confirm_token: '',
      job_id: '',
      status: '',
      detail: '',
    },
  }
}
