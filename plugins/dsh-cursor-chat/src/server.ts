/**
 * 本机 loopback HTTP：配置 / HITL / confirm / jobs / SSE。
 * 仅绑定 127.0.0.1；阶段 A：confirm 后后台沙箱 → Cursor → 受限同步。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import {
  applyConfigFromUi,
  cursorKeyReady,
  editableConfigView,
  loadConfig,
  publicConfigView,
  SERVICE_NAME,
  stripAccidentalMockEnv,
} from './config.js'
import { checkCompat, readPluginVersion } from './compat.js'
import { redactJobPublic, redactSseEvent } from './redact.js'
import { consume, issue } from './hitl.js'
import {
  appendEvent,
  createJob,
  findLatestJobByCallId,
  findLatestJobForSession,
  forceCancelJob,
  jobCardView,
  jobSummary,
  listConcludedJobsBySessionId,
  listJobs,
  loadJob,
  onJobChange,
  patchJob,
  saveJob,
  setStatus,
} from './jobs.js'
import { runJobBackground, applyJobReview, steerJobBackground, healStalePendingReview, recoverOrphanRunningJobs, sealWithServices, foldLiveAudit } from './orchestrator/runJob.js'
import { expandWriteScopeWithCompanions } from './scopeCompanions.js'
import { needsRequirementClarify } from './requirementGate.js'
import {
  browserOriginAllowed,
  isDesktopShellOrigin,
  isLoopbackBrowserOrigin,
  requestOrigin,
} from './localAccess.js'
import { filterStoredImageRefs, type ChatImageRef } from './images.js'
import {
  bindPendingJob,
  cancelPendingConfirm,
  claimPendingConfirm,
  createPendingConfirm,
  findPendingByJobId,
  findPendingForCard,
  loadPendingConfirm,
  releasePendingClaim,
} from './pendingConfirm.js'
import {
  conclusionDeletedFiles,
  conclusionSyncedFiles,
  formatChatConclusion,
} from './conclusion.js'
import { formatDialogMarkdown } from './transcript.js'
import { assertBackendRestartReady, executeBackendRestart } from './backendRestart.js'
import {
  cancelGitDeliverWait,
  confirmGitDeliverWait,
  decideGitDeliverRisk,
  getGitDeliverWaitPlan,
} from './gitDeliverWait.js'
import { completeGitDeliverFromConfirm } from './launchGitDeliver.js'
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

/**
 * 本机服务构建指纹（服务端代码哈希）。
 * 端口上已有旧进程时健康检查会返回不同指纹：必须换掉旧进程，
 * 否则新路由/新字段永远不生效（曾导致结论正文接口一直 404）。
 */
