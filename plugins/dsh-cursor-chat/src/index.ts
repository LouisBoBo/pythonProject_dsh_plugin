/**
 * @zhongruan/dsh-cursor-chat — 对话式多轮写码
 * 工具名 zr_cchat_*；端口 18791；数据 ~/.zhongruan/cursor-chat。
 *
 * 主路径：用户原话 →（入口级变更先澄清）→ 立刻开工出进度卡 → Cursor 流式过程 → wait/finish 收结论
 * 续改：zr_cchat_continue → 优先 Agent.resume 同一 agent_id
 * 已废除需求确认卡；澄清门与 coding 同源（decideCodingGate，认 ask_user 事件）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { cursorKeyReady, defaultDataRoot, loadConfig, publicConfigView } from './config.js'
import { findLatestJobForSession, forceCancelJob, jobSummary, listJobs, loadJob, patchJob } from './jobs.js'
import { applyJobReview, healStalePendingReview } from './orchestrator/runJob.js'
import { loadPendingConfirm } from './pendingConfirm.js'
import { decideCodingGate, extractSessionEvents } from './clarifyFlow.js'
import { looksLikeFollowUp } from './requirementGate.js'
import { launchCodingJob } from './launchJob.js'
import {
  extractImagesFromExec,
  filterStoredImageRefs,
  materializeImages,
  parseImageArgs,
  type ChatImageRef,
} from './images.js'
import { isStuckEmptyPendingReview } from './scopeCompanions.js'
import { formatChatConclusion } from './conclusion.js'
import { getListenAddr, isServerRunning, startServer, stopServer } from './server.js'

/** 展开 ~/… 为绝对路径 */
function expandWorkspace(p: string): string {
  const s = String(p || '').trim()
  if (!s) return s
  if (s === '~') return homedir()
  if (s.startsWith('~/') || s.startsWith('~\\')) {
    return resolve(homedir(), s.slice(2))
  }
  return resolve(s)
}

export const name = 'cursor-chat'
export const inject = ['tools'] as const

/** 系统提示层的写码路由：光靠工具描述，模型会先自己 bash/grep/read 探索工程而不调 begin */
const CODING_ROUTE_SECTION =
  '【对话写码路由·硬规则】用户要求改当前工程代码——新增/删除/修改页面、菜单、路由、报表入口、接口、字段、样式，或修 bug——必须直接调用 zr_cchat_begin（同一工程续改调用 zr_cchat_continue），把用户最新原话原样放进 message，workspace 传当前工作区绝对路径。' +
  '调用前禁止用 bash/grep/read/glob 探索工程，禁止自行改文件，禁止用其他工具代替写码，禁止先向用户长文解释方案。' +
  'begin/continue 会阻塞到写码结束并直接返回「本轮结论」（进度卡在阻塞期间流式展示 Thought/命令/Diff）。' +
  '返回后三段式结论已在 chat_body，禁止再写短复述盖掉正文。' +
  '禁止 bash/sleep 空等；一般不必再调 zr_cchat_wait/finish（仅 begin 超时未出结论时才用）。' +
  '入口级新增/删除若被 begin 返回 need_clarify 拦下，立即调用 ask_user_question 给 2～4 个选项，用户答完再调 begin/continue（clarified=true）。' +
  '需求不清时用 ask_user_question 追问，禁止干等。' +
  '只有用户明确只想了解代码（在哪、什么意思、帮我解释）且不需要改动时，才使用只读工具。' +
  '用户贴了截图时，把图片绝对路径放进 images。' +
  '已命中 ESC/MES 专用技能时按该技能流程走。'

declare const harness: {
  handle: (method: string, fn: (args: Record<string, unknown>) => Promise<unknown>) => void
}

function textBlocks(text: string | undefined) {
  return [{ type: 'text' as const, text: text ?? '' }]
}

const JSON_OUTPUT_SCHEMA = { type: 'json' as const }

function asJson(value: unknown): JsonValue {
  return value as JsonValue
}

function execCallId(exec: unknown): string {
  if (!exec || typeof exec !== 'object') return ''
  const e = exec as { callId?: unknown; rootCallId?: unknown; call_id?: unknown }
  return String(e.callId || e.rootCallId || e.call_id || '').trim()
}

function execSessionId(exec: unknown): string {
  if (!exec || typeof exec !== 'object') return ''
  const e = exec as {
    sessionId?: unknown
    session_id?: unknown
    session?: { id?: unknown }
    agent?: { session?: { id?: unknown }; sessionId?: unknown }
  }
  const direct = String(e.sessionId || e.session_id || e.session?.id || '').trim()
  if (direct) return direct
  try {
    return String(e.agent?.session?.id || e.agent?.sessionId || '').trim()
  } catch {
    return ''
  }
}

function truthy(v: unknown): boolean {
  if (v === true || v === 1) return true
  const s = String(v ?? '')
    .trim()
    .toLowerCase()
  return s === 'true' || s === '1' || s === 'yes' || s === 'y' || s === '确认' || s === 'ok'
}

/** 入口级变更被拦时：先出选择题，禁止再空调 begin */
const CLARIFY_AGENT_HINT =
  '【下一步唯一动作】立刻调用 ask_user_question：按用户原话自拟 2～4 个关键选项（如删范围：仅菜单 / 菜单+路由 / 菜单+页面+接口等），禁止长文反问。' +
  '禁止再次调用 zr_cchat_begin/continue，直到用户答完。' +
  '答完后一次调用 begin/continue（clarified=true）；message 尽量带结论。插件会立刻开工并出进度卡（无确认卡）。' +
  '禁止对用户说「已发出确认卡」。'

const FOLLOWUP_AGENT_HINT =
  '续改：把用户最新原话原样传入 message；优先 zr_cchat_continue（同会话 resume）。' +
  '入口级新增/删除须先 ask_user_question。澄清完成→zr_cchat_begin/continue（阻塞到结论）。禁止对旧 job 再 finish。'

/** 硬规则：凡写码终态必须产出正文结论（begin/continue 收口或 finish 兜底） */
const FINISH_DONE = new Set(['succeeded', 'failed', 'cancelled', 'blocked_no_runner'])

