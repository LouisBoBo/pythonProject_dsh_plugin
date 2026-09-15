/**
 * 本机 loopback HTTP：配置 / HITL / confirm / jobs / SSE。
 * 仅绑定 127.0.0.1；阶段 A：confirm 后后台沙箱 → Cursor → 受限同步。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, type ChildProcess } from 'node:child_process'
import {
  applyConfigFromUi,
  cursorKeyReady,
  editableConfigView,
  loadConfig,
  publicConfigView,
  SERVICE_NAME,
} from './config.js'
import { checkCompat, readPluginVersion } from './compat.js'
import { consume, issue } from './hitl.js'
import {
  createJob,
  findLatestJobForSession,
  forceCancelJob,
  jobSummary,
  listJobs,
  loadJob,
  saveJob,
  setStatus,
} from './jobs.js'
import { runJobBackground, applyJobReview, steerJobBackground, healStalePendingReview, recoverOrphanRunningJobs } from './orchestrator/runJob.js'
import { expandWriteScopeWithCompanions } from './scopeCompanions.js'
import { needsRequirementClarify } from './requirementGate.js'
import {
  browserOriginAllowed,
  isLoopbackBrowserOrigin,
  requestOrigin,
} from './localAccess.js'
import {
  bindPendingJob,
  claimPendingConfirm,
  createPendingConfirm,
  findPendingForCard,
  loadPendingConfirm,
  releasePendingClaim,
} from './pendingConfirm.js'
import { formatDialogMarkdown } from './transcript.js'
import type { HitlAction } from './types.js'

const HERE = dirname(fileURLToPath(import.meta.url))

function consoleHtmlPath(): string {
  const candidates = [
    join(HERE, 'ui', 'console.html'),
    join(HERE, '..', 'src', 'ui', 'console.html'),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return candidates[0]
}

function sendHtml(res: ServerResponse, html: string, req?: IncomingMessage): void {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache',
    ...corsHeaders(req),
  })
  res.end(html)
}

let server: Server | null = null
let listenAddr = ''
/** 当前对外服务形态：inplace=宿主同进程；child=独立子进程 */
let serverMode: 'inplace' | 'child' = 'inplace'
let childProc: ChildProcess | null = null

/** 仅对本机 Origin 回显 ACAO；禁止 *，避免恶意页读 loopback 响应 */
function corsHeaders(req?: IncomingMessage): Record<string, string> {
  const origin = req ? requestOrigin(req) : ''
  if (origin && isLoopbackBrowserOrigin(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
      Vary: 'Origin',
    }
  }
  return {}
}

function send(res: ServerResponse, status: number, body: unknown, req?: IncomingMessage): void {
  const text = JSON.stringify(body, null, 2)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders(req),
  })
  res.end(text)
}

/** 拒绝非本机浏览器 Origin（CSRF / 跨站读） */
function rejectBadOrigin(req: IncomingMessage, res: ServerResponse): boolean {
  if (browserOriginAllowed(req)) return false
  send(
    res,
    403,
    { ok: false, detail: '拒绝非本机 Origin 跨域访问', code: 'origin_forbidden' },
    req,
  )
  return true
}

const MAX_BODY = 1024 * 512

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c) => {
      const buf = Buffer.isBuffer(c) ? c : Buffer.from(c)
      size += buf.length
      if (size > MAX_BODY) {
        req.destroy()
        reject(new Error('请求体过大'))
        return
      }
      chunks.push(buf)
    })
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function pathname(req: IncomingMessage): string {
  try {
    return new URL(req.url || '/', 'http://127.0.0.1').pathname
  } catch {
    return '/'
  }
}

function parseJson(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {}
  const v = JSON.parse(raw) as unknown
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  return v as Record<string, unknown>
}

