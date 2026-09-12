/**
 * @zhongruan/dsh-cursor-coding — 独立 DSH Bundle
 * 硬约束：工具名 zr_cursor_*；设置页挂 DSH 插槽；改码仅 Cursor。
 *
 * 【主流程已冻结 · 见 docs/04-…/Cursor写码插件-主流程冻结.md】
 * ask_user_question → begin 确认卡阻塞 → 点确认 → 进度卡 → finish 正文结论
 * 禁止随意改主流程；仅细节优化。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { cursorKeyReady, loadConfig, publicConfigView } from './config.js'
import { findLatestSucceeded, jobSummary, listJobs, loadJob } from './jobs.js'
import { applyJobReview } from './orchestrator/runJob.js'
import { createPendingConfirm, findLatestPendingForWorkspace, loadPendingConfirm } from './pendingConfirm.js'
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

function truthy(v: unknown): boolean {
  if (v === true || v === 1) return true
  const s = String(v ?? '')
    .trim()
    .toLowerCase()
  return s === 'true' || s === '1' || s === 'yes' || s === 'y' || s === '确认' || s === 'ok'
}

/** 新增/删除/大改且信息不足时，禁止直接开工（须先走 DSH 原生 ask_user_question） */
function needsRequirementClarify(message: string, clarified?: unknown): boolean {
  if (truthy(clarified)) return false
  const m = String(message || '').trim()
  if (!m) return true
  // 已带较完整规格（用户已答过选项或一次说清）
  const rich =
    m.length >= 80 &&
    (/验收|字段|筛选|指标|图表|表格|菜单|路由|接口|放在|布局|选项已确认|ask_user|仅删|只删|保留/.test(m) ||
      (m.match(/[1-9]、|^\s*\d+[\.、]|：/m) || []).length >= 2)
  if (rich) return false
  // 明确小改（不含删页面/菜单/报表）
  if (
    /改文案|改颜色|改样式|按钮.*大|修bug|修复|续改|再改|微调|字号/.test(m) &&
    !/新增|新建|新做|删除|移除|去掉/.test(m)
  ) {
    return false
  }
  // 删除也是写码：删报表/页面/菜单/模块/功能须先澄清
  if (/删除|移除|去掉|下线|废弃|卸载/.test(m)) {
    if (/(报表|页面|模块|菜单|功能|路由|入口|接口)/.test(m)) return true
    if (m.length < 60) return true
  }
  // 新增 / 大改
  if (/新增|新建|新做|增加|加一个|做一个|开发一个/.test(m)) return true
  if (/(报表|页面|模块|菜单|功能).{0,8}(新增|增加|新|删除|移除)/.test(m)) return true
  if (/报表中心/.test(m) && m.length < 80) return true
  return false
}

/** Agent 面向说明（写入 detail，不进正文） */
const CLARIFY_AGENT_HINT =
  '新增/删除/大改须先调用 ask_user_question。删除报表/页面/菜单同写码须澄清。' +
  '用户提交后 zr_cursor_begin(clarified=true)；begin 会停在确认卡直到用户点确认（期间禁止 finish、禁止输出文字）。' +
  '确认后 begin 返回 job_id，再 zr_cursor_finish(job_id|workspace) 收结论。'

/** begin：出确认卡并阻塞到用户点确认、Job 已创建；确认前不写码、不进 finish */
async function waitConfirmThenStart(opts: {
  workspace: string
  requirement: string
  parentJobId?: string
  signal?: AbortSignal
}): Promise<JsonValue> {
  await startServer()
  const cfg = loadConfig()
  const base = getListenAddr() || publicConfigView(cfg).base
  const workspace = expandWorkspace(opts.workspace)
  const requirement = String(opts.requirement || '').trim()
  const pending = createPendingConfirm({
    workspace,
    requirement,
    parent_job_id: opts.parentJobId,
  })
  const deadline = Date.now() + 14 * 60 * 1000
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) throw new Error('已取消')
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
      const job = loadJob(row.job_id)
      const status = job?.status || 'queued'
      return asJson({
        ok: true,
        started: true,
        pending_confirm: false,
        confirm_token: pending.id,
        job_id: row.job_id,
        status,
        detail: job?.detail || '用户已确认，Cursor 已启动',
        chat_body: '',
        silent: true,
        cursor_coding_ui: {
          kind: 'live',
          job_id: row.job_id,
          workspace,
          requirement,
          service: base,
          status,
          stage: 'F-enterprise-ux',
          review_in_scope: job?.review_in_scope || [],
          review_deleted: job?.review_deleted || [],
          review_deferred: job?.review_deferred || job?.deferred_files || [],
        },
        source: 'cursor_coding',
      })
    }
    await sleep(1000, opts.signal)
  }
  return asJson({
    ok: false,
    silent: true,
    confirm_token: pending.id,
    detail: '等待用户点确认超时',
    chat_body: '',
  })
}