function computeBuildId(): string {
  try {
    const root = dirname(fileURLToPath(import.meta.url))
    const files: string[] = []
    const walk = (dir: string, prefix = ''): void => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${ent.name}` : ent.name
        if (ent.isDirectory()) {
          walk(join(dir, ent.name), rel)
          continue
        }
        // 界面/自测脚本不参与服务端指纹，避免纯前端或测试改动触发服务重启
        if (
          !ent.name.endsWith('.js') ||
          ent.name === 'client.js' ||
          ent.name === 'self-test.js' ||
          ent.name.startsWith('verify-')
        ) {
          continue
        }
        files.push(rel)
      }
    }
    walk(root)
    files.sort()
    const hash = createHash('sha1')
    for (const rel of files) {
      hash.update(rel)
      hash.update(readFileSync(join(root, rel)))
    }
    return hash.digest('hex').slice(0, 12)
  } catch {
    return ''
  }
}

const BUILD_ID = computeBuildId()

/** 仅对受信 Origin 回显 ACAO；禁止 *，避免恶意页读 loopback 响应 */
function corsHeaders(req?: IncomingMessage): Record<string, string> {
  const origin = req ? requestOrigin(req) : ''
  // dsh-app://app 是 Electron 壳页面的自定义安全协议源；带 Origin 的请求里它标识“自家设置页”。
  if (origin && (isLoopbackBrowserOrigin(origin) || isDesktopShellOrigin(origin))) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
      // Chromium 私有网络访问（PNA）预检要求：安全源（壳页面）访问 127.0.0.1 时必须带此头。
      'Access-Control-Allow-Private-Network': 'true',
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
        // 构建指纹 + pid：宿主启动时据此识别并替换旧版残留服务进程
        buildId: BUILD_ID,
        pid: process.pid,
        pluginVersion,
        listen: listenAddr || `http://${cfg.listen}:${cfg.port}`,
        view: publicConfigView(cfg),
        cursorKeyReady: cursorKeyReady(cfg),
        ui: '/ui',
        serverMode: process.env.CURSOR_CHAT_SERVER_ROLE === 'child' ? 'child' : serverMode,
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
          : '请到「设置 → AI写码」填写 Cursor API Key（硬性要求）',
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
          detail: '已保存到本机 ~/.zhongruan/cursor-chat/config.json（未写入任何项目仓库）',
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

  if (method === 'POST' && path === '/api/cursor-chat/pending') {
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
    const dataRoot = cfg.dataRoot || ''
    const rawImages = Array.isArray(body.images) ? (body.images as ChatImageRef[]) : undefined
    const images = rawImages?.length ? filterStoredImageRefs(rawImages, dataRoot) : undefined
    const pending = createPendingConfirm({
      workspace,
      requirement,
      parent_job_id: typeof body.parent_job_id === 'string' ? body.parent_job_id : undefined,
      call_id: typeof body.call_id === 'string' ? body.call_id : undefined,
      session_id: typeof body.session_id === 'string' ? body.session_id : undefined,
      images,
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
          image_count: pending.images?.length || 0,
          image_names: (pending.images || []).map((x) => x.name || x.path.split(/[/\\]/).pop() || 'img'),
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
      action !== 'cursor-chat.confirm' &&
      action !== 'cursor-chat.apply' &&
      action !== 'cursor-chat.steer' &&
      action !== 'cursor-chat.cancel' &&
      action !== 'cursor-chat.restart-backend' &&
      action !== 'cursor-chat.user-choice' &&
      action !== 'cursor-chat.git-deliver' &&
      action !== 'cursor-chat.git-deliver-risk'
    ) {
      send(
        res,
        400,
        {
          ok: false,
          detail:
            'action 须为 cursor-chat.confirm / apply / steer / cancel / restart-backend / user-choice / git-deliver / git-deliver-risk',
        },
        req,
      )
      return
    }
    // confirm：必须绑定有效 waiting pending，禁止无卡签发 nonce
    if (action === 'cursor-chat.confirm') {
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
    if (action === 'cursor-chat.git-deliver') {
      const confirmToken = String(body.confirm_token || '').trim()
      if (!confirmToken) {
        send(
          res,
          400,
          {
            ok: false,
            code: 'confirm_token_required',
            detail: '签发 git-deliver 须携带 confirm_token',
          },
          req,
        )
        return
      }
      const pending = loadPendingConfirm(confirmToken)
      if (!pending || pending.status === 'cancelled' || pending.kind !== 'git_deliver') {
        send(res, 400, { ok: false, detail: 'Git 交付确认令牌无效', code: 'pending_invalid' }, req)
        return
      }
      if (pending.status !== 'waiting' && pending.status !== 'claiming') {
        send(res, 400, { ok: false, detail: 'Git 交付确认单已不可签发', code: 'pending_not_waiting' }, req)
        return
      }
      if (!getGitDeliverWaitPlan(confirmToken) && !pending.git_plan) {
        send(res, 400, { ok: false, detail: 'Git 交付计划已过期，请重新发起', code: 'plan_missing' }, req)
        return
      }
      const issued = issue({
        action,
        workspace: pending.workspace,
        requirement: pending.requirement,
        confirm_token: pending.id,
        job_id: pending.job_id,
      })
      send(res, 200, issued, req)
      return
    }
    if (action === 'cursor-chat.git-deliver-risk') {
      const confirmToken = String(body.confirm_token || '').trim()
      if (!confirmToken) {
        send(
          res,
          400,
          {
            ok: false,
            code: 'confirm_token_required',
            detail: '签发 git-deliver-risk 须携带 confirm_token',
          },
          req,
        )
        return
      }
      const pending = loadPendingConfirm(confirmToken)
      if (!pending || pending.status === 'cancelled' || pending.kind !== 'git_deliver') {
        send(res, 400, { ok: false, detail: 'Git 交付确认令牌无效', code: 'pending_invalid' }, req)
        return
      }
      // 首次确认后 pending 可能已 started；高危二次人审仍须可签发
      const issued = issue({
        action,
        workspace: pending.workspace,
        requirement: pending.requirement,
        confirm_token: pending.id,
        job_id: pending.job_id,
      })
      send(res, 200, issued, req)
      return
    }
    if (action === 'cursor-chat.cancel') {
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
    if (action === 'cursor-chat.restart-backend') {
      const jobId = String(body.job_id || '').trim()
      if (!jobId) {
        send(res, 400, { ok: false, detail: '签发 restart-backend 须携带 job_id' }, req)
        return
      }
      const job = loadJob(jobId)
      if (!job) {
        send(res, 404, { ok: false, detail: '任务不存在' }, req)
        return
      }
      const ready = assertBackendRestartReady(job)
      if (!ready.ok) {
        send(res, 400, { ok: false, detail: ready.detail, code: ready.code }, req)
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

  if (method === 'POST' && path === '/api/cursor-chat/confirm') {
    if (rejectBadOrigin(req, res)) return
    if (!cursorKeyReady(cfg)) {
      send(
        res,
        403,
        {
          ok: false,
          code: 'cursor_key_required',
          detail: '使用写码前必须配置 Cursor API Key（设置 → AI写码）',
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
          detail: '缺少 confirm_token：须先 zr_cchat_begin 出确认卡，用户点确认后再开工',
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
    if (pending0.kind === 'git_deliver') {
      send(
        res,
        400,
        {
          ok: false,
          code: 'use_git_deliver',
          detail: '这是 Git 交付确认卡，请走 /api/cursor-chat/git-deliver/confirm',
        },
        req,
      )
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
          stream: `/api/cursor-chat/jobs/${encodeURIComponent(pending0.job_id)}/stream`,
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
      action: 'cursor-chat.confirm',
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
            stream: `/api/cursor-chat/jobs/${encodeURIComponent(claimed.pending.job_id)}/stream`,
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
        images: pending0.images,
        parent_job_id: parentJobId,
        dsh_session_id: pending0.session_id || null,
        dsh_call_id: pending0.call_id || null,
        write_scope: expandWriteScopeWithCompanions(cfg.writeScope),
        write_scope_source: (cfg.writeScope || []).length ? 'config' : null,
        continue_count: parentJobId ? (loadJob(parentJobId)?.continue_count || 0) + 1 : 0,
      })
      bindPendingJob(confirmToken, job.id)
    } catch (err) {
      releasePendingClaim(confirmToken)
      send(res, 500, { ok: false, detail: '创建任务失败' }, req)
      console.error('[cursor-chat] createJob failed', err)
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
        stream: `/api/cursor-chat/jobs/${encodeURIComponent(job.id)}/stream`,
      },
      req,
    )
    return
  }

  if (method === 'POST' && path === '/api/cursor-chat/git-deliver/confirm') {
    if (rejectBadOrigin(req, res)) return
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
      send(res, 400, { ok: false, code: 'confirm_token_required', detail: '缺少 confirm_token' }, req)
      return
    }
    const pending = loadPendingConfirm(confirmToken)
    if (!pending || pending.kind !== 'git_deliver' || pending.status === 'cancelled') {
      send(res, 400, { ok: false, detail: 'Git 交付确认令牌无效', code: 'pending_invalid' }, req)
      return
    }
    const hitl = consume({
      nonce,
      action: 'cursor-chat.git-deliver',
      workspace: pending.workspace,
      requirement: pending.requirement,
      confirm_token: confirmToken,
      job_id: pending.job_id,
    })
    if (!hitl.ok) {
      send(res, 401, { ok: false, detail: hitl.detail, code: hitl.code }, req)
      return
    }
    const selectedRaw = Array.isArray(body.selected_files) ? body.selected_files : []
    const selected_files = selectedRaw.map((x) => String(x || '').trim()).filter(Boolean)
    const commit_message = String(body.commit_message || pending.git_plan?.commit_message || '').trim()
    const target_branch = String(body.target_branch || pending.git_plan?.target_branch || '').trim()
    const base_branch = String(body.base_branch || pending.git_plan?.base_branch || '').trim()
    const create_pr = body.create_pr !== false && body.create_pr !== 'false'
    const plan = pending.git_plan || getGitDeliverWaitPlan(confirmToken)
    if (!plan) {
      send(res, 400, { ok: false, detail: 'Git 交付计划已过期，请重新发起', code: 'plan_missing' }, req)
      return
    }
    const payload = {
      selected_files,
      commit_message: commit_message || plan.commit_message,
      target_branch: target_branch || plan.target_branch,
      base_branch: base_branch || plan.base_branch,
      create_pr,
    }
    // 落盘 + 尽量唤醒本进程 waiter。子进程 HTTP 时 waiter 在宿主：靠磁盘决策唤醒，禁止再 HTTP 双提交。
    confirmGitDeliverWait(confirmToken, payload)
    if (pending.job_id) {
      bindPendingJob(confirmToken, pending.job_id)
      const live = loadJob(pending.job_id)
      const st = String(live?.status || '')
      if (live && st === 'pending_review') {
        setStatus(live, 'running', '已确认，正在审码本批…')
        send(
          res,
          200,
          {
            ok: true,
            accepted: true,
            waiting_tool: true,
            detail: '已确认，正在审码本批…',
            job_id: pending.job_id || '',
            confirm_token: confirmToken,
          },
          req,
        )
        return
      }
      // 已有 Job：后续确认一律不再 HTTP 重跑 complete（防并行双 commit/push）
      const terminal =
        st === 'succeeded' || st === 'failed' || st === 'cancelled' || st === 'blocked_no_runner'
      if (live && terminal) {
        send(
          res,
          200,
          {
            ok: st === 'succeeded',
            already_done: true,
            detail: st === 'succeeded' ? '本批交付已完成' : `本批交付已结束（${st}）`,
            job_id: pending.job_id || '',
            confirm_token: confirmToken,
          },
          req,
        )
        return
      }
      if (live) {
        send(
          res,
          200,
          {
            ok: true,
            accepted: true,
            waiting_tool: true,
            already_accepted: true,
            detail: '交付已在进行中，请勿重复确认',
            job_id: pending.job_id || '',
            confirm_token: confirmToken,
          },
          req,
        )
        return
      }
    }
    // 仅无 job_id 的旧路径：HTTP 直接执行（仍过审码闸）
    const done = await completeGitDeliverFromConfirm({
      jobId: pending.job_id || '',
      plan,
      selected_files: payload.selected_files,
      commit_message: payload.commit_message,
      target_branch: payload.target_branch,
      base_branch: payload.base_branch,
      create_pr: payload.create_pr,
      confirm_token: confirmToken,
    })
    send(
      res,
      200,
      {
        ok: done.ok,
        paused: done.paused || false,
        detail: done.result.detail,
        code: done.code || '',
        job_id: pending.job_id || '',
        confirm_token: confirmToken,
        conclusion: done.conclusion,
        result: done.result,
        job: done.job,
      },
      req,
    )
    return
  }

  if (method === 'POST' && path === '/api/cursor-chat/git-deliver/risk-decision') {
    if (rejectBadOrigin(req, res)) return
    let body: Record<string, unknown> = {}
    try {
      body = parseJson(await readBody(req))
    } catch {
      send(res, 400, { ok: false, detail: 'JSON 无法解析' }, req)
      return
    }
    const nonce = String(body.nonce || body.hitl_nonce || '').trim()
    const confirmToken = String(body.confirm_token || '').trim()
    const decisionRaw = String(body.decision || '').trim().toLowerCase()
    const decision =
      decisionRaw === 'fix'
        ? 'fix'
        : decisionRaw === 'pause'
          ? 'pause'
          : decisionRaw === 'continue'
            ? 'continue'
            : ''
    if (!confirmToken) {
      send(res, 400, { ok: false, code: 'confirm_token_required', detail: '缺少 confirm_token' }, req)
      return
    }
    if (!decision) {
      send(
        res,
        400,
        { ok: false, code: 'decision_required', detail: 'decision 须为 fix / continue / pause' },
        req,
      )
      return
    }
    const pending = loadPendingConfirm(confirmToken)
    if (!pending || pending.kind !== 'git_deliver' || pending.status === 'cancelled') {
      send(res, 400, { ok: false, detail: 'Git 交付确认令牌无效', code: 'pending_invalid' }, req)
      return
    }
    const hitl = consume({
      nonce,
      action: 'cursor-chat.git-deliver-risk',
      workspace: pending.workspace,
      requirement: pending.requirement,
      confirm_token: confirmToken,
      job_id: pending.job_id,
    })
    if (!hitl.ok) {
      send(res, 401, { ok: false, detail: hitl.detail, code: hitl.code }, req)
      return
    }
    const live = pending.job_id ? loadJob(pending.job_id) : null
    const riskGate = live?.git_deliver?.risk_gate
    if (riskGate !== 'await_risk') {
      send(
        res,
        400,
        {
          ok: false,
          code: 'not_awaiting_risk',
          detail: '当前不在审码闸决策阶段',
        },
        req,
      )
      return
    }
    const riskKind = live?.git_deliver?.risk_kind || 'high'
    if (decision === 'continue' && riskKind === 'high') {
      send(
        res,
        400,
        {
          ok: false,
          code: 'continue_not_allowed',
          detail: '本批有高危时不能跳过，请选择修复或暂停',
        },
        req,
      )
      return
    }
    if (decision === 'fix' && riskKind === 'engine_unavailable') {
      send(
        res,
        400,
        {
          ok: false,
          code: 'fix_not_allowed',
          detail: '审码引擎不可用时请选择仍继续提交或暂停',
        },
        req,
      )
      return
    }
    const pauseDetail =
      decision === 'pause'
        ? riskKind === 'engine_unavailable'
          ? '用户选择暂停提交（审码引擎不可用）'
          : '用户选择暂停提交（保留高危，未 commit）'
        : undefined
    const decided = decideGitDeliverRisk(confirmToken, decision, pauseDetail)
    if (!decided.ok) {
      send(res, 400, { ok: false, detail: decided.detail || '写入决策失败' }, req)
      return
    }
    if (pending.job_id) {
      const j = loadJob(pending.job_id)
      if (j) {
        // 暂停是终态：禁止先写 running「已选择暂停…」，否则进度卡会卡在「读取 Git 中」
        if (decision === 'pause') {
          const prevGd = j.git_deliver || {}
          patchJob(j.id, {
            cancelled: true,
            review_gate: null,
            git_deliver: {
              ...prevGd,
              risk_gate: null,
              stage: 'paused',
              risk_kind: null,
              risk_summary: pauseDetail || '用户选择暂停提交',
            },
          })
          setStatus(loadJob(j.id) || j, 'cancelled', pauseDetail || '用户选择暂停提交')
        } else {
          setStatus(
            j,
            'running',
            decision === 'fix' ? '已选择修复高危…' : '已选择跳过审码，继续提交…',
          )
        }
      }
    }
    send(
      res,
      200,
      {
        ok: true,
        decision,
        detail:
          decision === 'fix'
            ? '已接受：修复高危'
            : decision === 'continue'
              ? '已接受：仍继续提交'
              : '已接受：暂停提交',
        job_id: pending.job_id || '',
        confirm_token: confirmToken,
      },
      req,
    )
    return
  }

  if (method === 'POST' && path === '/api/cursor-chat/git-deliver/cancel') {
    if (rejectBadOrigin(req, res)) return
    let body: Record<string, unknown> = {}
    try {
      body = parseJson(await readBody(req))
    } catch {
      send(res, 400, { ok: false, detail: 'JSON 无法解析' }, req)
      return
    }
    const confirmToken = String(body.confirm_token || '').trim()
    const jobIdHint = String(body.job_id || '').trim()
    const reason = String(body.reason || '').trim() || '用户取消 Git 交付'
    let pending = confirmToken ? loadPendingConfirm(confirmToken) : null
    if ((!pending || pending.kind !== 'git_deliver') && jobIdHint) {
      pending = findPendingByJobId(jobIdHint)
    }
    const token = String(pending?.id || confirmToken || '').trim()
    const jobId = String(pending?.job_id || jobIdHint || '').trim()

    // 幂等：已取消 / 无 pending 但 job 已终态 → 仍 ok，避免确认卡点取消报错
    if (!pending || pending.kind !== 'git_deliver') {
      if (jobId) {
        const job = loadJob(jobId)
        if (job && (job.status === 'cancelled' || job.cancelled)) {
          if (token) cancelGitDeliverWait(token, reason)
          send(res, 200, { ok: true, detail: '已取消 Git 交付', job_id: jobId, confirm_token: token }, req)
          return
        }
      }
      send(
        res,
        400,
        {
          ok: false,
          detail: 'Git 交付确认令牌无效',
          code: 'pending_invalid',
        },
        req,
      )
      return
    }

    if (token) {
      cancelGitDeliverWait(token, reason)
      cancelPendingConfirm(token)
    }
    if (jobId) {
      const job = loadJob(jobId)
      if (job && !['succeeded', 'failed', 'cancelled'].includes(job.status)) {
        const { formatGitDeliverConclusion } = await import('./gitDeliver.js')
        const conclusion = formatGitDeliverConclusion({
          status: 'cancelled',
          plan: pending.git_plan,
          cancelDetail: reason,
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
        setStatus(loadJob(job.id) || job, 'cancelled', reason)
      }
    }
    send(
      res,
      200,
      {
        ok: true,
        detail: '已取消 Git 交付',
        confirm_token: token,
        job_id: jobId,
        conclusion:
          jobId && loadJob(jobId)
            ? String(loadJob(jobId)?.assistant_text || '').trim()
            : '',
      },
      req,
    )
    return
  }

  if (method === 'POST' && path.match(/^\/api\/cursor-chat\/jobs\/[^/]+\/apply$/)) {
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
      action: 'cursor-chat.apply',
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
    const out = applyJobReview({ job_id: id, accept, reject, expand_scope, seal: false })
    if (out.ok) {
      await sealWithServices(id, out.synced_files || [], out.deleted_files || [], out.detail || '已同步')
    } else if (out.code === 'delivery_audit') {
      await foldLiveAudit(id)
      const fresh = loadJob(id)
      if (fresh?.detail) out.detail = fresh.detail
    }
    send(res, out.ok ? 200 : 400, out, req)
    return
  }

  if (method === 'POST' && path.match(/^\/api\/cursor-chat\/jobs\/[^/]+\/steer$/)) {
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
      action: 'cursor-chat.steer',
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

  if (method === 'GET' && path === '/api/cursor-chat/pending-latest') {
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
              kind: pending.kind || 'coding',
              git_plan: pending.git_plan || null,
              parent_job_id: pending.parent_job_id || '',
              image_count: pending.images?.length || 0,
              image_names: (pending.images || []).map((x) => x.name || x.path.split(/[/\\]/).pop() || 'img'),
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

  if (method === 'GET' && path === '/api/cursor-chat/jobs') {
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

  // Git 交付确认卡：对话区 turnTail 轮询待确认项（不依赖 toolview 是否挂上）
  if (method === 'GET' && path === '/api/cursor-chat/git-deliver/awaiting') {
    if (rejectBadOrigin(req, res)) return
    const u = new URL(req.url || '/', 'http://127.0.0.1')
    const sessionId = String(u.searchParams.get('session_id') || '').trim()
    // 必须带 session_id 且与账本一致，禁止仅 workspace/空会话扫出 confirm_token
    if (!sessionId) {
      send(res, 400, { ok: false, detail: 'git-deliver/awaiting 须带 session_id' }, req)
      return
    }
    const jobs = listJobs(40).filter((j) => {
      if (j.work_kind !== 'git_deliver') return false
      if (j.status !== 'pending_review') return false
      if (!j.dsh_session_id || j.dsh_session_id !== sessionId) return false
      return true
    })
    const items = jobs.map((j) => {
      const pending = findPendingForCard({
        workspace: j.workspace,
        call_id: j.dsh_call_id || undefined,
        session_id: j.dsh_session_id || undefined,
        requirement: j.requirement,
      })
      const plan = pending?.git_plan || null
      const g = j.git_deliver || null
      return {
        job_id: j.id,
        confirm_token: pending && pending.kind === 'git_deliver' ? pending.id : '',
        status: j.status,
        workspace: j.workspace,
        requirement: j.requirement,
        created_at: j.created_at,
        updated_at: j.updated_at,
        dsh_session_id: j.dsh_session_id || null,
        dsh_call_id: j.dsh_call_id || null,
        git_plan: plan || {
          remote_url: g?.remote_url || '',
          current_branch: g?.current_branch || '',
          target_branch: g?.target_branch || '',
          base_branch: g?.base_branch || 'main',
          commit_message: g?.commit_message || '',
          create_pr: g?.create_pr !== false,
          selected_files: g?.selected_files || j.review_in_scope || [],
          held_sensitive_files: g?.held_sensitive_files || j.review_deferred || [],
        },
      }
    })
    send(res, 200, { ok: true, items }, req)
    return
  }

  // 客户端兜底：最近已交付的三段式结论（切会话后靠此 + localStorage 再挂回）
  if (method === 'GET' && path === '/api/cursor-chat/recent-conclusions') {
    if (rejectBadOrigin(req, res)) return
    const u = new URL(req.url || '/', 'http://127.0.0.1')
    const limit = Math.min(40, Math.max(1, Number(u.searchParams.get('limit') || 20) || 20))
    const jobs = listJobs(80)
      .filter((j) => j.conclusion_delivered && (j.status === 'succeeded' || j.status === 'failed'))
      .slice(0, limit)
    send(
      res,
      200,
      {
        ok: true,
        items: jobs.map((j) => ({
          id: j.id,
          status: j.status,
          updated_at: j.updated_at,
          dsh_session_id: j.dsh_session_id || null,
          requirement: String(j.requirement || '').slice(0, 240),
          chat_conclusion: formatChatConclusion(j),
          work_kind: j.work_kind || '',
          // 供客户端在底座未出「已编辑 N 个文件」时补同款改动卡，并按路径对齐会话轮次
          // Git 交付：取消/失败不得用 review_in_scope（候选清单）冒充已编辑
          synced_files: conclusionSyncedFiles(j),
          deleted_files: conclusionDeletedFiles(j),
        })),
      },
      req,
    )
    return
  }

  // 重开已完成会话：按 session_id 取各轮结论（每个 turnTail 按轮次时间窗自选）
  if (method === 'GET' && path === '/api/cursor-chat/session-conclusion') {
    if (rejectBadOrigin(req, res)) return
    const u = new URL(req.url || '/', 'http://127.0.0.1')
    const sessionId = String(u.searchParams.get('session_id') || '').trim()
    if (!sessionId) {
      send(res, 400, { ok: false, detail: '缺少 session_id' }, req)
      return
    }
    const jobs = listConcludedJobsBySessionId(sessionId)
    if (!jobs.length) {
      send(res, 200, { ok: true, found: false, items: [] }, req)
      return
    }
    const items = jobs.map((job) => {
      const synced = conclusionSyncedFiles(job)
      const deleted = conclusionDeletedFiles(job)
      return {
        id: job.id,
        status: job.status,
        work_kind: job.work_kind || '',
        updated_at: job.updated_at,
        // 结论首次交付时间：后续应用/续改会刷新 updated_at，客户端按它对轮次
        concluded_at: job.conclusion_at || job.updated_at,
        dsh_session_id: job.dsh_session_id || null,
        chat_conclusion: formatChatConclusion(job),
        synced_files: synced,
        deleted_files: deleted,
        files: [...synced, ...deleted],
        // 结论区常显重启条：进度卡折叠后仍可自动/手工下发
        backend_restart: job.backend_restart || null,
        backend_restart_hint: job.backend_restart_hint || null,
      }
    })
    // 顶层保留最新一条，兼容仍在运行的旧版客户端
    const latest = items[0]!
    send(res, 200, { ok: true, found: true, items, ...latest }, req)
    return
  }

  // begin 阻塞未返回时：进度卡用 call_id 对账挂 SSE
  if (method === 'GET' && path === '/api/cursor-chat/jobs-by-call') {
    if (rejectBadOrigin(req, res)) return
    const u = new URL(req.url || '/', 'http://127.0.0.1')
    const callId = String(u.searchParams.get('call_id') || '').trim()
    if (!callId) {
      send(res, 400, { ok: false, detail: '缺少 call_id' }, req)
      return
    }
    const job = findLatestJobByCallId(callId)
    if (!job) {
      send(res, 200, { ok: true, found: false, job_id: '', status: '' }, req)
      return
    }
    send(
      res,
      200,
      {
        ok: true,
        found: true,
        job_id: job.id,
        status: job.status,
        detail: job.detail || '',
        work_kind: job.work_kind || '',
        stream: `/api/cursor-chat/jobs/${encodeURIComponent(job.id)}/stream`,
      },
      req,
    )
    return
  }

  if (method === 'GET' && path.startsWith('/api/cursor-chat/jobs/')) {
    if (rejectBadOrigin(req, res)) return
    const rest = path.slice('/api/cursor-chat/jobs/'.length)
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
          review_gate: job.review_gate ?? null,
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
      let ticking = false
      let timer: ReturnType<typeof setInterval> | undefined
      let pushTimer: ReturnType<typeof setTimeout> | undefined
      let unsub: () => void = () => {}
      const terminalOk = ['succeeded', 'failed', 'cancelled', 'blocked_no_runner']
      const writeEv = (payload: unknown) => {
        if (closed) return
        // 对外 SSE 脱敏：event 标量字段（text/detail/message 等）+ 内嵌 job 快照
        const safePayload = payload && typeof payload === 'object'
          ? redactSseEvent(payload as Record<string, unknown>)
          : payload
        res.write(`data: ${JSON.stringify(safePayload)}\n\n`)
      }
      const stop = () => {
        closed = true
        if (timer) clearInterval(timer)
        if (pushTimer) clearTimeout(pushTimer)
        unsub()
        unsub = () => {}
      }
      writeEv({ type: 'hello', job_id: id, service: SERVICE_NAME })
      let lastSnapSig = ''
      const snapSig = (job: ReturnType<typeof loadJob>) => {
        if (!job) return ''
        const tr = job.transcript || []
        let trHash = String(tr.length)
        for (let i = Math.max(0, tr.length - 6); i < tr.length; i += 1) {
          const it = tr[i]
          trHash +=
            '|' +
            String(it?.id || '') +
            ':' +
            String(it?.kind || '') +
            ':' +
            String(it?.text || '').length +
            ':' +
            String((it as { tool_status?: string })?.tool_status || '') +
            ':' +
            (it?.streaming ? '1' : '0')
        }
        const choice = job.pending_user_choice
        return [
          job.status,
          job.detail || '',
          job.review_gate || '',
          (job.thinking_text || '').length,
          (job.assistant_text || '').length,
          (job.review_in_scope || []).length,
          trHash,
          job.updated_at || '',
          choice ? `${choice.call_id}:${choice.options?.length || 0}` : '',
        ].join('#')
      }
      const writeSnapshot = (job: NonNullable<ReturnType<typeof loadJob>>) => {
        const terminalNow = terminalOk.includes(job.status)
        writeEv({
          type: 'snapshot',
          job_id: job.id,
          status: job.status,
          detail: job.detail,
          workspace: job.workspace,
          work_kind: job.work_kind || '',
          git_deliver: job.git_deliver || null,
          review_in_scope: job.review_in_scope || [],
          review_deleted: job.review_deleted || [],
          review_deferred: job.review_deferred || [],
          review_gate: job.review_gate ?? null,
          synced_files: job.synced_files || [],
          pending_user_choice: job.pending_user_choice || null,
          assistant_text: job.assistant_text || '',
          assistant_chars: (job.assistant_text || '').length,
          thinking_text: job.thinking_text || '',
          thinking_chars: (job.thinking_text || '').length,
          // 终态快照带上结论：进度卡可立刻展示，不等 begin 返回后的宿主再思考
          chat_conclusion: terminalNow ? formatChatConclusion(job) : '',
          transcript: job.transcript || [],
        })
      }
      const tick = () => {
        if (closed || ticking) return
        ticking = true
        try {
          healStalePendingReview(id)
          const job = loadJob(id)
          if (!job) {
            writeEv({ type: 'error', message: '任务消失' })
            stop()
            res.end()
            return
          }
          const terminal = terminalOk.includes(job.status)
          let pushedLean = false
          while (cursor < job.events.length) {
            const ev = job.events[cursor]
            cursor += 1
            // 账本 type=done 是同步完成记录，不是 SSE 封口。回放它会让前端在 snapshot 前关流，过程区变空。
            if (ev && ev.type === 'done') continue
            // 终态帧禁止回放 review/auto_apply，避免进度卡被打回「写码中」。
            if (terminal && ev && ev.type === 'review') continue
            writeEv(ev)
            pushedLean = true
          }
          if (terminal) {
            // 终态立刻封口：瘦事件回放（跳过 review）+ 带 transcript 的 snapshot + 带 job_id 的 done。
            // 顺序必须是 snapshot 在前、done 在后，过程区才不会被提前关流抽空。
            writeSnapshot(job)
            writeEv({
              type: 'done',
              status: job.status,
              job_id: job.id,
              chat_conclusion: formatChatConclusion(job),
            })
            stop()
            res.end()
            return
          }
          // 无变更不推 snapshot：避免 150ms 整包重渲把进度卡闪成「demo」
          const sig = snapSig(job)
          if (pushedLean || sig !== lastSnapSig) {
            lastSnapSig = sig
            writeSnapshot(job)
          }
        } finally {
          ticking = false
        }
      }
      // 300ms 兜底 + 账本变更即时推；有 lean 事件时仍带 snapshot 对账
      const timerHandle = setInterval(tick, 300)
      timer = timerHandle
      unsub = onJobChange((changedId) => {
        if (changedId !== id) return
        if (pushTimer) clearTimeout(pushTimer)
        pushTimer = setTimeout(() => {
          pushTimer = undefined
          tick()
        }, 40)
      })
      tick()
      req.on('close', () => {
        stop()
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
    const view = new URL(req.url || '/', 'http://127.0.0.1').searchParams.get('view')
    send(res, 200, { ok: true, job: view === 'card' ? jobCardView(job) : job }, req)
    return
  }

  if (method === 'POST' && path.match(/^\/api\/cursor-chat\/jobs\/[^/]+\/user-choice$/)) {
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
      action: 'cursor-chat.user-choice',
      job_id: id,
    })
    if (!hitl.ok) {
      send(res, 401, { ok: false, detail: hitl.detail, code: hitl.code }, req)
      return
    }
    const job = loadJob(id)
    if (!job) {
      send(res, 404, { ok: false, detail: '任务不存在' }, req)
      return
    }
    if (job.cancelled || ['succeeded', 'failed', 'cancelled'].includes(job.status)) {
      send(res, 409, { ok: false, detail: '任务已结束，无法再确认' }, req)
      return
    }
    const { answerUserChoice } = await import('./userChoice.js')
    const choice = String(body.choice || body.answer || body.option || '').trim()
    const answered = answerUserChoice(id, choice)
    if (!answered.ok) {
      send(res, 400, { ok: false, detail: answered.detail }, req)
      return
    }
    patchJob(id, { pending_user_choice: null })
    const fresh = loadJob(id)!
    appendEvent(fresh, {
      type: 'status',
      message: `用户已选：${answered.answer}`.slice(0, 300),
    })
    send(res, 200, { ok: true, answer: answered.answer, job: loadJob(id) }, req)
    return
  }

  if (method === 'POST' && path.match(/^\/api\/cursor-chat\/jobs\/[^/]+\/cancel$/)) {
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
      action: 'cursor-chat.cancel',
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

  if (method === 'POST' && path.match(/^\/api\/cursor-chat\/jobs\/[^/]+\/restart-backend$/)) {
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
      action: 'cursor-chat.restart-backend',
      job_id: id,
    })
    if (!hitl.ok) {
      send(res, 401, { ok: false, detail: hitl.detail, code: hitl.code }, req)
      return
    }
    const job = loadJob(id)
    if (!job) {
      send(res, 404, { ok: false, detail: '任务不存在' }, req)
      return
    }
    const ready = assertBackendRestartReady(job)
    if (!ready.ok) {
      send(res, 400, { ok: false, detail: ready.detail, code: ready.code }, req)
      return
    }
    const now = new Date().toISOString()
    // 门禁通过后由本机服务真正执行（可见 PowerShell 窗）；禁止只签发就宣称「已重启」
    const exec = executeBackendRestart(ready.offer)
    if (!exec.ok) {
      // 失败不钉 started_at，允许点按钮重试
      patchJob(id, {
        backend_restart: {
          ...ready.offer,
          started_at: null,
          executed: false,
          done_at: null,
          last_detail: exec.detail,
        },
      })
      send(
        res,
        500,
        {
          ok: false,
          job_id: id,
          code: 'execute_failed',
          detail: exec.detail,
          cwd: ready.offer.cwd,
          port: ready.offer.port,
          command: ready.offer.command,
          shell_lines: ready.offer.shell_lines,
        },
        req,
      )
      return
    }
    const offer = {
      ...ready.offer,
      started_at: now,
      executed: true,
      done_at: now,
      last_detail: exec.detail,
    }
    patchJob(id, { backend_restart: offer })
    send(
      res,
      200,
      {
        ok: true,
        job_id: id,
        executed: true,
        cwd: offer.cwd,
        port: offer.port,
        command: offer.command,
        probe_url: offer.probe_url,
        reason: offer.reason,
        shell_lines: offer.shell_lines,
        detail: exec.detail,
      },
      req,
    )
    return
  }

  if (method === 'GET' && path === '/api/cursor-chat/continue-hint') {
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
  const raw = String(process.env.CURSOR_CHAT_SERVER_MODE || 'auto')
    .trim()
    .toLowerCase()
  if (raw === 'child' || raw === 'inplace' || raw === 'auto') return raw
  return 'auto'
}

type OurHealth = { service?: string; buildId?: string; pid?: number }

/** 端口上是本插件服务时返回健康体（含构建指纹），否则 null */
async function probeOurHealth(addr: string): Promise<OurHealth | null> {
  try {
    const res = await fetch(addr + '/health', { signal: AbortSignal.timeout(2000) })
    const body = (await res.json()) as OurHealth
    return body && body.service === SERVICE_NAME ? body : null
  } catch {
    return null
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** 端口上的服务是否就是本次构建；没有指纹的历史服务一律视为过期 */
function isCurrentBuild(health: OurHealth): boolean {
  return !BUILD_ID || health.buildId === BUILD_ID
}

/** 监听指定端口的进程号：POSIX 用 lsof，Windows 用 netstat */
function listenerPids(port: number): number[] {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8' })
      const pids = new Set<number>()
      for (const line of out.split(/\r?\n/)) {
        // 必须精确匹配本地端口：子串匹配会把 :8080 当成 :80，误杀无关进程
        const m = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i)
        if (!m) continue
        if (Number(m[1]) !== port) continue
        const pid = Number(m[2])
        if (Number.isInteger(pid) && pid > 0) pids.add(pid)
      }
      return [...pids]
    }
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
      encoding: 'utf8',
    })
    return out
      .split(/\s+/)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0)
  } catch {
    return []
  }
}

/** 停掉旧版本插件服务并等到端口释放（自动替换残留子进程，避免旧代码一直占端口） */
async function stopStaleServer(addr: string, port: number, pid?: number): Promise<boolean> {
  const pids = new Set<number>()
  // 优先用内核里真实监听该端口的 pid；health.pid 只是服务自报，不能单独作为 kill 目标
  for (const p of listenerPids(port)) if (p !== process.pid) pids.add(p)
  if (pids.size === 0 && pid && pid !== process.pid) pids.add(pid)
  if (pids.size === 0) return false
  for (const p of pids) {
    try {
      process.kill(p, 'SIGTERM')
    } catch {
      /* 已退出 */
    }
  }
  for (let i = 0; i < 30; i += 1) {
    if (!(await probeOurHealth(addr))) return true
    await delay(100)
  }
  for (const p of pids) {
    try {
      process.kill(p, 'SIGKILL')
    } catch {
      /* ignore */
    }
  }
  for (let i = 0; i < 20; i += 1) {
    if (!(await probeOurHealth(addr))) return true
    await delay(100)
  }
  return false
}

export async function startServerInProcess(): Promise<{
  ok: boolean
  addr: string
  detail: string
  already?: boolean
}> {
  if (stripAccidentalMockEnv()) {
    console.warn(
      '[cursor-chat] 已忽略误继承的 CURSOR_CHAT_MOCK（正式写码禁止 Mock；自检请设 CURSOR_CHAT_SELFTEST=1）',
    )
  }
  const cfg = loadConfig()
  if (server?.listening) {
    return { ok: true, addr: listenAddr, detail: 'Cursor 对话写码服务已在运行', already: true }
  }
  return new Promise((resolvePromise) => {
    const s = createServer((req, res) => {
      void handle(req, res).catch((err) => {
        if (!res.headersSent) send(res, 500, { ok: false, detail: '内部错误' }, req)
        console.error('[cursor-chat] handle error', err)
      })
    })
    s.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        const addr = `http://${cfg.listen}:${cfg.port}`
        void (async () => {
          const health = await probeOurHealth(addr)
          if (health) {
            if (isCurrentBuild(health)) {
              listenAddr = addr
              resolvePromise({
                ok: true,
                addr,
                already: true,
                detail: `端口 ${cfg.port} 已是本插件服务：${addr}`,
              })
              return
            }
            const gone = await stopStaleServer(addr, cfg.port, Number(health.pid) || undefined)
            if (gone) {
              resolvePromise(await startServerInProcess())
              return
            }
            resolvePromise({
              ok: false,
              addr: '',
              detail: `端口 ${cfg.port} 上的旧版插件服务无法自动停止，请结束该进程后重试。`,
            })
            return
          }
          resolvePromise({
            ok: false,
            addr: '',
            detail: `端口 ${cfg.port} 已被其它进程占用（不是 dsh-cursor-chat）。请改设置端口或结束占用进程。`,
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
      console.log(`[cursor-chat] 本机服务已监听 ${listenAddr}（inplace）`)
      void recoverOrphanRunningJobs()
        .then((n) => {
          if (n) console.log(`[cursor-chat] 已收口 ${n} 个中断中的写码任务`)
        })
        .catch((err) => console.warn('[cursor-chat] 收口中断任务失败', err))
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
  const health = await probeOurHealth(addr)
  if (health) {
    if (isCurrentBuild(health)) {
      listenAddr = addr
      serverMode = 'child'
      return { ok: true, addr, already: true, detail: `端口已有本插件服务：${addr}` }
    }
    const gone = await stopStaleServer(addr, cfg.port, Number(health.pid) || undefined)
    if (!gone) {
      return {
        ok: false,
        addr: '',
        detail: `端口 ${cfg.port} 上的旧版插件服务无法自动停止，请结束该进程后重试。`,
      }
    }
    console.warn(`[cursor-chat] 已停止端口 ${cfg.port} 上的旧版服务进程，启动新构建`)
  }
  if (childProc && childProc.exitCode == null) {
    for (let i = 0; i < 40; i += 1) {
      const h = await probeOurHealth(addr)
      if (h && isCurrentBuild(h)) {
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

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    CURSOR_CHAT_SERVER_ROLE: 'child',
    CURSOR_CHAT_SERVER_MODE: 'inplace',
    CURSOR_CHAT_PARENT_PID: String(process.pid),
  }
  // 正式子进程不得继承宿主 shell 的 MOCK；自检保留 CURSOR_CHAT_SELFTEST=1 + MOCK
  if (process.env.CURSOR_CHAT_SELFTEST !== '1') {
    delete childEnv.CURSOR_CHAT_MOCK
  }
  const child = spawn(process.execPath, [entry], {
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  })
  childProc = child
  child.stdout?.on('data', (buf) => {
    const t = String(buf || '').trim()
    if (t) console.log('[cursor-chat:child]', t)
  })
  child.stderr?.on('data', (buf) => {
    const t = String(buf || '').trim()
    if (t) console.warn('[cursor-chat:child]', t)
  })
  child.on('exit', (code, signal) => {
    if (childProc === child) childProc = null
    console.warn(`[cursor-chat] 子进程退出 code=${code} signal=${signal || ''}`)
  })

  for (let i = 0; i < 50; i += 1) {
    if (child.exitCode != null) {
      return {
        ok: false,
        addr: '',
        detail: `子进程启动失败（exit ${child.exitCode}）`,
      }
    }
    const h = await probeOurHealth(addr)
    if (h && isCurrentBuild(h)) {
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
 * - CURSOR_CHAT_SERVER_MODE=auto（默认）：优先子进程，失败回退同进程
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
  if (process.env.CURSOR_CHAT_SERVER_ROLE === 'child') {
    return startServerInProcess()
  }

  const prefer = preferredServerMode()
  const cfg = loadConfig()
  const addr = `http://${cfg.listen}:${cfg.port}`

  const health = await probeOurHealth(addr)
  if (health) {
    if (isCurrentBuild(health)) {
      listenAddr = addr
      return {
        ok: true,
        addr,
        already: true,
        detail: `Cursor 对话写码服务已在运行：${addr}`,
      }
    }
    const gone = await stopStaleServer(addr, cfg.port, Number(health.pid) || undefined)
    if (!gone) {
      return {
        ok: false,
        addr: '',
        detail: `端口 ${cfg.port} 上的旧版插件服务无法自动停止，请结束该进程后重试。`,
      }
    }
    console.warn(`[cursor-chat] 已停止端口 ${cfg.port} 上的旧版服务进程，启动新构建`)
  }

  if (prefer === 'inplace') {
    return startServerInProcess()
  }

  const childOut = await startServerChild()
  if (childOut.ok) return childOut
  if (prefer === 'child') return childOut

  console.warn(`[cursor-chat] 子进程不可用，回退同进程：${childOut.detail}`)
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