/** 阶段 A：确认后后台跑沙箱 → Cursor → 同步 */
function startPipeline(jobId: string): void {
  runJobBackground(jobId)
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const cfg = loadConfig()
  const path = pathname(req)
  const method = (req.method || 'GET').toUpperCase()

  if (method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req))
    res.end()
    return
  }

  if (method === 'GET' && (path === '/ui' || path === '/ui/' || path === '/console')) {
    try {
      sendHtml(res, readFileSync(consoleHtmlPath(), 'utf8'), req)
    } catch (err) {
      send(res, 500, { ok: false, detail: '无法读取 console.html：' + String(err) }, req)
    }
    return
  }

  if (method === 'GET' && path === '/') {
    res.writeHead(302, { Location: '/ui', ...corsHeaders(req) })
    res.end()
    return
  }

  if (method === 'GET' && path === '/health') {
    const sampleDelete = '报表中心菜单删除设备维修、设备保养、设备点检报表'
    const pluginVersion = readPluginVersion()
    const compat = checkCompat()
    send(
      res,
      200,
      {
        ok: true,
        service: SERVICE_NAME,
        pluginVersion,
        listen: listenAddr || `http://${cfg.listen}:${cfg.port}`,
        view: publicConfigView(cfg),
        cursorKeyReady: cursorKeyReady(cfg),
        ui: '/ui',
        serverMode: process.env.CURSOR_CODING_SERVER_ROLE === 'child' ? 'child' : serverMode,
        gate: {
          sample: sampleDelete,
          mustClarify: needsRequirementClarify(sampleDelete),
          fakeClarifiedBlocked: needsRequirementClarify(sampleDelete, true),
        },
        compat: {
          ok: compat.ok,
          softOnly: compat.softOnly,
          matrixVersion: compat.matrixVersion,
          detail: compat.detail,
          checks: compat.checks,
        },
        detail: cursorKeyReady(cfg)
          ? '服务就绪；写码前已配置 Cursor API Key'
          : '请到「设置 → Cursor 写码」填写 Cursor API Key（硬性要求）',
      },
      req,
    )
    return
  }

  if (method === 'GET' && path === '/api/config') {
    if (rejectBadOrigin(req, res)) return
    send(
      res,
      200,
      {
        ok: true,
        config: editableConfigView(cfg),
        view: publicConfigView(cfg),
      },
      req,
    )
    return
  }

  if (method === 'PUT' && path === '/api/config') {
    if (rejectBadOrigin(req, res)) return
    let parsed: Record<string, unknown> = {}
    try {
      parsed = parseJson(await readBody(req))
    } catch {
      send(res, 400, { ok: false, detail: 'JSON 无法解析' }, req)
      return
    }
    try {
      const body = (
        parsed.config && typeof parsed.config === 'object' ? parsed.config : parsed
      ) as Record<string, unknown>
      const next = applyConfigFromUi(body)
      send(
        res,
        200,
        {
          ok: true,
          detail: '已保存到本机 ~/.zhongruan/cursor-coding/config.json（未写入任何项目仓库）',
          config: editableConfigView(next),
          view: publicConfigView(next),
          note:
            next.port !== cfg.port || next.listen !== cfg.listen
              ? '端口或监听地址已变更，请重启插件/宿主后生效'
              : undefined,
        },
        req,
      )
    } catch (err) {
      send(res, 400, { ok: false, detail: String(err) }, req)
    }
    return
  }

  if (method === 'POST' && path === '/api/cursor-coding/pending') {
    if (rejectBadOrigin(req, res)) return
    let body: Record<string, unknown> = {}
    try {
      body = parseJson(await readBody(req))
    } catch {
      send(res, 400, { ok: false, detail: 'JSON 无法解析' }, req)
      return
    }
    const workspace = resolve(String(body.workspace || '').trim())
    const requirement = String(body.requirement || '').trim()
    if (!workspace || !requirement) {
      send(res, 400, { ok: false, detail: '缺少 workspace 或 requirement' }, req)
      return
    }
    if (!existsSync(workspace) || !statSync(workspace).isDirectory()) {
      send(res, 400, { ok: false, detail: `工程路径无效：${workspace}` }, req)
      return
    }
    const pending = createPendingConfirm({
      workspace,
      requirement,
      parent_job_id: typeof body.parent_job_id === 'string' ? body.parent_job_id : undefined,
      call_id: typeof body.call_id === 'string' ? body.call_id : undefined,
      session_id: typeof body.session_id === 'string' ? body.session_id : undefined,
    })
    send(
      res,
      200,
      {
        ok: true,
        confirm_token: pending.id,
        pending: {
          confirm_token: pending.id,
          workspace: pending.workspace,
          requirement: pending.requirement,
          status: pending.status,
          created_at: pending.created_at,
        },
      },
      req,
    )
    return
  }

  if (method === 'POST' && path === '/api/hitl/issue') {
    if (rejectBadOrigin(req, res)) return
    let body: Record<string, unknown> = {}
    try {
      body = parseJson(await readBody(req))
    } catch {
      send(res, 400, { ok: false, detail: 'JSON 无法解析' }, req)
      return
    }
    const action = String(body.action || '').trim() as HitlAction
    if (
      action !== 'cursor-coding.confirm' &&
      action !== 'cursor-coding.apply' &&
      action !== 'cursor-coding.steer' &&
      action !== 'cursor-coding.cancel'
    ) {
      send(
        res,
        400,
        {
          ok: false,
          detail: 'action 须为 cursor-coding.confirm / apply / steer / cancel',
        },
        req,
      )
      return
    }
    // confirm：必须绑定有效 waiting pending，禁止无卡签发 nonce
    if (action === 'cursor-coding.confirm') {
      const confirmToken = String(body.confirm_token || '').trim()
      if (!confirmToken) {
        send(
          res,
          400,
          {
            ok: false,
            code: 'confirm_token_required',
            detail: '签发 confirm 须携带 confirm_token',
          },
          req,
        )
        return
      }
      const pending = loadPendingConfirm(confirmToken)
      if (!pending || pending.status === 'cancelled') {
        send(res, 400, { ok: false, detail: '确认令牌无效', code: 'pending_invalid' }, req)
        return
      }
      if (pending.status !== 'waiting' && pending.status !== 'claiming') {
        send(res, 400, { ok: false, detail: '确认单已不可签发', code: 'pending_not_waiting' }, req)
        return
      }
      const issued = issue({
        action,
        workspace: pending.workspace,
        requirement: pending.requirement,
        confirm_token: pending.id,
      })
      send(res, 200, issued, req)
      return
    }
    if (action === 'cursor-coding.cancel') {
      const jobId = String(body.job_id || '').trim()
      if (!jobId) {
        send(res, 400, { ok: false, detail: '签发 cancel 须携带 job_id' }, req)
        return
      }
      const job = loadJob(jobId)
      if (!job) {
        send(res, 404, { ok: false, detail: '任务不存在' }, req)
        return
      }
      const issued = issue({
        action,
        workspace: job.workspace,
        job_id: job.id,
      })
      send(res, 200, issued, req)
      return
    }
    const issued = issue({
      action,
      workspace: typeof body.workspace === 'string' ? body.workspace : undefined,
      requirement: typeof body.requirement === 'string' ? body.requirement : undefined,
      job_id: typeof body.job_id === 'string' ? body.job_id : undefined,
    })
    send(res, 200, issued, req)
    return
  }

  if (method === 'POST' && path === '/api/cursor-coding/confirm') {
    if (rejectBadOrigin(req, res)) return
    if (!cursorKeyReady(cfg)) {
      send(
        res,
        403,
        {
          ok: false,
          code: 'cursor_key_required',
          detail: '使用写码前必须配置 Cursor API Key（设置 → Cursor 写码）',
        },
        req,
      )
      return
    }
    let body: Record<string, unknown> = {}
    try {
      body = parseJson(await readBody(req))
    } catch {
      send(res, 400, { ok: false, detail: 'JSON 无法解析' }, req)
      return
    }
    const nonce = String(body.nonce || body.hitl_nonce || '').trim()
    const confirmToken = String(body.confirm_token || '').trim()
    if (!confirmToken) {
      send(
        res,
        400,
        {
          ok: false,
          code: 'confirm_token_required',
          detail: '缺少 confirm_token：须先 zr_cursor_begin 出确认卡，用户点确认后再开工',
        },
        req,
      )
      return
    }
    const pending0 = loadPendingConfirm(confirmToken)
    if (!pending0 || pending0.status === 'cancelled') {
      send(res, 400, { ok: false, detail: `确认令牌无效：${confirmToken}` }, req)
      return
    }
    // 幂等：已开工直接返回
    if ((pending0.status === 'started' || pending0.status === 'claiming') && pending0.job_id) {
      send(
        res,
        200,
        {
          ok: true,
          job_id: pending0.job_id,
          job: loadJob(pending0.job_id),
          detail: '该确认已开工',
          stream: `/api/cursor-coding/jobs/${encodeURIComponent(pending0.job_id)}/stream`,
        },
        req,
      )
      return
    }
    // 诉求/工作区以 pending 为准，避免卡上 lastUserUtterance 与 Agent message 不一致导致 400
    const abs = resolve(pending0.workspace)
    const requirement = pending0.requirement
    const parentJobId =
      String(pending0.parent_job_id || body.parent_job_id || '').trim() || null
    if (!requirement) {
      send(res, 400, { ok: false, detail: '确认单缺少诉求' }, req)
      return
    }
    if (!existsSync(abs)) {
      send(res, 400, { ok: false, detail: `工程路径不存在：${abs}` }, req)
      return
    }
    try {
      if (!statSync(abs).isDirectory()) {
        send(res, 400, { ok: false, detail: `工程路径须为目录：${abs}` }, req)
        return
      }
    } catch {
      send(res, 400, { ok: false, detail: `无法读取工程路径：${abs}` }, req)
      return
    }
    // HITL 绑定 pending 上的 workspace/requirement + confirm_token
    const hitl = consume({
      nonce,
      action: 'cursor-coding.confirm',
      workspace: abs,
      requirement,
      confirm_token: confirmToken,
    })
    if (!hitl.ok) {
      send(res, 401, { ok: false, detail: hitl.detail, code: hitl.code }, req)
      return
    }
    const claimed = claimPendingConfirm(confirmToken)
    if (!claimed.ok) {
      if (claimed.pending?.job_id) {
        send(
          res,
          200,
          {
            ok: true,
            job_id: claimed.pending.job_id,
            job: loadJob(claimed.pending.job_id),
            detail: '该确认已开工',
            stream: `/api/cursor-coding/jobs/${encodeURIComponent(claimed.pending.job_id)}/stream`,
          },
          req,
        )
        return
      }
      send(
        res,
        409,
        {
          ok: false,
          code: claimed.code || 'pending_busy',
          detail: claimed.detail || '确认正在处理中，请稍候',
        },
        req,
      )
      return
    }
    if (parentJobId) {
      const parent = loadJob(parentJobId)
      if (!parent) {
        releasePendingClaim(confirmToken)
        send(res, 400, { ok: false, detail: `parent_job_id 不存在：${parentJobId}` }, req)
        return
      }
      if (parent.workspace !== abs) {
        releasePendingClaim(confirmToken)
        send(
          res,
          400,
          {
            ok: false,
            detail: '续改要求 parent 与当前 workspace 一致；否则请走首轮 begin',
          },
          req,
        )
        return
      }
    }
    let job
    try {
      job = createJob({
        workspace: abs,
        requirement,
        parent_job_id: parentJobId,
        dsh_session_id: pending0.session_id || null,
        dsh_call_id: pending0.call_id || null,
        write_scope: expandWriteScopeWithCompanions(cfg.writeScope),
        continue_count: parentJobId ? (loadJob(parentJobId)?.continue_count || 0) + 1 : 0,
      })
      bindPendingJob(confirmToken, job.id)
    } catch (err) {
      releasePendingClaim(confirmToken)
      send(res, 500, { ok: false, detail: '创建任务失败' }, req)
      console.error('[cursor-coding] createJob failed', err)
      return
    }
    setStatus(job, 'queued', '已确认入队，后台启动 Cursor…')
    setImmediate(() => startPipeline(job.id))
    send(
      res,
      200,
      {
        ok: true,
        job_id: job.id,
        job: loadJob(job.id),
        detail: '已确认；后台沙箱 → Cursor → 待审清单（未点同步前不改真工程）',
        stream: `/api/cursor-coding/jobs/${encodeURIComponent(job.id)}/stream`,
      },
      req,
    )
    return
  }

  if (method === 'POST' && path.match(/^\/api\/cursor-coding\/jobs\/[^/]+\/apply$/)) {
    if (rejectBadOrigin(req, res)) return
    if (!cursorKeyReady(cfg)) {
      send(
        res,
        403,
        {
          ok: false,
          code: 'cursor_key_required',
          detail: '使用写码前必须配置 Cursor API Key',
        },
        req,
      )
      return
    }
    const id = decodeURIComponent(path.split('/')[4] || '')
    let body: Record<string, unknown> = {}
    try {
      body = parseJson(await readBody(req))
    } catch {
      send(res, 400, { ok: false, detail: 'JSON 无法解析' }, req)
      return
    }
    const nonce = String(body.nonce || body.hitl_nonce || '').trim()
    const hitl = consume({
      nonce,
      action: 'cursor-coding.apply',
      job_id: id,
    })
    if (!hitl.ok) {
      send(res, 401, { ok: false, detail: hitl.detail, code: hitl.code }, req)
      return
    }
    const accept = Array.isArray(body.accept) ? body.accept.map((x) => String(x)) : []
    const reject = Array.isArray(body.reject) ? body.reject.map((x) => String(x)) : []
    const expand_scope = Array.isArray(body.expand_scope)
      ? body.expand_scope.map((x) => String(x))
      : []
    const out = applyJobReview({ job_id: id, accept, reject, expand_scope })
    send(res, out.ok ? 200 : 400, out, req)
    return
  }

  if (method === 'POST' && path.match(/^\/api\/cursor-coding\/jobs\/[^/]+\/steer$/)) {
    if (rejectBadOrigin(req, res)) return
    if (!cursorKeyReady(cfg)) {
      send(
        res,
        403,
        {
          ok: false,
          code: 'cursor_key_required',
          detail: '使用写码前必须配置 Cursor API Key',
        },
        req,
      )
      return
    }
    const id = decodeURIComponent(path.split('/')[4] || '')
    let body: Record<string, unknown> = {}
    try {
      body = parseJson(await readBody(req))
    } catch {
      send(res, 400, { ok: false, detail: 'JSON 无法解析' }, req)
      return
    }
    const nonce = String(body.nonce || body.hitl_nonce || '').trim()
    const message = String(body.message || body.text || '').trim()
    const hitl = consume({
      nonce,
      action: 'cursor-coding.steer',
      job_id: id,
    })
    if (!hitl.ok) {
      send(res, 401, { ok: false, detail: hitl.detail, code: hitl.code }, req)
      return
    }
    const out = steerJobBackground(id, message)
    send(res, out.ok ? 200 : 400, out, req)
    return
  }

  if (method === 'GET' && path === '/api/cursor-coding/pending-latest') {
    if (rejectBadOrigin(req, res)) return
    const u = new URL(req.url || '/', 'http://127.0.0.1')
    const workspace = resolve(String(u.searchParams.get('workspace') || '').trim())
    if (!workspace) {
      send(res, 400, { ok: false, detail: '缺少 workspace' }, req)
      return
    }
    const callId = String(u.searchParams.get('call_id') || '').trim()
    const sessionId = String(u.searchParams.get('session_id') || '').trim()
    const requirement = String(u.searchParams.get('requirement') || '').trim()
    // 禁止仅 workspace：否则本机其它页可偷到 confirm_token
    if (!callId && !(sessionId && requirement)) {
      send(
        res,
        400,
        {
          ok: false,
          code: 'card_identity_required',
          detail: 'pending-latest 须带 call_id，或同时带 session_id + requirement',
          pending: null,
        },
        req,
      )
      return
    }
    const pending = findPendingForCard({
      workspace,
      call_id: callId,
      session_id: sessionId,
      requirement,
    })
    send(
      res,
      200,
      {
        ok: true,
        pending: pending
          ? {
              confirm_token: pending.id,
              workspace: pending.workspace,
              requirement: pending.requirement,
              parent_job_id: pending.parent_job_id || '',
              status: pending.status,
              job_id: pending.job_id || '',
              call_id: pending.call_id || '',
              session_id: pending.session_id || '',
              created_at: pending.created_at,
            }
          : null,
      },
      req,
    )
    return
  }

  if (method === 'GET' && path === '/api/cursor-coding/jobs') {
    if (rejectBadOrigin(req, res)) return
    const jobs = listJobs(30)
    send(
      res,
      200,
      {
        ok: true,
        count: jobs.length,
        items: jobs.map((j) => ({
          id: j.id,
          status: j.status,
          workspace: j.workspace,
          detail: j.detail,
          updated_at: j.updated_at,
          summary: jobSummary(j),
        })),
      },
      req,
    )
    return
  }

  if (method === 'GET' && path.startsWith('/api/cursor-coding/jobs/')) {
    if (rejectBadOrigin(req, res)) return
    const rest = path.slice('/api/cursor-coding/jobs/'.length)
    if (rest.endsWith('/dialog')) {
      const id = decodeURIComponent(rest.slice(0, -'/dialog'.length))
      const job = loadJob(id)
      if (!job) {
        send(res, 404, { ok: false, detail: '任务不存在' }, req)
        return
      }
      const markdown = formatDialogMarkdown({
        jobId: job.id,
        workspace: job.workspace,
        thinking: job.thinking_text || '',
        assistant: job.assistant_text || '',
        transcript: job.transcript || [],
      })
      send(
        res,
        200,
        {
          ok: true,
          job_id: job.id,
          status: job.status,
          detail: job.detail,
          workspace: job.workspace,
          assistant_text: job.assistant_text || '',
          assistant_chars: (job.assistant_text || '').length,
          thinking_text: job.thinking_text || '',
          thinking_chars: (job.thinking_text || '').length,
          transcript: job.transcript || [],
          review_in_scope: job.review_in_scope || [],
          review_deleted: job.review_deleted || [],
          review_deferred: job.review_deferred || [],
          synced_files: job.synced_files || [],
          markdown,
        },
        req,
      )
      return
    }

    if (rest.endsWith('/stream')) {
      const id = decodeURIComponent(rest.slice(0, -'/stream'.length))
      const job0 = loadJob(id)
      if (!job0) {
        send(res, 404, { ok: false, detail: '任务不存在' }, req)
        return
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        ...corsHeaders(req),
      })
      let cursor = 0
      let closed = false
      const writeEv = (payload: unknown) => {
        if (closed) return
        res.write(`data: ${JSON.stringify(payload)}\n\n`)
      }
      writeEv({ type: 'hello', job_id: id, service: SERVICE_NAME })
      const tick = () => {
        if (closed) return
        healStalePendingReview(id)
        const job = loadJob(id)
        if (!job) {
          writeEv({ type: 'error', message: '任务消失' })
          clearInterval(timer)
          res.end()
          return
        }
        while (cursor < job.events.length) {
          const ev = job.events[cursor]
          cursor += 1
          // 账本 type=done 是同步完成记录，不是 SSE 封口。回放它会让前端在 snapshot 前关流，过程区变空。
          if (ev && ev.type === 'done') continue
          writeEv(ev)
        }
        writeEv({
          type: 'snapshot',
          job_id: job.id,
          status: job.status,
          detail: job.detail,
          workspace: job.workspace,
          review_in_scope: job.review_in_scope || [],
          review_deleted: job.review_deleted || [],
          review_deferred: job.review_deferred || [],
          synced_files: job.synced_files || [],
          assistant_text: job.assistant_text || '',
          assistant_chars: (job.assistant_text || '').length,
          thinking_text: job.thinking_text || '',
          thinking_chars: (job.thinking_text || '').length,
          transcript: job.transcript || [],
        })
        const terminalOk = ['succeeded', 'failed', 'cancelled', 'blocked_no_runner']
        if (terminalOk.includes(job.status)) {
          writeEv({ type: 'done', status: job.status, job_id: job.id })
          clearInterval(timer)
          res.end()
        }
      }
      const timer = setInterval(tick, 400)
      tick()
      req.on('close', () => {
        closed = true
        clearInterval(timer)
      })
      return
    }

    const id = decodeURIComponent(rest)
    const healed = healStalePendingReview(id)
    const job = healed || loadJob(id)
    if (!job) {
      send(res, 404, { ok: false, detail: '任务不存在' }, req)
      return
    }
    send(res, 200, { ok: true, job }, req)
    return
  }

  if (method === 'POST' && path.match(/^\/api\/cursor-coding\/jobs\/[^/]+\/cancel$/)) {
    if (rejectBadOrigin(req, res)) return
    const id = decodeURIComponent(path.split('/')[4] || '')
    let body: Record<string, unknown> = {}
    try {
      const raw = await readBody(req)
      if (raw && String(raw).trim()) body = parseJson(raw)
    } catch {
      send(res, 400, { ok: false, detail: 'JSON 无法解析' }, req)
      return
    }
    const nonce = String(body.nonce || body.hitl_nonce || '').trim()
    const hitl = consume({
      nonce,
      action: 'cursor-coding.cancel',
      job_id: id,
    })
    if (!hitl.ok) {
      send(res, 401, { ok: false, detail: hitl.detail, code: hitl.code }, req)
      return
    }
    const job = forceCancelJob(id)
    if (!job) {
      send(res, 404, { ok: false, detail: '任务不存在' }, req)
      return
    }
    send(res, 200, { ok: true, job }, req)
    return
  }

  if (method === 'GET' && path === '/api/cursor-coding/continue-hint') {
    if (rejectBadOrigin(req, res)) return
    const u = new URL(req.url || '/', 'http://127.0.0.1')
    const workspace = String(u.searchParams.get('workspace') || '').trim()
    const sessionId = String(u.searchParams.get('session_id') || '').trim()
    const parent = workspace
      ? findLatestJobForSession({
          workspace: resolve(workspace),
          session_id: sessionId,
        })
      : null
    send(
      res,
      200,
      {
        ok: true,
        can_continue: Boolean(parent),
        parent_job_id: parent?.id || null,
        workspace: parent?.workspace || null,
        detail: parent
          ? sessionId
            ? '本会话存在成功任务，可走续改确认卡'
            : '同工程存在成功任务（未带 session_id，仅排查）'
          : sessionId
            ? '本会话无成功 parent，请走首轮 begin 或显式 parent_job_id'
            : '无成功 parent，请走首轮 begin',
      },
      req,
    )
    return
  }

  send(res, 404, { ok: false, detail: `未知路径 ${method} ${path}` }, req)
}