/**
 * 聊天正文门禁：确认卡/进度卡过程中正文必须为空；
 * 仅 finish 成功（done=true）才输出「本轮结论」。
 */
function chatBodyRender(_args: unknown, value: unknown) {
  const v = value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  if (!v) return textBlocks('')
  if (v.pending_confirm === true || v.need_clarify === true || v.silent === true) {
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
  // 澄清阶段不挂等待卡，避免挡住/干扰 ask_user_question 原生选项卡
  if (v && v.need_clarify === true) {
    return asJson({ cc: { ui: null } })
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
  const asst = (job.assistant_text || '').trim()
  const synced = job.synced_files || job.last_synced_files || job.review_in_scope || []
  const deferred = job.review_deferred || job.deferred_files || []
  const lines: string[] = [`## 本轮结论`, ``]
  if (asst) {
    const clip = asst.length > 3500 ? asst.slice(0, 3500) + '\n\n…[已截断]' : asst
    lines.push(clip, ``)
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
    lines.push(``, `**范围外未同步 ${deferred.length} 个**（可扩大写范围后重试）：`)
    for (const f of deferred.slice(0, 15)) lines.push(`- ${f}`)
  }
  lines.push(``)
  lines.push(`请自行打开页面确认编码效果。`)
  lines.push(``)
  lines.push(`如需调整，请直接在本对话继续说明（例如：按钮再大一点 / 筛选加日期），我会按续改处理。`)
  return lines.join('\n')
}

/** 终态正文：精简（排障用） */
function buildDoneBody(jobId: string): string {
  return buildChatConclusionBody(jobId)
}

const TERMINAL = new Set([
  'pending_review',
  'succeeded',
  'failed',
  'cancelled',
  'blocked_no_runner',
])

/** finish 必须等到真正落盘结束；pending_review 仅在人工审模式停留过久时才返回 */
const FINISH_DONE = new Set(['succeeded', 'failed', 'cancelled', 'blocked_no_runner'])

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
    if (TERMINAL.has(job.status || '')) return job
    const sig = `${job.status}|${job.detail}|${(job.transcript || []).length}|${(job.thinking_text || '').length}`
    if (prev && sig !== prev && Date.now() - start >= 1500) {
      // 有进展就早点回，让正文能刷出来
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
        '【Cursor 写码·主入口】禁止 mes_code_dev_* / Bash/Write 改用户工程。' +
        '必须：message + workspace。新增/删除/大改须先 ask_user_question，再 clarified=true。' +
        '本工具会先出确认卡并**阻塞到用户点击确认**（确认前不写码；你不要输出任何文字、不要调 finish）。' +
        '用户确认并开工后才返回 job_id；随后同轮立刻 zr_cursor_finish(job_id 或 workspace) 等进度结束再出正文结论。' +
        '一步一步：澄清 → 确认卡（停）→ 用户点确认 → 进度卡 → 结论。',
      parameters: {
        workspace: {
          type: 'string',
          required: true,
          description: '当前会话工作区绝对路径（必填，支持 ~/…）',
        },
        message: {
          type: 'string',
          required: true,
          description: '用户本轮原话/写码诉求；澄清后须附上 ask_user_question 的选项结论',
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
        if (needsRequirementClarify(message, clarified)) {
          return asJson({
            ok: false,
            need_clarify: true,
            silent: true,
            started: false,
            workspace: expandWorkspace(workspace),
            detail: CLARIFY_AGENT_HINT,
            chat_body: '',
            source: 'cursor_coding',
          })
        }
        return waitConfirmThenStart({
          workspace,
          requirement: message,
          signal: exec?.signal,
        })
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'zr_cursor_continue',
      description:
        '【Cursor 写码·续改】message + workspace；先出确认卡并阻塞到用户点确认；' +
        '确认前禁止输出文字、禁止 finish。确认开工后返回 job_id，再 zr_cursor_finish(job_id|workspace)。',
      parameters: {
        workspace: {
          type: 'string',
          required: true,
          description: '当前会话工作区绝对路径（支持 ~/…）',
        },
        message: {
          type: 'string',
          required: true,
          description: '续改原话',
        },
        parent_job_id: {
          type: 'string',
          description: '可选：上次成功/待审任务 id',
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
        if (!parentId) {
          parentId = findLatestSucceeded(abs)?.id || ''
        }
        return waitConfirmThenStart({
          workspace: abs,
          requirement: message,
          parentJobId: parentId || undefined,
          signal: exec?.signal,
        })
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'zr_cursor_finish',
      description:
        '【Cursor 写码·收结论】仅在 zr_cursor_begin **已返回 job_id**（用户已点确认）之后调用。' +
        '确认卡等待期间禁止调用本工具。' +
        '传 job_id 或 workspace；阻塞到写码与自动同步完成，再把「本轮结论」写入聊天正文。过程中禁止对用户说话。',
      parameters: {
        workspace: {
          type: 'string',
          description: '与 begin 相同的工作区路径',
        },
        confirm_token: {
          type: 'string',
          description: '可选',
        },
        job_id: { type: 'string', description: 'begin 返回的 job_id（推荐）' },
      },
      timeoutMs: 20 * 60 * 1000,
      output: {
        schema: JSON_OUTPUT_SCHEMA,
        render: chatBodyRender,
      },
      async execute(args, exec) {
        await startServer()
        let jobId = String((args && (args as { job_id?: string }).job_id) || '').trim()
        let confirmToken = String(
          (args && (args as { confirm_token?: string }).confirm_token) || '',
        ).trim()
        const workspace = expandWorkspace(
          String((args && (args as { workspace?: string }).workspace) || '').trim(),
        )
        if (!jobId && !confirmToken && workspace) {
          const pending0 = findLatestPendingForWorkspace(workspace)
          if (pending0?.job_id) jobId = pending0.job_id
          else if (pending0?.id) confirmToken = pending0.id
        }
        if (!jobId && confirmToken) {
          const pending = loadPendingConfirm(confirmToken)
          if (pending?.job_id) jobId = pending.job_id
        }
        // 用户未点确认：立刻返回，绝不在 finish 里干等（避免确认卡阶段疯狂转思考）
        if (!jobId) {
          return asJson({
            ok: false,
            silent: true,
            detail:
              '用户尚未点确认卡，尚无 job_id。请只等待 zr_cursor_begin 返回（阻塞在确认卡），不要并行调 finish。',
            chat_body: '',
          })
        }
        const deadline = Date.now() + 15 * 60 * 1000
        let pendingSince = 0

        while (Date.now() < deadline) {
          if (exec?.signal?.aborted) throw new Error('已取消')
          const job = loadJob(jobId)
          if (!job) {
            return asJson({
              ok: false,
              silent: true,
              detail: `任务不存在：${jobId}`,
              chat_body: '',
            })
          }
          const st = job.status || ''
          if (FINISH_DONE.has(st)) {
            return asJson({
              ok: true,
              done: true,
              job_id: jobId,
              status: st,
              detail: job.detail || '',
              synced_files: job.synced_files || job.last_synced_files || [],
              chat_body: buildChatConclusionBody(jobId),
              source: 'cursor_coding',
            })
          }
          if (st === 'pending_review') {
            const autoRaw = String(process.env.CURSOR_CODING_AUTO_APPLY || '1').trim().toLowerCase()
            const autoOn = !(autoRaw === '0' || autoRaw === 'false' || autoRaw === 'off' || autoRaw === 'no')
            const syncing = /自动同步|同步中/.test(String(job.detail || ''))
            if (autoOn || syncing) {
              pendingSince = 0
            } else {
              if (!pendingSince) pendingSince = Date.now()
              if (Date.now() - pendingSince > 12_000) {
                return asJson({
                  ok: true,
                  done: true,
                  job_id: jobId,
                  status: st,
                  detail: job.detail || '',
                  chat_body: buildChatConclusionBody(jobId),
                  source: 'cursor_coding',
                })
              }
            }
          } else {
            pendingSince = 0
          }
          await sleep(1500, exec?.signal)
        }
        const late = loadJob(jobId)
        return asJson({
          ok: false,
          done: false,
          show_error: true,
          job_id: jobId,
          status: late?.status || '',
          chat_body:
            `等待写码结束超时（job \`${jobId}\`，状态 ${late?.status || '未知'}）。请再调一次 zr_cursor_finish。`,
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
        // 先读一次：已终态则立刻返回（不睡）
        let job = loadJob(jobId)
        if (!job) {
          return asJson({ ok: false, detail: `任务不存在：${jobId}`, chat_body: `任务不存在：${jobId}` })
        }
        if (!TERMINAL.has(job.status || '')) {
          job = (await pollJobLocal(jobId, exec?.signal, 8_000)) || job
        }
        if (TERMINAL.has(job.status || '')) {
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
          job_id: jobId,
          status: job.status,
          detail: job.detail || '仍在运行',
          chat_body: buildProgressBody(jobId),
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
          `服务：${isServerRunning() ? '本进程已监听' : '未监听'} ${getListenAddr() || view.base}`,
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
        await startServer()
        const id = String(args.job_id || '').trim()
        const cfg = loadConfig()
        const base = getListenAddr() || publicConfigView(cfg).base
        try {
          const res = await fetch(`${base}/api/cursor-coding/jobs/${encodeURIComponent(id)}/cancel`, {
            method: 'POST',
            signal: AbortSignal.timeout(5000),
          })
          const data = (await res.json()) as { ok?: boolean; detail?: string; job?: { status?: string } }
          if (!res.ok || !data.ok) return { summary: data.detail || `取消失败 HTTP ${res.status}` }
          return { summary: `已取消 ${id}（${data.job?.status || 'cancelled'}）` }
        } catch (err) {
          return { summary: `取消失败：${String(err)}` }
        }
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
