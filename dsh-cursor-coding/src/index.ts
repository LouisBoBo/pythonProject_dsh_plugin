/**
 * @zhongruan/dsh-cursor-coding — 独立 DSH Bundle
 * 硬约束：工具名 zr_cursor_*；设置页挂 DSH 插槽；改码仅 Cursor。
 *
 * 【澄清→确认 · 唯一规则见 clarifyFlow.ts】
 * 入口级新增/删除：ask_user_question → begin 确认卡阻塞 → 点确认 → 进度 → 正文结论
 * 会话答完选择题为放行权威；clarified=true 空转不得跳过；空返回不是确认卡。
 *
 * 【会话分层 · 见 docs/架构与选型/DSH会话与记忆分层.md】
 * 聊天/压缩认 DSH；执行认本机 Job（记 dsh_session_id/dsh_call_id）；
 * sessionStorage 仅加速。禁止按工作区抢 pending/Job，禁止自造会话树。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { cursorKeyReady, loadConfig, publicConfigView } from './config.js'
import { findLatestJobForSession, forceCancelJob, jobSummary, listJobs, loadJob, patchJob } from './jobs.js'
import { applyJobReview, healStalePendingReview } from './orchestrator/runJob.js'
import { createPendingConfirm, cancelPendingConfirm, loadPendingConfirm } from './pendingConfirm.js'
import { decideCodingGate, extractSessionEvents } from './clarifyFlow.js'
import { looksLikeFollowUp } from './requirementGate.js'
import { criticalDeferredFiles, isStuckEmptyPendingReview } from './scopeCompanions.js'
import { preferredConclusionAssistantText } from './transcript.js'
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

export const name = 'cursor-coding'
export const inject = ['tools'] as const

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

/** Agent 回退提示：只讲原则，具体问什么由模型按本轮诉求自拟（禁止写死选项清单） */
/** Agent：入口级变更被拦时，下一步必须先出选择题，禁止再空调 begin */
const CLARIFY_AGENT_HINT =
  '【下一步唯一动作】立刻调用 ask_user_question：按用户原话自拟 2～4 个关键选项（如删范围：仅菜单 / 菜单+路由 / 菜单+页面+接口等），禁止长文反问。' +
  '禁止再次调用 zr_cursor_begin/continue，直到用户答完。' +
  '答完后一次调用 begin/continue（clarified=true）；message 尽量带结论。插件会认会话里已答完的选择题并出确认卡。' +
  '空返回不是确认卡，禁止对用户说「已发出确认卡」。'

const FOLLOWUP_AGENT_HINT =
  '续改同确认卡→进度→结论。入口级新增/删除须先 ask_user_question。禁止对旧 job 再 finish。'