export function isServerRunning(): boolean {
  if (childProc && !childProc.killed && childProc.exitCode == null) return true
  return Boolean(server?.listening)
}

export function getListenAddr(): string {
  return listenAddr
}

function preferredServerMode(): 'auto' | 'child' | 'inplace' {
  const raw = String(process.env.CURSOR_CODING_SERVER_MODE || 'auto')
    .trim()
    .toLowerCase()
  if (raw === 'child' || raw === 'inplace' || raw === 'auto') return raw
  return 'auto'
}

async function probeOurHealth(addr: string): Promise<boolean> {
  try {
    const res = await fetch(addr + '/health', { signal: AbortSignal.timeout(2000) })
    const body = (await res.json()) as { service?: string }
    return Boolean(body && body.service === SERVICE_NAME)
  } catch {
    return false
  }
}

export async function startServerInProcess(): Promise<{
  ok: boolean
  addr: string
  detail: string
  already?: boolean
}> {
  const cfg = loadConfig()
  if (server?.listening) {
    return { ok: true, addr: listenAddr, detail: 'Cursor 写码服务已在运行', already: true }
  }
  return new Promise((resolvePromise) => {
    const s = createServer((req, res) => {
      void handle(req, res).catch((err) => {
        if (!res.headersSent) send(res, 500, { ok: false, detail: '内部错误' }, req)
        console.error('[cursor-coding] handle error', err)
      })
    })
    s.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        const addr = `http://${cfg.listen}:${cfg.port}`
        void (async () => {
          try {
            const res = await fetch(addr + '/health', { signal: AbortSignal.timeout(2000) })
            const body = (await res.json()) as { service?: string }
            if (body && body.service === SERVICE_NAME) {
              listenAddr = addr
              resolvePromise({
                ok: true,
                addr,
                already: true,
                detail: `端口 ${cfg.port} 已是本插件服务：${addr}`,
              })
              return
            }
          } catch {
            /* not our service */
          }
          resolvePromise({
            ok: false,
            addr: '',
            detail: `端口 ${cfg.port} 已被其它进程占用（不是 dsh-cursor-coding）。请改设置端口或结束占用进程。`,
          })
        })()
        return
      }
      resolvePromise({ ok: false, addr: '', detail: String(err) })
    })
    s.listen(cfg.port, cfg.listen, () => {
      server = s
      serverMode = 'inplace'
      listenAddr = `http://${cfg.listen}:${cfg.port}`
      console.log(`[cursor-coding] 本机服务已监听 ${listenAddr}（inplace）`)
      void recoverOrphanRunningJobs()
        .then((n) => {
          if (n) console.log(`[cursor-coding] 已收口 ${n} 个中断中的写码任务`)
        })
        .catch((err) => console.warn('[cursor-coding] 收口中断任务失败', err))
      resolvePromise({ ok: true, addr: listenAddr, detail: `服务: ${listenAddr}` })
    })
  })
}

