/**
 * @zhongruan/dsh-cursor-chat — 对话式多轮写码（与 dsh-cursor-coding 并存、互不影响）
 * 工具名 zr_cchat_*；端口 18789；数据 ~/.zhongruan/cursor-chat。
 *
 * 主路径：用户原话 → 确认卡 → Cursor（薄 prompt）→ 同步 → 正文结论
 * 续改：zr_cchat_continue → 优先 Agent.resume 同一 agent_id
 * 不强制旧插件澄清门禁；确认前不写盘。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { cursorKeyReady, defaultDataRoot, loadConfig, publicConfigView } from './config.js'
import { findLatestJobForSession, forceCancelJob, jobSummary, listJobs, loadJob, patchJob } from './jobs.js'
import { applyJobReview, healStalePendingReview } from './orchestrator/runJob.js'
import { createPendingConfirm, cancelPendingConfirm, loadPendingConfirm } from './pendingConfirm.js'
import { looksLikeFollowUp } from './requirementGate.js'
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

const FOLLOWUP_AGENT_HINT =
  '续改：把用户最新原话原样传入 message；优先 zr_cchat_continue（同会话 resume）。' +
  '确认卡→进度→正文结论。禁止对旧 job 再 finish。'

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
    chat_body: formatChatConclusion(fresh),
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
      // 终态已落盘：让 SSE 把带 job_id 的 done 送到进度卡。工具一返回宿主可能冻住 toolview。
      const updated = Date.parse(String(job.updated_at || '')) || 0
      const age = updated ? Date.now() - updated : 0
      if (age >= 0 && age < 700) await sleep(700 - age, signal)
      return loadJob(jobId)
    }
    if (st === 'pending_review') {
      const autoRaw = String(process.env.CURSOR_CHAT_AUTO_APPLY || '1').trim().toLowerCase()
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
  images?: ChatImageRef[]
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
    images: opts.images,
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
            `等待写码结束超时（job \`${jobId}\`，状态 ${doneJob.status || '未知'}）。请再调一次 zr_cchat_finish(job_id)。`,
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

/**
 * 聊天正文门禁：确认卡/进度过程中正文为空；
 * begin/continue/finish 在 done=true 时输出「本轮结论」（凡写码必有结论）。
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
  if (v && v.cursor_chat_ui && typeof v.cursor_chat_ui === 'object') {
    return asJson({ cc: { ui: v.cursor_chat_ui } })
  }
  // 澄清：显式挂 await_ask_user，前端禁止出确认卡
  if (v && (v.need_clarify === true || v.need_clarify === 'true')) {
    return asJson({ cc: { ui: { kind: 'await_ask_user' } } })
  }
  return asJson({ cc: { ui: null } })
}

/** 会话日志 / 聊天正文权威内容 = chat_body，避免宿主只展示模型一句短复述。 */
function finalizeChatBody(
  _exec: unknown,
  result: { isError?: boolean; value?: unknown; content?: unknown },
): ReturnType<typeof textBlocks> | undefined {
  if (!result || result.isError) return undefined
  const v = asToolValue(result.value)
  const body = v && typeof v.chat_body === 'string' ? v.chat_body.trim() : ''
  if (body) return textBlocks(body)
  return undefined
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
  const lastThink = (job.thinking_text || '').trim().slice(-280)
  const lastAsst = (job.assistant_text || '').trim().slice(-280)
  const lines = [
    `**Cursor 对话写码进行中**`,
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
  lines.push(`请再调 \`zr_cchat_wait\`（job_id=\`${job.id}\`）；未完成前勿空等。`)
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
      console.log(`[cursor-chat] ${out.detail}`)
    })
    .catch((err) => {
      console.warn(`[cursor-chat] 启动失败：${String(err)}`)
    })

  ctx.tools.register(
    defineTool({
      name: 'zr_cchat_begin',
      description:
        '【Cursor 对话写码·主入口】像跟 Cursor IDE 聊：用户原话 + 可选截图进 Cursor 多模态改盘。' +
        '禁止 Bash/Write 直接改用户工程。成功路径是阻塞确认卡，不是空返回。' +
        '用户贴了图：把本机图片绝对路径（或 data URL）放进 images 参数；有图必须传，勿只靠文字复述。' +
        '本会话已有成功写码后的补充/修正 → 优先 zr_cchat_continue。' +
        '与 zr_cursor_*（旧写码插件）不同；要「聊着改 / 看图改」用本工具。',
      parameters: {
        workspace: {
          type: 'string',
          required: true,
          description: '当前会话工作区绝对路径（必填，支持 ~/…）',
        },
        message: {
          type: 'string',
          required: true,
          description: '用户本轮诉求原文（勿改写、勿套模板）',
        },
        images: {
          type: 'string',
          description:
            '可选附图。JSON 数组：[{"path":"绝对路径"}] 或 [{"data":"base64","mimeType":"image/png"}] 或 [{"url":"https://..."}]；也可传单个绝对路径字符串。用户贴图时务必填。',
        },
      },
      timeoutMs: 20 * 60 * 1000,
      output: {
        schema: JSON_OUTPUT_SCHEMA,
        render: chatBodyRender,
        presentationMeta: ccPresentationMeta,
      },
      finalizeContent: finalizeChatBody,
      async execute(args, exec) {
        await startServer()
        const cfg = loadConfig()
        if (!cursorKeyReady(cfg)) {
          return asJson({
            ok: false,
            show_error: true,
            detail: '请先到「设置 → Cursor 对话写码」填写 Cursor API Key。',
            chat_body: '请先到「设置 → Cursor 对话写码」填写 Cursor API Key。',
          })
        }
        const workspace = String((args && (args as { workspace?: string }).workspace) || '').trim()
        const message = String((args && (args as { message?: string }).message) || '').trim()
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
        const abs = expandWorkspace(workspace)
        const { refs: images, note: imageNote } = collectToolImages(args, exec, abs)
        const sid = execSessionId(exec)
        let parentJobId: string | undefined
        const latest = findLatestJobForSession({
          workspace: abs,
          session_id: sid,
          statuses: ['succeeded', 'pending_review'],
        })
        if (latest && looksLikeFollowUp(message)) {
          parentJobId = latest.id
        }
        if (imageNote) {
          console.warn('[cursor-chat]', imageNote)
        }
        return waitConfirmThenStart({
          workspace: abs,
          requirement: message,
          images,
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
      name: 'zr_cchat_continue',
      description:
        '【Cursor 对话写码·续改】同会话多轮：用户最新原话 + 可选新截图；优先 resume 上一轮 Agent。' +
        FOLLOWUP_AGENT_HINT +
        ' 有新图时同样传入 images。',
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
        images: {
          type: 'string',
          description:
            '可选附图（本轮新截图）。JSON 数组 path/data/url，或单个绝对路径。有图务必传。',
        },
      },
      timeoutMs: 20 * 60 * 1000,
      output: {
        schema: JSON_OUTPUT_SCHEMA,
        render: chatBodyRender,
        presentationMeta: ccPresentationMeta,
      },
      finalizeContent: finalizeChatBody,
      async execute(args, exec) {
        await startServer()
        const cfg = loadConfig()
        if (!cursorKeyReady(cfg)) {
          return asJson({
            ok: false,
            show_error: true,
            detail: '请先到「设置 → Cursor 对话写码」填写 Cursor API Key。',
            chat_body: '请先到「设置 → Cursor 对话写码」填写 Cursor API Key。',
          })
        }
        const workspace = String((args && (args as { workspace?: string }).workspace) || '').trim()
        const message = String((args && (args as { message?: string }).message) || '').trim()
        let parentId = String((args && (args as { parent_job_id?: string }).parent_job_id) || '').trim()
        if (!workspace || !message) {
          return asJson({
            ok: false,
            show_error: true,
            detail: 'workspace 与 message 均必填。',
            chat_body: '续改需要工作区路径和诉求原文。',
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
        return waitConfirmThenStart({
          workspace: abs,
          requirement: message,
          images,
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
      name: 'zr_cchat_finish',
      description:
        '【Cursor 对话写码·收结论·兜底】通常 zr_cchat_begin/continue 结束时已写入正文结论。' +
        '仅当 begin/continue 超时未带结论、或需按 job_id 补出结论时调用。' +
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
        if (!FINISH_DONE.has(doneJob.status || '') && doneJob.status !== 'pending_review') {
          return asJson({
            ok: false,
            done: false,
            show_error: true,
            job_id: jobId,
            status: doneJob.status,
            chat_body:
              `等待写码结束超时（job \`${jobId}\`，状态 ${doneJob.status || '未知'}）。请再调一次 zr_cchat_finish。`,
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
      name: 'zr_cchat_wait',
      description:
        '【排障用】仅当 zr_cchat_finish 不可用时短轮询。日常写码请用 zr_cchat_finish 一次收结论。',
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
            source: 'cursor_chat',
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
          source: 'cursor_chat',
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
          `交互：begin 秒回 → zr_cchat_wait 拉进度 → 待审后 zr_cchat_apply`,
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