/** 硬规则：凡写码终态必须产出正文结论（begin/continue 收口或 finish 兜底） */
const FINISH_DONE = new Set(['succeeded', 'failed', 'cancelled', 'blocked_no_runner'])

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
    patchJob(job.id, { conclusion_delivered: true })
  }
  const fresh = loadJob(opts.jobId) || job
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
    chat_body: buildChatConclusionBody(fresh.id),
    source: 'cursor_coding',
    cursor_coding_ui: {
      kind: opts.kind,
      job_id: fresh.id,
      workspace: opts.workspace,
      requirement: opts.requirement,
      parent_job_id: opts.parentJobId || '',
      service: opts.base,
      status: fresh.status,
      stage: 'F-enterprise-ux',
      review_in_scope: fresh.review_in_scope || [],
      review_deleted: fresh.review_deleted || [],
      review_deferred: fresh.review_deferred || fresh.deferred_files || [],
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
    if (FINISH_DONE.has(st) || isStuckEmptyPendingReview(detail, inScopeLen)) {
      return loadJob(jobId)
    }
    if (st === 'pending_review') {
      const autoRaw = String(process.env.CURSOR_CODING_AUTO_APPLY || '1').trim().toLowerCase()
      const autoOn = !(autoRaw === '0' || autoRaw === 'false' || autoRaw === 'off' || autoRaw === 'no')
      const syncFailed = /自动同步失败|同步失败|apply 失败|手动同步/.test(detail)
      const syncing = /自动同步中|同步中/.test(detail) && !syncFailed
      if (syncFailed) return loadJob(jobId)
      if (autoOn && syncing) {
        pendingSince = 0
      } else if (!autoOn) {
        if (!pendingSince) pendingSince = Date.now()
        if (Date.now() - pendingSince > 12_000) return loadJob(jobId)
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
 * begin/continue：确认卡阻塞 → 开工 → 等写码终态 → 带回正文结论。
 * 进度卡靠 pending.job_id + SSE；工具返回时正文必有「本轮结论」。
 */
async function waitConfirmThenStart(opts: {
  workspace: string
  requirement: string
  parentJobId?: string
  callId?: string
  sessionId?: string
  signal?: AbortSignal
}): Promise<JsonValue> {
  await startServer()
  const cfg = loadConfig()
  const base = getListenAddr() || publicConfigView(cfg).base
  const workspace = expandWorkspace(opts.workspace)
  const requirement = String(opts.requirement || '').trim()
  const kind = opts.parentJobId ? 'continue' : 'live'
  const pending = createPendingConfirm({
    workspace,
    requirement,
    parent_job_id: opts.parentJobId,
    call_id: opts.callId,
    session_id: opts.sessionId,
  })
  const deadline = Date.now() + 14 * 60 * 1000
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) {
      const live = loadPendingConfirm(pending.id)
      if (live?.job_id) forceCancelJob(live.job_id)
      cancelPendingConfirm(pending.id)
      throw new Error('已取消')
    }
    const row = loadPendingConfirm(pending.id)
    if (!row || row.status === 'cancelled') {
      return asJson({
        ok: false,
        silent: true,
        detail: '确认已取消',
        chat_body: '',
      })
    }
    if (row.job_id) {
      const jobId = row.job_id
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
      if (!FINISH_DONE.has(doneJob.status || '') && doneJob.status !== 'pending_review') {
        return asJson({
          ok: false,
          done: false,
          show_error: true,
          job_id: jobId,
          status: doneJob.status,
          chat_body:
            `等待写码结束超时（job \`${jobId}\`，状态 ${doneJob.status || '未知'}）。请再调一次 zr_cursor_finish(job_id)。`,
        })
      }
      return buildConclusionToolResult({
        jobId,
        kind,
        workspace,
        requirement,
        parentJobId: opts.parentJobId,
        confirmToken: pending.id,
        base,
      })
    }
    await sleep(1000, opts.signal)
  }
  cancelPendingConfirm(pending.id)
  return asJson({
    ok: false,
    silent: true,
    confirm_token: pending.id,
    detail: '等待用户点确认超时',
    chat_body: '',
  })
}

/**
 * 聊天正文门禁：确认卡/进度过程中正文为空；
 * begin/continue/finish 在 done=true 时输出「本轮结论」（凡写码必有结论）。
 */
function chatBodyRender(_args: unknown, value: unknown) {
  const v = value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  if (!v) return textBlocks('')
  // 须澄清：模型必须看见下一步（否则空返回会编造「已发出确认卡」）；聊天卡由 toolview 藏掉
  if (v.need_clarify === true) {
    const hint =
      (typeof v.detail === 'string' && v.detail.trim()) ||
      '请先调用 ask_user_question，答完后再调 zr_cursor_begin。禁止编造确认卡。'
    return textBlocks(hint)
  }
  if (v.pending_confirm === true || v.silent === true) {
    return textBlocks('')
  }
  if (v.done === true && typeof v.chat_body === 'string' && v.chat_body.trim()) {
    return textBlocks(v.chat_body)
  }
  if (v.ok === false && v.show_error === true) {
    const msg =
      (typeof v.chat_body === 'string' && v.chat_body.trim()) ||
      (typeof v.detail === 'string' && v.detail.trim()) ||
      '失败'
    return textBlocks(msg)
  }
  return textBlocks('')
}

function ccPresentationMeta(_args: unknown, value: unknown): JsonValue {
  const v = value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  if (v && v.cursor_coding_ui && typeof v.cursor_coding_ui === 'object') {
    return asJson({ cc: { ui: v.cursor_coding_ui } })
  }
  // 澄清：显式挂 await_ask_user，前端禁止出确认卡
  if (v && (v.need_clarify === true || v.need_clarify === 'true')) {
    return asJson({ cc: { ui: { kind: 'await_ask_user' } } })
  }
  return asJson({ cc: { ui: null } })
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
    console.log('[cursor-coding] harness 已注册 getConfig/status')
  } catch (err) {
    console.warn('[cursor-coding] harness 注册跳过：', String(err))
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
  const lastThink = (job.thinking_text || '').trim().slice(-280)
  const lastAsst = (job.assistant_text || '').trim().slice(-280)
  const lines = [
    `**Cursor 写码进行中**`,
    ``,
    `- job: \`${job.id}\``,
    `- 状态: **${job.status}**`,
    `- 工作区: \`${job.workspace}\``,
    `- 工具调用: ${tools.length} 次`,
    `- 说明: ${job.detail || '（运行中）'}`,
    ``,
  ]
  if (lastThink) {
    lines.push(`### 最近 Thinking（节选）`, ``, lastThink, ``)
  }
  if (lastAsst) {
    lines.push(`### 最近说明（节选）`, ``, lastAsst, ``)
  }
  lines.push(`请再调 \`zr_cursor_wait\`（job_id=\`${job.id}\`）；未完成前勿空等。`)
  return lines.join('\n')
}

/** 终态结论：写入 DSH 聊天壳正文（卡片外） */
function buildChatConclusionBody(jobId: string): string {
  const job = loadJob(jobId)
  if (!job) return `任务不存在：${jobId}`
  const asst = preferredConclusionAssistantText(job.assistant_text || '')
  const synced = job.synced_files || job.last_synced_files || job.review_in_scope || []
  const deferred = job.review_deferred || job.deferred_files || []
  const lines: string[] = [`## 本轮结论`, ``]
  if (asst) {
    lines.push(asst, ``)
  } else {
    lines.push(job.detail || '写码流程已结束。', ``)
  }
  lines.push(`---`, ``)
  lines.push(`**状态：** ${job.status}`)
  if (job.status === 'succeeded') {
    lines.push(`**同步：** 已自动同步 ${synced.length} 个文件到本机，并尝试刷新前端。`)
    if (synced.length) {
      lines.push(``)
      for (const f of synced.slice(0, 30)) lines.push(`- ${f}`)
      if (synced.length > 30) lines.push(`- …另有 ${synced.length - 30} 个`)
    }
  } else if (job.status === 'pending_review') {
    lines.push(`**同步：** 待审（自动同步未开启或范围内无文件）。`)
  } else {
    lines.push(`**说明：** ${job.detail || job.status}`)
  }
  if (deferred.length) {
    const crit = criticalDeferredFiles(deferred)
    lines.push(``, `**范围外未同步 ${deferred.length} 个**：`)
    for (const f of deferred.slice(0, 15)) lines.push(`- ${f}`)
    if (deferred.length > 15) lines.push(`- …另有 ${deferred.length - 15} 个`)
    if (crit.length) {
      lines.push(
        ``,
        `⚠ **契约文件未同步**（${crit.join(', ')}）：易导致「页面已改但接口请求失败」。请扩大可写范围后走续改，或设置里补上 \`schemas.py\` / \`models.py\`。`,
      )
    } else {
      lines.push(`（可扩大写范围后重试）`)
    }
  }
  lines.push(``)
  lines.push(`请自行打开页面确认编码效果。`)
  lines.push(``)
  lines.push(
    `如需调整或修 bug，请直接在本对话说明具体问题（例如：写入成功但提示请求失败）。小改直接续改确认卡；大改先选择题澄清。`,
  )
  return lines.join('\n')
}

/** 终态正文：精简（排障用） */
function buildDoneBody(jobId: string): string {
  return buildChatConclusionBody(jobId)
}

const WAIT_DONE = new Set(['succeeded', 'failed', 'cancelled', 'blocked_no_runner'])

/**
 * 只读本地账本，不对本进程 HTTP 自调（避免同进程 fetch 假死）。
 * 默认短等 8s：有进度变化或到终态就返回，避免聊天一直 Deep diving。
 */
async function pollJobLocal(
  jobId: string,
  signal?: AbortSignal,
  timeoutMs = 8_000,
): Promise<ReturnType<typeof loadJob>> {
  const start = Date.now()
  let prev = ''
  let job = loadJob(jobId)
  while (Date.now() - start < timeoutMs) {
    if (signal?.aborted) throw new Error('已取消')
    job = loadJob(jobId)
    if (!job) return null
    // 进度轮询可在 pending_review 停一下；真正「写完结论」仍用 WAIT_DONE
    if (WAIT_DONE.has(job.status || '') || job.status === 'pending_review') return job
    const sig = `${job.status}|${job.detail}|${(job.transcript || []).length}|${(job.thinking_text || '').length}`
    if (prev && sig !== prev && Date.now() - start >= 1500) {
      return job
    }
    prev = sig
    await sleep(1000, signal)
  }
  return loadJob(jobId)
}

export function apply(ctx: Context) {
  registerHarnessHandlers()
  void startServer()
    .then((out) => {
      console.log(`[cursor-coding] ${out.detail}`)
    })
    .catch((err) => {
      console.warn(`[cursor-coding] 启动失败：${String(err)}`)
    })

  ctx.tools.register(
    defineTool({
      name: 'zr_cursor_begin',
      description:
        '【Cursor 写码·主入口】禁止 Bash/Write 直接改用户工程。' +
        '入口级新增/删除页面·菜单：先 ask_user_question，答完再调本工具（clarified=true）。' +
        '本工具成功路径是阻塞确认卡，不是空返回；禁止对用户说「已发出确认卡」除非工具卡已出现。' +
        '小改且意图清晰 → 直接本工具出确认卡。本会话已有写码后优先 zr_cursor_continue。',
      parameters: {
        workspace: {
          type: 'string',
          required: true,
          description: '当前会话工作区绝对路径（必填，支持 ~/…）',
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
      },
      timeoutMs: 20 * 60 * 1000,
      output: {
        schema: JSON_OUTPUT_SCHEMA,
        render: chatBodyRender,
        presentationMeta: ccPresentationMeta,
      },
      async execute(args, exec) {
        await startServer()
        const cfg = loadConfig()
        if (!cursorKeyReady(cfg)) {
          return asJson({
            ok: false,
            show_error: true,
            detail: '请先到「设置 → Cursor 写码」填写 Cursor API Key。',
            chat_body: '请先到「设置 → Cursor 写码」填写 Cursor API Key。',
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
            chat_body: '',
            source: 'cursor_coding',
            cursor_coding_ui: { kind: 'await_ask_user', requirement: message },
          })
        }
        const abs = expandWorkspace(workspace)
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
        return waitConfirmThenStart({
          workspace: abs,
          requirement: gate.requirement,
          parentJobId,
          callId: execCallId(exec),
          sessionId: sid,
          signal: exec?.signal,
        })
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'zr_cursor_continue',
      description:
        '【Cursor 写码·续改】同首轮。入口级新增/删除：先 ask_user_question，答完再调本工具出确认卡。' +
        '空返回不是确认卡。够改则确认卡→开工→正文结论。禁止对旧 job 再 finish。' +
        FOLLOWUP_AGENT_HINT,
      parameters: {
        workspace: {
          type: 'string',
          required: true,
          description: '当前会话工作区绝对路径（支持 ~/…）',
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
      },
      timeoutMs: 20 * 60 * 1000,
      output: {
        schema: JSON_OUTPUT_SCHEMA,
        render: chatBodyRender,
        presentationMeta: ccPresentationMeta,
      },
      async execute(args, exec) {
        await startServer()
        const cfg = loadConfig()
        if (!cursorKeyReady(cfg)) {
          return asJson({
            ok: false,
            show_error: true,
            detail: '请先到「设置 → Cursor 写码」填写 Cursor API Key。',
            chat_body: '请先到「设置 → Cursor 写码」填写 Cursor API Key。',
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
            chat_body: '',
            source: 'cursor_coding',
            cursor_coding_ui: { kind: 'await_ask_user', requirement: message },
          })
        }
        const abs = expandWorkspace(workspace)
        const sid = execSessionId(exec)
        if (!parentId) {
          parentId =
            findLatestJobForSession({
              workspace: abs,
              session_id: sid,
              statuses: ['succeeded', 'pending_review'],
            })?.id || ''
          // 宿主未传 sessionId 时：同工作区最近成功任务兜底（仅 continue，避免续改找不到 parent）
          if (!parentId && !sid) {
            parentId =
              findLatestJobForSession({
                workspace: abs,
                statuses: ['succeeded', 'pending_review'],
                allowWorkspaceFallback: true,
              })?.id || ''
          }
        }
        return waitConfirmThenStart({
          workspace: abs,
          requirement: gate.requirement,
          parentJobId: parentId || undefined,
          callId: execCallId(exec),
          sessionId: sid,
          signal: exec?.signal,
        })
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'zr_cursor_finish',
      description:
        '【Cursor 写码·收结论·兜底】通常 zr_cursor_begin/continue 结束时已写入正文结论。' +
        '仅当 begin/continue 超时未带结论、或需按 job_id 补出结论时调用。' +
        '禁止对上一轮已交付结论的 job 重复调用；新诉求请 zr_cursor_continue。',
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
              '缺少 job_id。请等待 zr_cursor_begin/continue 返回；若已返回结论则不必再调 finish。',
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
            source: 'cursor_coding',
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
        if (!FINISH_DONE.has(doneJob.status || '') && doneJob.status !== 'pending_review') {
          return asJson({
            ok: false,
            done: false,
            show_error: true,
            job_id: jobId,
            status: doneJob.status,
            chat_body:
              `等待写码结束超时（job \`${jobId}\`，状态 ${doneJob.status || '未知'}）。请再调一次 zr_cursor_finish。`,
          })
        }
        return buildConclusionToolResult({
          jobId,
          kind: doneJob.parent_job_id ? 'continue' : 'live',
          workspace: doneJob.workspace,
          requirement: doneJob.requirement,
          parentJobId: doneJob.parent_job_id || undefined,
          confirmToken,
          base,
        })
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'zr_cursor_wait',
      description:
        '【排障用】仅当 zr_cursor_finish 不可用时短轮询。日常写码请用 zr_cursor_finish 一次收结论。',
      parameters: {
        job_id: { type: 'string', required: true, description: '任务 id' },
      },
      timeoutMs: 30_000,
      output: {
        schema: JSON_OUTPUT_SCHEMA,
        render: chatBodyRender,
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
          job = (await pollJobLocal(jobId, exec?.signal, 8_000)) || job
        }
        if (WAIT_DONE.has(job.status || '')) {
          return asJson({
            ok: true,
            done: true,
            job_id: jobId,
            status: job.status,
            detail: job.detail || '',
            review_in_scope: job.review_in_scope || [],
            review_deferred: job.review_deferred || job.deferred_files || [],
            chat_body: buildDoneBody(jobId),
            source: 'cursor_coding',
          })
        }
        return asJson({
          ok: true,
          done: false,
          silent: true,
          job_id: jobId,
          status: job.status,
          detail: job.detail || '仍在运行',
          chat_body: '',
          source: 'cursor_coding',
        })
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'zr_cursor_apply',
      description:
        '【Cursor 写码·同步】用户在对话中确认同步后调用。传入 job_id；files 为空则同步全部 review_in_scope。',
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
      name: 'zr_cursor_status',
      description:
        '【Cursor 写码·状态】查询本机服务与 Key。写码请用 zr_cursor_begin。',
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
          '形态：默认子进程隔离（崩了不拖垮聊天）；CURSOR_CODING_SERVER_MODE=inplace 可回退同进程',
          '兼容：GET /health → compat（WorkBuddy / 运行时 / 插件 / Cursor SDK）',
          `Cursor API Key：${cursorKeyReady(cfg) ? '已配置' : '未配置（硬性要求，请到设置页填写）'}`,
          `数据目录：${cfg.dataRoot}`,
          `交互：begin 秒回 → zr_cursor_wait 拉进度 → 待审后 zr_cursor_apply`,
        ]
        return { summary: lines.join('\n') }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'zr_cursor_job',
      description: '查询 Cursor 写码任务状态。',
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
      name: 'zr_cursor_cancel',
      description: '取消进行中的 Cursor 写码任务。',
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
      name: 'zr_cursor_jobs',
      description: '列出最近 Cursor 写码任务。参数 ignore 传空字符串。',
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
        if (!jobs.length) return { summary: '暂无任务。写码请调用 zr_cursor_begin。' }
        return { summary: jobs.map(jobSummary).join('\n') }
      },
    }),
  )

  console.log(
    '[cursor-coding] 插件已加载：zr_cursor_begin/continue/finish/apply（进度卡 + 正文结论）',
  )
}

export async function dispose() {
  await stopServer()
}