/**
 * 同一次用户发话里模型会把 begin 调两次（重试 / 自行再开一单）。
 * 第二单不再带「本轮结论」正文，避免聊天里叠两份不同结论。
 * 诉求变了（用户真的续改）不挡。
 */
const conclusionSlots: { key: string; loose: string; jobId: string; at: number }[] = []

function conclusionSlotKey(job: { workspace?: string; requirement?: string; dsh_session_id?: string | null }): {
  key: string
  loose: string
} {
  const req = String(job.requirement || '').replace(/\s+/g, '').slice(0, 48)
  const loose = `${String(job.workspace || '')}::${req}`
  return { loose, key: `${String(job.dsh_session_id || '')}::${loose}` }
}

function claimConclusionSlot(jobId: string, slot: { key: string; loose: string }): boolean {
  const now = Date.now()
  for (let i = conclusionSlots.length - 1; i >= 0; i--) {
    if (now - conclusionSlots[i]!.at > 90_000) conclusionSlots.splice(i, 1)
  }
  const taken = conclusionSlots.some(
    (s) => s.jobId !== jobId && (s.key === slot.key || s.loose === slot.loose),
  )
  if (taken) return false
  if (!conclusionSlots.some((s) => s.jobId === jobId)) {
    conclusionSlots.push({ key: slot.key, loose: slot.loose, jobId, at: now })
  }
  return true
}