export async function stopServerInProcess(): Promise<{ ok: boolean; detail: string }> {
  if (!server) return { ok: true, detail: '服务未运行' }
  const s = server
  server = null
  listenAddr = ''
  return new Promise((resolvePromise) => {
    s.close(() => resolvePromise({ ok: true, detail: '服务已停止' }))
  })
}

async function startServerChild(): Promise<{
  ok: boolean
  addr: string
  detail: string
  already?: boolean
}> {
  const cfg = loadConfig()
  const addr = `http://${cfg.listen}:${cfg.port}`
  if (await probeOurHealth(addr)) {
    listenAddr = addr
    serverMode = 'child'
    return { ok: true, addr, already: true, detail: `端口已有本插件服务：${addr}` }
  }
  if (childProc && childProc.exitCode == null) {
    for (let i = 0; i < 40; i += 1) {
      if (await probeOurHealth(addr)) {
        listenAddr = addr
        serverMode = 'child'
        return { ok: true, addr, detail: `子进程服务就绪：${addr}` }
      }
      await new Promise((r) => setTimeout(r, 100))
    }
  }

  const entry = join(dirname(fileURLToPath(import.meta.url)), 'serverMain.js')
  if (!existsSync(entry)) {
    return { ok: false, addr: '', detail: `找不到子进程入口 ${entry}（请先 pnpm build）` }
  }

  const child = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      CURSOR_CODING_SERVER_ROLE: 'child',
      CURSOR_CODING_SERVER_MODE: 'inplace',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  })
  childProc = child
  child.stdout?.on('data', (buf) => {
    const t = String(buf || '').trim()
    if (t) console.log('[cursor-coding:child]', t)
  })
  child.stderr?.on('data', (buf) => {
    const t = String(buf || '').trim()
    if (t) console.warn('[cursor-coding:child]', t)
  })
  child.on('exit', (code, signal) => {
    if (childProc === child) childProc = null
    console.warn(`[cursor-coding] 子进程退出 code=${code} signal=${signal || ''}`)
  })

  for (let i = 0; i < 50; i += 1) {
    if (child.exitCode != null) {
      return {
        ok: false,
        addr: '',
        detail: `子进程启动失败（exit ${child.exitCode}）`,
      }
    }
    if (await probeOurHealth(addr)) {
      listenAddr = addr
      serverMode = 'child'
      return { ok: true, addr, detail: `服务(子进程隔离): ${addr}` }
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  try {
    child.kill('SIGTERM')
  } catch {
    /* ignore */
  }
  childProc = null
  return { ok: false, addr: '', detail: '子进程启动超时（未通过 /health）' }
}

/**
 * 启动本机写码 HTTP。
 * - CURSOR_CODING_SERVER_MODE=auto（默认）：优先子进程，失败回退同进程
 * - child：强制子进程
 * - inplace：强制同进程（旧行为）
 * 子进程崩溃不拖垮宿主；HITL/pending 已落盘可跨进程共享。
 */
export async function startServer(): Promise<{
  ok: boolean
  addr: string
  detail: string
  already?: boolean
}> {
  if (process.env.CURSOR_CODING_SERVER_ROLE === 'child') {
    return startServerInProcess()
  }

  const prefer = preferredServerMode()
  const cfg = loadConfig()
  const addr = `http://${cfg.listen}:${cfg.port}`

  if (await probeOurHealth(addr)) {
    listenAddr = addr
    return {
      ok: true,
      addr,
      already: true,
      detail: `Cursor 写码服务已在运行：${addr}`,
    }
  }

  if (prefer === 'inplace') {
    return startServerInProcess()
  }

  const childOut = await startServerChild()
  if (childOut.ok) return childOut
  if (prefer === 'child') return childOut

  console.warn(`[cursor-coding] 子进程不可用，回退同进程：${childOut.detail}`)
  return startServerInProcess()
}

export async function stopServer(): Promise<{ ok: boolean; detail: string }> {
  if (childProc) {
    const child = childProc
    childProc = null
    listenAddr = ''
    try {
      child.kill('SIGTERM')
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 200))
    try {
      if (child.exitCode == null) child.kill('SIGKILL')
    } catch {
      /* ignore */
    }
    return { ok: true, detail: '子进程服务已停止' }
  }
  return stopServerInProcess()
}