/** 紧急熔断：CURSOR_CHAT_DISABLE_ALL=1 时所有 begin/continue 立即返回，用于线上紧急停用 */
function isCircuitBreakerActive(): boolean {
  const v = String(process.env.CURSOR_CHAT_DISABLE_ALL || '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'on' || v === 'enabled'
}

function circuitBreakerError() {
  return asJson({
    ok: false,
    show_error: true,
    detail: '插件已被管理员临时熔断（CURSOR_CHAT_DISABLE_ALL=1），请稍后重试或联系管理员。',
    chat_body: '⚠️ **Cursor 对话写码已临时停用**\n\n目前服务异常，管理员已紧急熔断。请稍后重试或联系管理员确认服务状态。',
  })
}

function buildConclusionToolResult(opts: {
  jobId: string
  kind: 'live' | 'continue'
  workspace: string
  requirement: string
  parentJobId?: string
  confirmToken?: string
  base: string
}): JsonValue {
  const job = loadJob(opts.jobId)
  if (!job) {
    return asJson({
      ok: false,
      show_error: true,
      detail: `任务不存在：${opts.jobId}`,
      chat_body: `任务不存在：${opts.jobId}`,
    })
  }
  if (!job.conclusion_delivered) {
    const now = new Date().toISOString()
    patchJob(job.id, {
      conclusion_delivered: true,
      conclusion_at: job.conclusion_at || now,
    })
  }
  const fresh = loadJob(opts.jobId) || job
  const show = claimConclusionSlot(fresh.id, conclusionSlotKey(fresh))
  const conclusion = show ? formatChatConclusion(fresh) : ''
  return asJson({
    ok: true,
    started: true,
    done: true,
    pending_confirm: false,
    confirm_token: opts.confirmToken || '',
    job_id: fresh.id,
    status: fresh.status,
    detail: fresh.detail || '',
    synced_files: fresh.synced_files || fresh.last_synced_files || [],
    chat_body: conclusion,
    suppress_conclusion: !show,
    model_next: show
      ? '【硬停止】工具正文里的「本轮结论」是给用户看的唯一一份。禁止再写第二份「本轮结论 / 结果 / 改动 / 验收」。' +
        '改动文件列表只用底座「已编辑 N 个文件」卡。不要再调 wait/finish/begin。回复留空。'
      : '【硬停止】本轮结论已经交付过。禁止再输出任何「本轮结论」。不要再调写码工具。回复留空。',
    source: 'cursor_chat',
    cursor_chat_ui: {
      kind: opts.kind,
      job_id: fresh.id,
      workspace: opts.workspace,
      requirement: opts.requirement,
      parent_job_id: opts.parentJobId || '',
      image_count: (fresh.images && fresh.images.length) || 0,
      service: opts.base,
      status: fresh.status,
      stage: 'F-enterprise-ux',
      review_in_scope: fresh.review_in_scope || [],
      review_deleted: fresh.review_deleted || [],
      review_deferred: fresh.review_deferred || fresh.deferred_files || [],
      review_gate: fresh.review_gate ?? null,
    },
  })
}

async function waitJobUntilConclusion(
  jobId: string,
  signal?: AbortSignal,
): Promise<ReturnType<typeof loadJob>> {
  const deadline = Date.now() + 15 * 60 * 1000
  let pendingSince = 0
  while (Date.now() < deadline) {
    if (signal?.aborted) {
      forceCancelJob(jobId)
      throw new Error('已取消')
    }
    healStalePendingReview(jobId)
    const job = loadJob(jobId)
    if (!job) return null
    const st = job.status || ''
    const detail = String(job.detail || '')
    const inScopeLen = (job.review_in_scope || []).length
    const gate = job.review_gate || null
    // 空范围卡死只对 pending_review 成立；running/queued 时 review 列表天然为空，
    // 提前返回会把「正在写码」误报成「等待超时」，模型只好自己 sleep 轮询
    if (
      FINISH_DONE.has(st) ||
      (st === 'pending_review' && isStuckEmptyPendingReview(detail, inScopeLen, gate))
    ) {
      // 终态已落盘：让 SSE 把带 job_id 的 done 送到进度卡。工具一返回宿主可能冻住 toolview。
      const updated = Date.parse(String(job.updated_at || '')) || 0
      const age = updated ? Date.now() - updated : 0
      if (age >= 0 && age < 700) await sleep(700 - age, signal)
      return loadJob(jobId)
    }
    if (st === 'pending_review') {
      const autoRaw = String(process.env.CURSOR_CHAT_AUTO_APPLY || '1').trim().toLowerCase()
      const autoOn = !(autoRaw === '0' || autoRaw === 'false' || autoRaw === 'off' || autoRaw === 'no')
      const syncFailed = gate === 'auto_failed' || detail === '自动同步失败，请手动同步'
      const syncing = gate === 'auto_applying' || detail === '自动同步中…'
      if (syncFailed) return loadJob(jobId)
      if (gate === 'await_user' || (!gate && !autoOn)) {
        if (!pendingSince) pendingSince = Date.now()
        if (Date.now() - pendingSince > 12_000) return loadJob(jobId)
      } else if (autoOn && syncing) {
        pendingSince = 0
      } else {
        if (!pendingSince) pendingSince = Date.now()
        if (Date.now() - pendingSince > 8_000) return loadJob(jobId)
      }
    } else {
      pendingSince = 0
    }
    await sleep(1500, signal)
  }
  healStalePendingReview(jobId)
  return loadJob(jobId)
}

/**
 * begin/continue：立刻开工，并阻塞到写码终态再返回结论。
 * 秒回 + wait 轮询会被宿主折进「已完成用时 Ns」，用户空等只见结论。
 * 阻塞期间 toolview 停在 start，客户端用 callId 对账挂 SSE 流式展示过程。
 */
function tryConcludeTurn(exec: unknown): void {
  try {
    const e = exec as { concludeTurn?: () => void } | null
    if (e && typeof e.concludeTurn === 'function') e.concludeTurn()
  } catch {
    /* 宿主未实现则忽略 */
  }
}

/**
 * 封口本轮：只 concludeTurn。
 *
 * 硬禁止：agent.inject / 伪造 assistant 进会话账本。
 * 曾把「本轮结论」inject 成 assistant，落成 `user/message` 且 role=assistant，
 * 刷新后校验失败（seq N must have role "user"），会话直接「历史加载失败」；
 * 同轮还会触发宿主 INVALID_REQUEST 重试红字。
 * 可见结论只走：工具 content/chat_body + 客户端 recent-conclusions 挂载。
 */
async function deliverVisibleConclusion(exec: unknown, conclusion: string): Promise<void> {
  tryConcludeTurn(exec)
  const text = String(conclusion || '').trim()
  if (text) {
    console.log('[cursor-chat] 本轮已 concludeTurn，结论仅经工具正文交付', { chars: text.length })
  }
}

async function startCodingImmediate(opts: {
  workspace: string
  requirement: string
  images?: ChatImageRef[]
  parentJobId?: string
  callId?: string
  sessionId?: string
  signal?: AbortSignal
  /** 终态结论已写入 chat_body：封口本轮，禁止宿主模型再盖一句短复述 */
  exec?: unknown
}): Promise<JsonValue> {
  await startServer()
  const cfg = loadConfig()
  const base = getListenAddr() || publicConfigView(cfg).base
  const workspace = expandWorkspace(opts.workspace)
  const requirement = String(opts.requirement || '').trim()
  const kind = opts.parentJobId ? 'continue' : 'live'

  const launched = launchCodingJob({
    workspace,
    requirement,
    images: opts.images,
    parentJobId: opts.parentJobId,
    sessionId: opts.sessionId,
    callId: opts.callId,
  })
  if (!launched.ok) {
    return asJson({
      ok: false,
      show_error: true,
      detail: launched.detail,
      chat_body: launched.detail,
    })
  }
  const jobId = launched.job.id
  const doneJob = await waitJobUntilConclusion(jobId, opts.signal)
  if (!doneJob) {
    return asJson({
      ok: false,
      show_error: true,
      job_id: jobId,
      detail: `任务不存在：${jobId}`,
      chat_body: `任务不存在：${jobId}`,
    })
  }
  // 只有真正终态才把「本轮结论」放进工具结果。pending_review / 同步中不算结束，禁止提前出结论。
  if (!FINISH_DONE.has(doneJob.status || '')) {
    return asJson({
      ok: true,
      started: true,
      done: false,
      pending_confirm: false,
      job_id: jobId,
      status: doneJob.status,
      detail: doneJob.detail || '仍在运行',
      chat_body:
        `写码仍在进行 \`${jobId}\`（${doneJob.status}）。\n\n` +
        `请调用 zr_cchat_wait(job_id=${jobId}) 续拉进度，终态 zr_cchat_finish。`,
      silent: false,
      source: 'cursor_chat',
      next: `zr_cchat_wait(job_id=${jobId})`,
      cursor_chat_ui: {
        kind,
        job_id: jobId,
        workspace,
        requirement,
        parent_job_id: opts.parentJobId || '',
        service: base,
        status: doneJob.status,
        detail: doneJob.detail || '',
        stage: 'blocking-timeout',
        review_in_scope: doneJob.review_in_scope || [],
        review_deleted: doneJob.review_deleted || [],
        review_deferred: doneJob.review_deferred || doneJob.deferred_files || [],
        review_gate: doneJob.review_gate ?? null,
      },
    })
  }
  const packed = buildConclusionToolResult({
    jobId,
    kind,
    workspace,
    requirement,
    parentJobId: opts.parentJobId,
    base,
  })
  const body =
    packed && typeof packed === 'object' && packed !== null && 'chat_body' in packed
      ? String((packed as { chat_body?: unknown }).chat_body || '')
      : ''
  await deliverVisibleConclusion(opts.exec, body)
  return packed
}

function collectToolImages(
  args: unknown,
  exec: unknown,
  workspace: string,
): { refs: ChatImageRef[]; note: string } {
  const fromArgs = parseImageArgs(
    args && typeof args === 'object' ? (args as { images?: unknown }).images : undefined,
  )
  const fromExec = extractImagesFromExec(exec)
  const merged = [...fromArgs, ...fromExec]
  if (!merged.length) return { refs: [], note: '' }
  const root = loadConfig().dataRoot || defaultDataRoot()
  const ws = expandWorkspace(workspace)
  const dir = join(root, 'uploads', `u-${Date.now().toString(36)}`)
  const { refs, errors } = materializeImages(merged, dir, {
    allowedRoots: [ws, root].filter(Boolean),
  })
  const safe = filterStoredImageRefs(refs, root)
  const note = errors.length ? `部分图片未接入：${errors.slice(0, 3).join('；')}` : ''
  return { refs: safe, note }
}

function asToolValue(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  if (typeof value === 'string') {
    const t = value.trim()
    if (!t.startsWith('{')) return null
    try {
      const o = JSON.parse(t) as unknown
      if (o && typeof o === 'object' && !Array.isArray(o)) return o as Record<string, unknown>
    } catch {
      return null
    }
  }
  return null
}

/** 终态三段式结论只由 client hoist 展示，避免工具正文/通用卡再渲一份 */
function isConclusionBody(body: string): boolean {
  const t = String(body || '')
  return t.includes('本轮结论') || t.includes('结果：') || t.includes('任务结果')
}

/**
 * 聊天正文门禁：确认卡/进度过程中正文为空；
 * begin/continue/finish 在 done=true 时输出「本轮结论」（凡写码必有结论）。
 * 终态结论全文只挂对话区 hoist，工具卡内用短指针，禁止双份正文。
 */
function chatBodyRender(_args: unknown, value: unknown) {
  const v = asToolValue(value)
  if (!v) return textBlocks('')
  // 须澄清：模型必须看见下一步（否则空返回会编造「已发出确认卡」）；聊天卡由 toolview 藏掉
  if (v.need_clarify === true) {
    const hint =
      (typeof v.detail === 'string' && v.detail.trim()) ||
      '请先调用 ask_user_question，答完后再调 zr_cchat_begin。禁止编造确认卡。'
    return textBlocks(hint)
  }
  if (v.pending_confirm === true || v.silent === true) {
    return textBlocks('')
  }
  // 进度/结论：只要有 chat_body 就展示（wait 轮询可见 Thought/命令摘要）
  if (typeof v.chat_body === 'string' && v.chat_body.trim()) {
    const body = v.chat_body.trim()
    // 工具卡内不重复贴全文；正文由 finalizeContent 给出唯一一份
    if (v.done === true && (v.suppress_conclusion === true || isConclusionBody(body))) {
      return textBlocks('')
    }
    return textBlocks(body)
  }
  if (v.ok === false && v.show_error === true) {
    const msg =
      (typeof v.detail === 'string' && v.detail.trim()) ||
      '失败'
    return textBlocks(msg)
  }
  return textBlocks('')
}

function ccPresentationMeta(_args: unknown, value: unknown): JsonValue {
  const v = value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  if (v && v.cursor_chat_ui && typeof v.cursor_chat_ui === 'object') {
    return asJson({ cc: { ui: v.cursor_chat_ui } })
  }
  // 澄清：显式挂 await_ask_user，前端禁止出确认卡
  if (v && (v.need_clarify === true || v.need_clarify === 'true')) {
    return asJson({ cc: { ui: { kind: 'await_ask_user' } } })
  }
  return asJson({ cc: { ui: null } })
}

/**
 * 禁止宿主再挂一张「本轮结论」通用卡：全文只由 client hoist 展示一次。
 * value.chat_body 仍保留给模型；UI 侧见 finalizeContent 短指针。
 */
function ccPresentResult(_args: unknown, result: unknown): unknown {
  void _args
  void result
  return undefined
}

/**
 * 会话日志最终 content：终态结论必须落盘。
 * 此前清空会导致重开会话正文空白；工具卡内仍由 chatBodyRender 藏掉，避免与 turnTail 双份。
 */
function finalizeChatBody(
  _exec: unknown,
  result: { isError?: boolean; value?: unknown; content?: unknown },
): ReturnType<typeof textBlocks> | undefined {
  if (!result || result.isError) return undefined
  const v = asToolValue(result.value)
  const body = v && typeof v.chat_body === 'string' ? v.chat_body.trim() : ''
  if (!body) return textBlocks('')
  if (v && v.suppress_conclusion === true) return textBlocks('')
  return textBlocks(body)
}

function registerHarnessHandlers(): void {
  try {
    const h =
      typeof harness !== 'undefined'
        ? harness
        : (globalThis as unknown as { harness?: typeof harness }).harness
    if (!h || typeof h.handle !== 'function') return
    h.handle('getConfig', async () => {
      const cfg = loadConfig()
      return { ok: true, view: publicConfigView(cfg), cursorKeyReady: cursorKeyReady(cfg) }
    })
    h.handle('status', async () => {
      const cfg = loadConfig()
      return {
        ok: true,
        running: isServerRunning(),
        addr: getListenAddr(),
        view: publicConfigView(cfg),
        cursorKeyReady: cursorKeyReady(cfg),
      }
    })
    console.log('[cursor-chat] harness 已注册 getConfig/status')
  } catch (err) {
    console.warn('[cursor-chat] harness 注册跳过：', String(err))
  }
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new Error('已取消')
  await new Promise<void>((resolvePromise, reject) => {
    const t = setTimeout(() => resolvePromise(), ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(new Error('已取消'))
    }
    if (signal) {
      if (signal.aborted) {
        clearTimeout(t)
        reject(new Error('已取消'))
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

function buildProgressBody(jobId: string): string {
  const job = loadJob(jobId)
  if (!job) return `任务不存在：${jobId}`
  const tools = (job.transcript || []).filter((t) => t.kind === 'tool')
  const thinks = (job.transcript || []).filter((t) => t.kind === 'thinking')
  const lines = [
    `**写码进行中** · \`${job.id}\``,
    ``,
    `${job.status} · ${job.detail || '运行中'} · 工具 ${tools.length} 次 · 思考 ${thinks.length} 段`,
    ``,
  ]
  const lastThink =
    (thinks.length ? String(thinks[thinks.length - 1]?.text || '').trim() : '') ||
    (job.thinking_text || '').trim().slice(-600)
  if (lastThink) {
    lines.push(`**Thought**`, ``, lastThink.slice(-600), ``)
  }
  const lastAsst = (job.assistant_text || '').trim().slice(-400)
  if (lastAsst) {
    lines.push(`**说明**`, ``, lastAsst, ``)
  }
  const recentCmds = tools.filter((t) => t.command).slice(-5)
  for (const t of recentCmds) {
    lines.push(`**运行命令**`, ``, '```bash', String(t.command).slice(0, 500), '```', ``)
  }
  const recentEdits = tools.filter((t) => t.snippet || t.path).slice(-3)
  for (const t of recentEdits) {
    const path = t.path || t.name || 'file'
    if (t.snippet) {
      lines.push(`**改码** \`${path}\``, ``, '```diff', String(t.snippet).slice(0, 1200), '```', ``)
    } else {
      lines.push(`- 触及 \`${path}\``)
    }
  }
  if (!recentCmds.length && !recentEdits.length && !lastThink) {
    lines.push(`（沙箱/启动 Cursor 中…）`, ``)
  }
  lines.push(
    ``,
    `⛔ 禁止 bash/sleep/Wait before polling。→ 立刻再调 \`zr_cchat_wait(job_id=${job.id})\`（会阻塞数秒）；终态立刻 \`zr_cchat_finish\`。`,
  )
  return lines.join('\n')
}

function buildWaitDoneBody(jobId: string): string {
  const job = loadJob(jobId)
  if (!job) return `任务不存在：${jobId}`
  const deferred = job.review_deferred || job.deferred_files || []
  const synced = job.synced_files || job.last_synced_files || job.review_in_scope || []
  const lines = [
    `✅ **写码已终态** · \`${job.id}\` · **${job.status}**`,
    ``,
    job.detail || '',
    ``,
    `同步 ${synced.length} 个 · 范围外 ${deferred.length} 个`,
    ``,
  ]
  if (!synced.length && deferred.length) {
    lines.push(
      `⚠ 本轮没有把有效改动同步回工程（常见：只摸了数据库/范围外文件）。`,
      `请立刻 \`zr_cchat_finish\` 交结论；若用户问题仍在，再用 \`zr_cchat_continue\` 带上具体报错路径续改，或 \`ask_user_question\` 追问缺的信息。`,
      ``,
    )
  }
  lines.push(buildDoneBody(jobId), ``)
  lines.push(`⛔ 禁止再 wait / 禁止 sleep。→ **立刻** \`zr_cchat_finish(job_id=${job.id})\`。`)
  return lines.join('\n')
}

/** 终态结论：写入 DSH 聊天壳正文（卡片外） */
function buildChatConclusionBody(jobId: string): string {
  const job = loadJob(jobId)
  if (!job) return `任务不存在：${jobId}`
  return formatChatConclusion(job)
}

/** 终态正文：与聊天结论同一份 */
function buildDoneBody(jobId: string): string {
  return buildChatConclusionBody(jobId)
}

const WAIT_DONE = new Set(['succeeded', 'failed', 'cancelled', 'blocked_no_runner'])

/**
 * 只读本地账本，不对本进程 HTTP 自调（避免同进程 fetch 假死）。
 * 默认阻塞约 22s：终态立刻返回；有实质进展且已撑满最短窗口才返回。
 * 禁止把「短等」甩给宿主用 bash sleep 空转（会卡死成「深度搜索中」）。
 */
async function pollJobLocal(
  jobId: string,
  signal?: AbortSignal,
  timeoutMs = 10_000,
): Promise<ReturnType<typeof loadJob>> {
  const start = Date.now()
  // 最短 2.5s 再带进度回聊天流，避免空等半分钟才看见 Thought/命令
  const minHoldMs = Math.min(2_500, Math.floor(timeoutMs * 0.3))
  let prev = ''
  let job = loadJob(jobId)
  while (Date.now() - start < timeoutMs) {
    if (signal?.aborted) throw new Error('已取消')
    job = loadJob(jobId)
    if (!job) return null
    // 进度轮询可在 pending_review 停一下；真正「写完结论」仍用 WAIT_DONE
    if (WAIT_DONE.has(job.status || '') || job.status === 'pending_review') return job
    const sig = `${job.status}|${job.detail}|${(job.transcript || []).length}|${(job.thinking_text || '').length}|${(
      job.assistant_text || ''
    ).length}`
    const elapsed = Date.now() - start
    // 有实质进展且已过最短窗口 → 立刻把 Thought/命令推回聊天
    if (prev && sig !== prev && elapsed >= minHoldMs) {
      return job
    }
    prev = sig || prev
    await sleep(400, signal)
  }
  return loadJob(jobId)
}

export function apply(ctx: Context) {
  registerHarnessHandlers()
  ctx.inject(['systemPrompt'], (sp) => {
    sp.systemPrompt.section({
      name: 'zhongruan:cursor-chat-routing',
      order: 105,
      text: CODING_ROUTE_SECTION,
    })
  })
  void startServer()
    .then((out) => {
      console.log(`[cursor-chat] ${out.detail}`)
    })
    .catch((err) => {
      console.warn(`[cursor-chat] 启动失败：${String(err)}`)
    })

  ctx.tools.register(
    defineTool({
      name: 'zr_cchat_begin',
      description:
        '【Cursor 对话写码·主入口】任意本地工作区、不限技术栈：改当前工程代码 / 聊着改 / 看图改。' +
        '写码请求的第一步就调用本工具，禁止先用 bash/grep/read/glob 探索工程。' +
        'workspace=侧栏当前打开工程的绝对路径；禁止 Bash/Write 直接改盘。' +
        '本工具会阻塞到写码结束，直接返回本轮结论；阻塞期间进度卡流式展示 Thought/命令/Diff（无确认卡）。' +
        '返回后三段式结论（任务结果/做了什么/如何验证）已在 chat_body：禁止再写短复述盖掉正文；一般不必再调 wait/finish。' +
        '入口级新增/删除页面·菜单·报表入口：先 ask_user_question，答完再调本工具（clarified=true）。' +
        '用户贴了图：把本机图片绝对路径（或 data URL）放进 images；有图必须传。' +
        'MES/售后/测试用例等已命中 ESC 技能时不要用本工具；本会话已有成功写码后优先 zr_cchat_continue。',
      parameters: {
        workspace: {
          type: 'string',
          required: true,
          description: '当前会话工作区绝对路径（必填，支持 ~/…；任意项目，以侧栏打开的工程为准）',
        },
        message: {
          type: 'string',
          required: true,
          description: '用户本轮诉求原文；若已澄清，把结论一并写入（勿套固定模板）',
        },
        clarified: {
          type: 'string',
          description: '已完成 ask_user_question 澄清后传 true',
        },
        images: {
          type: 'string',
          description:
            '可选附图。JSON 数组：[{"path":"绝对路径"}] 或 [{"data":"base64","mimeType":"image/png"}] 或 [{"url":"https://..."}]；也可传单个绝对路径字符串。用户贴图时务必填。',
        },
      },
      timeoutMs: 15 * 60 * 1000,
      output: {
        schema: JSON_OUTPUT_SCHEMA,
        render: chatBodyRender,
        presentationMeta: ccPresentationMeta,
      },
      presentResult: ccPresentResult as never,
      finalizeContent: finalizeChatBody,
      async execute(args, exec) {
        await startServer()
        // 紧急熔断优先于一切——Key 检查之前就拦
        if (isCircuitBreakerActive()) return circuitBreakerError()
        const cfg = loadConfig()
        if (!cursorKeyReady(cfg)) {
          return asJson({
            ok: false,
            show_error: true,
            detail: '请先到「设置 → AI写码」填写 Cursor API Key。',
            chat_body: '请先到「设置 → AI写码」填写 Cursor API Key。',
          })
        }
        const workspace = String((args && (args as { workspace?: string }).workspace) || '').trim()
        const message = String((args && (args as { message?: string }).message) || '').trim()
        const clarified = args && (args as { clarified?: unknown }).clarified
        if (!workspace) {
          return asJson({
            ok: false,
            show_error: true,
            detail: '缺少 workspace',
            chat_body: '缺少工作区路径。请先在侧栏打开工程，再让我重试。',
          })
        }
        if (!message) {
          return asJson({
            ok: false,
            show_error: true,
            detail: '缺少 message',
            chat_body: '缺少写码诉求。请直接说明要改什么。',
          })
        }
        const gate = decideCodingGate({
          message,
          clarified,
          events: extractSessionEvents(exec),
        })
        if (gate.action === 'block') {
          return asJson({
            ok: false,
            need_clarify: true,
            started: false,
            workspace: expandWorkspace(workspace),
            detail: CLARIFY_AGENT_HINT,
            // 禁止空 chat_body：宿主会渲出大块空白
            chat_body:
              '入口级改动需先确认范围。请回答下方问题；确认后我会立刻开工并在进度卡展示过程。',
            source: 'cursor_chat',
            cursor_chat_ui: { kind: 'await_ask_user', requirement: message },
          })
        }
        const abs = expandWorkspace(workspace)
        const { refs: images, note: imageNote } = collectToolImages(args, exec, abs)
        const sid = execSessionId(exec)
        let parentJobId: string | undefined
        const latest = findLatestJobForSession({
          workspace: abs,
          session_id: sid,
          statuses: ['succeeded', 'pending_review'],
        })
        if (latest && looksLikeFollowUp(gate.requirement)) {
          parentJobId = latest.id
        }
        if (imageNote) {
          console.warn('[cursor-chat]', imageNote)
        }
        return startCodingImmediate({
          workspace: abs,
          requirement: gate.requirement,
          images,
          parentJobId,
          callId: execCallId(exec),
          sessionId: sid,
          signal: exec?.signal,
          exec,
        })
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'zr_cchat_continue',
      description:
        '【Cursor 对话写码·续改】同工程多轮：用户最新原话 + 可选新截图；优先 resume 上一轮 Agent。' +
        '本工具阻塞到写码结束并直接返回本轮结论；进度卡在阻塞期间流式展示过程（无确认卡）。' +
        '返回后三段式结论已在 chat_body：禁止再写短复述盖掉正文。' +
        '换了侧栏工程则 workspace 用新路径。入口级新增/删除页面·菜单·报表入口：先 ask_user_question，答完再调（clarified=true）。' +
        FOLLOWUP_AGENT_HINT +
        ' 有新图时同样传入 images。',
      parameters: {
        workspace: {
          type: 'string',
          required: true,
          description: '当前会话工作区绝对路径（支持 ~/…；须与本轮侧栏工程一致）',
        },
        message: {
          type: 'string',
          required: true,
          description: '本轮追问/续改原话（须是用户最新诉求，勿复用上一轮长文）',
        },
        parent_job_id: {
          type: 'string',
          description: '可选：上次成功/待审任务 id；缺省则自动取本会话最近任务',
        },
        clarified: {
          type: 'string',
          description: '用户已通过 ask_user_question 完成澄清后传 true',
        },
        images: {
          type: 'string',
          description:
            '可选附图（本轮新截图）。JSON 数组 path/data/url，或单个绝对路径。有图务必传。',
        },
      },
      timeoutMs: 15 * 60 * 1000,
      output: {
        schema: JSON_OUTPUT_SCHEMA,
        render: chatBodyRender,
        presentationMeta: ccPresentationMeta,
      },
      presentResult: ccPresentResult as never,
      finalizeContent: finalizeChatBody,
      async execute(args, exec) {
        await startServer()
        // 紧急熔断优先于一切——Key 检查之前就拦
        if (isCircuitBreakerActive()) return circuitBreakerError()
        const cfg = loadConfig()
        if (!cursorKeyReady(cfg)) {
          return asJson({
            ok: false,
            show_error: true,
            detail: '请先到「设置 → AI写码」填写 Cursor API Key。',
            chat_body: '请先到「设置 → AI写码」填写 Cursor API Key。',
          })
        }
        const workspace = String((args && (args as { workspace?: string }).workspace) || '').trim()
        const message = String((args && (args as { message?: string }).message) || '').trim()
        const clarified = args && (args as { clarified?: unknown }).clarified
        let parentId = String((args && (args as { parent_job_id?: string }).parent_job_id) || '').trim()
        if (!workspace || !message) {
          return asJson({
            ok: false,
            show_error: true,
            detail: 'workspace 与 message 均必填。',
            chat_body: '续改需要工作区路径和诉求原文。',
          })
        }
        const gate = decideCodingGate({
          message,
          clarified,
          events: extractSessionEvents(exec),
        })
        if (gate.action === 'block') {
          return asJson({
            ok: false,
            need_clarify: true,
            started: false,
            workspace: expandWorkspace(workspace),
            detail: CLARIFY_AGENT_HINT + ' ' + FOLLOWUP_AGENT_HINT,
            // 禁止空 chat_body：宿主会渲出大块空白
            chat_body:
              '还需要一点信息才能开工。请回答下方问题；确认后我会立刻继续并展示过程。',
            source: 'cursor_chat',
            cursor_chat_ui: { kind: 'await_ask_user', requirement: message },
          })
        }
        const abs = expandWorkspace(workspace)
        const { refs: images, note: imageNote } = collectToolImages(args, exec, abs)
        if (imageNote) console.warn('[cursor-chat]', imageNote)
        const sid = execSessionId(exec)
        if (!parentId) {
          parentId =
            findLatestJobForSession({
              workspace: abs,
              session_id: sid,
              statuses: ['succeeded', 'pending_review'],
            })?.id || ''
          if (!parentId && !sid) {
            parentId =
              findLatestJobForSession({
                workspace: abs,
                statuses: ['succeeded', 'pending_review'],
                allowWorkspaceFallback: true,
              })?.id || ''
          }
        }
        return startCodingImmediate({
          workspace: abs,
          requirement: gate.requirement,
          images,
          parentJobId: parentId || undefined,
          callId: execCallId(exec),
          sessionId: sid,
          signal: exec?.signal,
          exec,
        })
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'zr_cchat_finish',
      description:
        '【Cursor 对话写码·收结论】仅当 begin/continue 超时未出结论时使用；正常路径 begin 已直接返回结论。' +
        '禁止对上一轮已交付结论的 job 重复调用；新诉求请 zr_cchat_continue。',
      parameters: {
        workspace: {
          type: 'string',
          description: '与 begin/continue 相同的工作区路径',
        },
        confirm_token: {
          type: 'string',
          description: '可选',
        },
        job_id: { type: 'string', description: '本轮 begin/continue 的 job_id' },
      },
      timeoutMs: 20 * 60 * 1000,
      output: {
        schema: JSON_OUTPUT_SCHEMA,
        render: chatBodyRender,
      },
      presentResult: ccPresentResult as never,
      finalizeContent: finalizeChatBody,
      async execute(args, exec) {
        await startServer()
        let jobId = String((args && (args as { job_id?: string }).job_id) || '').trim()
        const confirmToken = String(
          (args && (args as { confirm_token?: string }).confirm_token) || '',
        ).trim()
        if (!jobId && confirmToken) {
          const pending = loadPendingConfirm(confirmToken)
          if (pending?.job_id) jobId = pending.job_id
        }
        if (!jobId) {
          return asJson({
            ok: false,
            silent: true,
            detail:
              '缺少 job_id。请等待 zr_cchat_begin/continue 返回；若已返回结论则不必再调 finish。',
            chat_body: '',
          })
        }
        const early = loadJob(jobId)
        if (early?.conclusion_delivered) {
          return asJson({
            ok: true,
            done: true,
            job_id: jobId,
            status: early.status,
            detail: '结论已在 begin/continue 返回中交付，无需重复。',
            chat_body: '',
            silent: true,
            source: 'cursor_chat',
          })
        }
        const cfg = loadConfig()
        const base = getListenAddr() || publicConfigView(cfg).base
        const doneJob = await waitJobUntilConclusion(jobId, exec?.signal)
        if (!doneJob) {
          return asJson({
            ok: false,
            silent: true,
            detail: `任务不存在：${jobId}`,
            chat_body: '',
          })
        }
        if (!FINISH_DONE.has(doneJob.status || '')) {
          return asJson({
            ok: true,
            done: false,
            job_id: jobId,
            status: doneJob.status,
            detail: doneJob.detail || '写码尚未结束',
            chat_body: `写码尚未结束（${doneJob.status || '进行中'}）。不要输出「本轮结论」。请再调 zr_cchat_finish(job_id=${jobId})。`,
            source: 'cursor_chat',
          })
        }
        const packed = buildConclusionToolResult({
          jobId,
          kind: doneJob.parent_job_id ? 'continue' : 'live',
          workspace: doneJob.workspace,
          requirement: doneJob.requirement,
          parentJobId: doneJob.parent_job_id || undefined,
          confirmToken,
          base,
        })
        const body =
          packed && typeof packed === 'object' && packed !== null && 'chat_body' in packed
            ? String((packed as { chat_body?: unknown }).chat_body || '')
            : ''
        await deliverVisibleConclusion(exec, body)
        return packed
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'zr_cchat_wait',
      description:
        '【写码进度·兜底】仅当 begin/continue 超时未出结论时，用本工具（job_id）续拉进度。' +
        '正常路径 begin 已阻塞到结论，不必调本工具。本工具会阻塞约十余秒；未完成请立刻再调。' +
        '严禁 bash/sleep/Wait before polling 或任何空等；终态立刻 zr_cchat_finish，禁止再 wait。',
      parameters: {
        job_id: { type: 'string', required: true, description: '任务 id' },
      },
      timeoutMs: 45_000,
      output: {
        schema: JSON_OUTPUT_SCHEMA,
        render: chatBodyRender,
        presentationMeta: ccPresentationMeta,
      },
      async execute(args, exec) {
        await startServer()
        const jobId = String((args && (args as { job_id?: string }).job_id) || '').trim()
        if (!jobId) {
          return asJson({ ok: false, detail: '缺少 job_id', chat_body: '缺少 job_id。' })
        }
        // 先读一次：真正终态立刻返回（不把 pending_review 当 done，避免结论提前进正文）
        let job = loadJob(jobId)
        if (!job) {
          return asJson({ ok: false, detail: `任务不存在：${jobId}`, chat_body: `任务不存在：${jobId}` })
        }
        if (!WAIT_DONE.has(job.status || '')) {
          job = (await pollJobLocal(jobId, exec?.signal, 10_000)) || job
        }
        const cfg = loadConfig()
        const base = getListenAddr() || publicConfigView(cfg).base
        const ui = {
          kind: job.parent_job_id ? 'continue' : 'live',
          job_id: jobId,
          workspace: job.workspace,
          requirement: job.requirement,
          parent_job_id: job.parent_job_id || '',
          service: base,
          status: job.status,
          detail: job.detail || '',
          stage: WAIT_DONE.has(job.status || '') ? 'wait-done' : 'wait-progress',
          review_in_scope: job.review_in_scope || [],
          review_deleted: job.review_deleted || [],
          review_deferred: job.review_deferred || job.deferred_files || [],
          review_gate: job.review_gate ?? null,
        }
        if (WAIT_DONE.has(job.status || '')) {
          return asJson({
            ok: true,
            done: true,
            must_finish: true,
            silent: false,
            job_id: jobId,
            status: job.status,
            detail: job.detail || '',
            review_in_scope: job.review_in_scope || [],
            review_deferred: job.review_deferred || job.deferred_files || [],
            chat_body:
              '写码已结束。禁止再写「本轮结论 / 结果 / 改动 / 验收」，正文只保留一份。',
            source: 'cursor_chat',
            next: `立刻 zr_cchat_finish(job_id=${jobId})。禁止 sleep、禁止再 wait。`,
            cursor_chat_ui: ui,
          })
        }
        return asJson({
          ok: true,
          done: false,
          silent: false,
          job_id: jobId,
          status: job.status,
          detail: job.detail || '仍在运行',
          chat_body: buildProgressBody(jobId),
          source: 'cursor_chat',
          next: `立刻再调 zr_cchat_wait(job_id=${jobId})（禁止 bash/sleep）；终态后 zr_cchat_finish。`,
          cursor_chat_ui: ui,
        })
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'zr_cchat_apply',
      description:
        '【Cursor 对话写码·同步】用户在对话中确认同步后调用。传入 job_id；files 为空则同步全部 review_in_scope。',
      parameters: {
        job_id: { type: 'string', required: true, description: '待审任务 id' },
        files: {
          type: 'string',
          description: '可选：要同步的相对路径，逗号或换行分隔；空=范围内全部',
        },
        confirmed: {
          type: 'string',
          required: true,
          description: '用户已确认同步时传 true',
        },
      },
      timeoutMs: 120_000,
      output: {
        schema: JSON_OUTPUT_SCHEMA,
        render: chatBodyRender,
      },
      async execute(args) {
        if (!truthy(args && (args as { confirmed?: unknown }).confirmed)) {
          return asJson({
            ok: false,
            detail: '未确认同步。请先在对话里得到用户同意，再 confirmed=true 调用。',
          })
        }
        await startServer()
        const jobId = String((args && (args as { job_id?: string }).job_id) || '').trim()
        const job = loadJob(jobId)
        if (!job) return asJson({ ok: false, detail: `任务不存在：${jobId}` })
        if (job.status !== 'pending_review') {
          return asJson({
            ok: false,
            detail: `当前状态 ${job.status}，仅 pending_review 可同步`,
          })
        }
        const rawFiles = String((args && (args as { files?: string }).files) || '').trim()
        const accept = rawFiles
          ? rawFiles
              .split(/[\n,]+/)
              .map((s) => s.trim())
              .filter(Boolean)
          : job.review_in_scope || []
        if (!accept.length) {
          return asJson({ ok: false, detail: '没有可同步文件' })
        }
        // 禁止经 HTTP 自签 HITL：进度卡同步走 UI 签发；工具仅本进程直调（用户 confirmed）
        const out = applyJobReview({ job_id: jobId, accept })
        if (!out.ok) {
          return asJson({ ok: false, detail: out.detail || 'apply 失败' })
        }
        const synced = out.synced_files || []
        return asJson({
          ok: true,
          job_id: jobId,
          synced_files: synced,
          chat_body: `已同步 ${synced.length} 个文件到本机工程：\n${synced.map((f) => `- ${f}`).join('\n') || '（无）'}`,
          detail: out.detail || '已同步',
        })
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'zr_cchat_status',
      description:
        '【Cursor 对话写码·状态】查询本机服务与 Key。写码请用 zr_cchat_begin。',
      parameters: {
        ignore: { type: 'string', required: true, description: '占位，传空字符串即可' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { summary: { type: 'string' } },
        },
        render: (_a, v) => textBlocks((v as { summary?: string }).summary),
      },
      async execute() {
        const cfg = loadConfig()
        const view = publicConfigView(cfg)
        const lines = [
          `服务：${isServerRunning() ? '已监听' : '未监听'} ${getListenAddr() || view.base}`,
          '形态：默认子进程隔离（崩了不拖垮聊天）；CURSOR_CHAT_SERVER_MODE=inplace 可回退同进程',
          '兼容：GET /health → compat（WorkBuddy / 运行时 / 插件 / Cursor SDK）',
          `Cursor API Key：${cursorKeyReady(cfg) ? '已配置' : '未配置（硬性要求，请到设置页填写）'}`,
          `数据目录：${cfg.dataRoot}`,
          `交互：begin 阻塞到结论（进度卡流式）；超时兜底 wait/finish；待审后 zr_cchat_apply`,
        ]
        return { summary: lines.join('\n') }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'zr_cchat_job',
      description: '查询 Cursor 对话写码任务状态。',
      parameters: {
        job_id: { type: 'string', required: true, description: '任务 id' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { summary: { type: 'string' } },
        },
        render: (_a, v) => textBlocks((v as { summary?: string }).summary),
      },
      async execute(args) {
        const id = String(args.job_id || '').trim()
        if (!id) return { summary: 'job_id 不能为空' }
        const job = loadJob(id)
        if (!job) return { summary: `任务不存在：${id}` }
        return { summary: jobSummary(job) }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'zr_cchat_cancel',
      description: '取消进行中的 Cursor 对话写码任务。',
      parameters: {
        job_id: { type: 'string', required: true, description: '任务 id' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { summary: { type: 'string' } },
        },
        render: (_a, v) => textBlocks((v as { summary?: string }).summary),
      },
      async execute(args) {
        const id = String(args.job_id || '').trim()
        if (!id) return { summary: 'job_id 不能为空' }
        const job = forceCancelJob(id)
        if (!job) return { summary: `任务不存在：${id}` }
        return { summary: `已取消 ${id}（${job.status}）` }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'zr_cchat_jobs',
      description: '列出最近 Cursor 对话写码任务。参数 ignore 传空字符串。',
      parameters: {
        ignore: { type: 'string', required: true, description: '占位，传空字符串即可' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { summary: { type: 'string' } },
        },
        render: (_a, v) => textBlocks((v as { summary?: string }).summary),
      },
      async execute() {
        const jobs = listJobs().slice(0, 20)
        if (!jobs.length) return { summary: '暂无任务。写码请调用 zr_cchat_begin。' }
        return { summary: jobs.map(jobSummary).join('\n') }
      },
    }),
  )

  console.log(
    '[cursor-chat] 插件已加载：zr_cchat_begin/continue/finish/apply（进度卡 + 正文结论）',
  )
}

export async function dispose() {
  await stopServer()
}
