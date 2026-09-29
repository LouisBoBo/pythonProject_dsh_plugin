import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { applyConfigFromUi, editableConfigView, loadConfig, publicConfigView } from './config.js'
import { listWikiSpaces } from './feishu-docs.js'
import { installCommitWebhookHook } from './hook-install.js'
import { listJobs, loadJob, jobSummary } from './jobs.js'
import { parseWebhookPayload, verifyWebhookSecret } from './payload.js'
import { enqueueReview, sendJobToFeishu } from './pipeline.js'
import { engineStatus } from './review-client.js'

let server: Server | null = null
let listenAddr = ''

function requestOrigin(req: IncomingMessage): string {
  return String(req.headers.origin || '').trim()
}

function isLoopbackBrowserOrigin(origin: string): boolean {
  if (!origin) return false
  try {
    const u = new URL(origin)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost'
  } catch {
    return false
  }
}

/** 仅对本机 Origin 回显 ACAO；禁止 *，避免恶意页读 loopback 管理接口 */
function corsHeaders(req?: IncomingMessage): Record<string, string> {
  const origin = req ? requestOrigin(req) : ''
  if (origin && isLoopbackBrowserOrigin(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers':
        'Content-Type, X-Remote-Review-Secret, X-Gitlab-Token, X-GitHub-Event, X-Gitlab-Event',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
      Vary: 'Origin',
    }
  }
  return {}
}

/** 管理接口鉴权：已配置 secret 时必须带密钥；未配置时仍拒绝非本机浏览器 Origin */
function requireAdmin(
  req: IncomingMessage,
  cfg: ReturnType<typeof loadConfig>,
): { ok: boolean; detail?: string } {
  const origin = requestOrigin(req)
  if (origin && !isLoopbackBrowserOrigin(origin)) {
    return { ok: false, detail: '拒绝非本机 Origin 跨域访问管理接口' }
  }
  return verifyWebhookSecret({
    configuredSecret: cfg.secret,
    headers: req.headers,
    listenHost: cfg.listen,
    requireSecret: process.env.REMOTE_REVIEW_REQUIRE_SECRET === '1',
  })
}

function send(res: ServerResponse, status: number, body: unknown, req?: IncomingMessage): void {
  const text = JSON.stringify(body, null, 2)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders(req),
  })
  res.end(text)
}

const MAX_BODY = 1024 * 1024

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
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
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
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

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const cfg = loadConfig()
  const path = pathname(req)
  const method = (req.method || 'GET').toUpperCase()

  if (method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req))
    res.end()
    return
  }

  if (method === 'GET' && (path === '/health' || path === '/')) {
    const engine = await engineStatus(cfg.engine)
    send(res, 200, {
      ok: true,
      service: 'dsh-remote-review',
      listen: listenAddr || `http://${cfg.listen}:${cfg.port}`,
      webhook: `http://${cfg.listen}:${cfg.port}/webhook`,
      config: publicConfigView(cfg),
      engine,
    }, req)
    return
  }

  // 浏览器打开 Payload URL 是 GET；正式触发必须用 POST
  if (method === 'GET' && path === '/webhook') {
    send(res, 200, {
      ok: true,
      service: 'dsh-remote-review',
      detail: 'Webhook 正常。请用 POST 提交（GitHub/GitLab/IDE Hook）；浏览器 GET 仅用于确认地址可达。',
      method_required: 'POST',
      content_type: 'application/json',
      health: '/health',
    }, req)
    return
  }

  if (method === 'GET' && path === '/api/config') {
    const auth = requireAdmin(req, cfg)
    if (!auth.ok) {
      const origin = requestOrigin(req)
      if (origin && !isLoopbackBrowserOrigin(origin)) {
        send(res, 403, { ok: false, detail: auth.detail || '拒绝非本机 Origin' }, req)
        return
      }
      const sent = Boolean(
        req.headers['x-remote-review-secret'] ||
          req.headers['x-gitlab-token'] ||
          req.headers['x-hub-signature-256'],
      )
      if (sent) {
        send(res, 401, { ok: false, detail: auth.detail || '未授权' }, req)
        return
      }
      // 未带密钥：不返回可编辑配置（含 App ID / wiki token）
      send(res, 200, {
        ok: true,
        config: null,
        view: publicConfigView(cfg),
        needSecret: Boolean(cfg.secret.trim()),
        detail: auth.detail || '管理接口需要 X-Remote-Review-Secret',
      }, req)
      return
    }
    send(res, 200, { ok: true, config: editableConfigView(cfg), view: publicConfigView(cfg) }, req)
    return
  }

  if (method === 'GET' && path === '/api/feishu/wiki-spaces') {
    const auth = requireAdmin(req, cfg)
    if (!auth.ok) {
      send(res, 401, { ok: false, detail: auth.detail || '未授权' }, req)
      return
    }
    const listed = await listWikiSpaces(cfg)
    send(res, listed.ok ? 200 : 400, listed, req)
    return
  }

  if (method === 'PUT' && path === '/api/config') {
    const auth = requireAdmin(req, cfg)
    if (!auth.ok) {
      send(res, 401, { ok: false, detail: auth.detail || '未授权' }, req)
      return
    }
    let parsed: Record<string, unknown> = {}
    try {
      const raw = await readBody(req)
      parsed = raw.trim() ? (JSON.parse(raw) as Record<string, unknown>) : {}
    } catch {
      send(res, 400, { ok: false, detail: 'JSON 无法解析' }, req)
      return
    }
    try {
      const body = (parsed.config && typeof parsed.config === 'object'
        ? parsed.config
        : parsed) as Record<string, unknown>
      const next = applyConfigFromUi(body)
      send(res, 200, {
        ok: true,
        detail: '已保存到本机 ~/.zhongruan/remote-review/config.json（未写入任何项目仓库）',
        config: editableConfigView(next),
        view: publicConfigView(next),
        note:
          next.port !== cfg.port || next.listen !== cfg.listen
            ? '端口或监听地址已变更，请重启 Webhook 服务后生效'
            : undefined,
      }, req)
    } catch (err) {
      send(res, 400, { ok: false, detail: String(err) }, req)
    }
    return
  }

  if (method === 'POST' && path === '/api/install-hook') {
    const auth = requireAdmin(req, cfg)
    if (!auth.ok) {
      send(res, 401, { ok: false, detail: auth.detail || '未授权' }, req)
      return
    }
    let parsed: Record<string, unknown> = {}
    try {
      const raw = await readBody(req)
      parsed = raw.trim() ? (JSON.parse(raw) as Record<string, unknown>) : {}
    } catch {
      send(res, 400, { ok: false, detail: 'JSON 无法解析' }, req)
      return
    }
    const repoPath = String(parsed.repoPath || parsed.repo_path || '').trim()
    if (!repoPath) {
      send(res, 400, { ok: false, detail: '请填写业务仓库绝对路径 repoPath' }, req)
      return
    }
    const out = installCommitWebhookHook(repoPath)
    send(res, out.ok ? 200 : 400, out, req)
    return
  }

  if (method === 'GET' && path === '/jobs') {
    const auth = requireAdmin(req, cfg)
    if (!auth.ok) {
      send(res, 401, { ok: false, detail: auth.detail || '未授权' }, req)
      return
    }
    const jobs = listJobs(30)
    send(res, 200, { ok: true, count: jobs.length, items: jobs.map(jobSummary), jobs }, req)
    return
  }

  if (method === 'GET' && path.startsWith('/jobs/')) {
    const auth = requireAdmin(req, cfg)
    if (!auth.ok) {
      send(res, 401, { ok: false, detail: auth.detail || '未授权' }, req)
      return
    }
    const id = decodeURIComponent(path.slice('/jobs/'.length))
    const job = loadJob(id)
    if (!job) {
      send(res, 404, { ok: false, detail: '任务不存在' }, req)
      return
    }
    send(res, 200, { ok: true, job }, req)
    return
  }

  if (method === 'POST' && path.endsWith('/retry-feishu') && path.startsWith('/jobs/')) {
    const auth = requireAdmin(req, cfg)
    if (!auth.ok) {
      send(res, 401, { ok: false, detail: auth.detail || '未授权' }, req)
      return
    }
    const id = decodeURIComponent(path.slice('/jobs/'.length, path.length - '/retry-feishu'.length))
    try {
      const job = await sendJobToFeishu(id)
      send(res, 200, { ok: job.status === 'feishu_ok', job }, req)
    } catch (err) {
      send(res, 400, { ok: false, detail: String(err) }, req)
    }
    return
  }

  if (method === 'POST' && (path === '/webhook' || path === '/simulate')) {
    let raw = ''
    let parsed: unknown = {}
    try {
      raw = await readBody(req)
      parsed = raw.trim() ? JSON.parse(raw) : {}
    } catch {
      send(res, 400, { ok: false, detail: 'JSON 无法解析' }, req)
      return
    }
    const auth = verifyWebhookSecret({
      configuredSecret: cfg.secret,
      headers: req.headers,
      listenHost: cfg.listen,
      requireSecret: process.env.REMOTE_REVIEW_REQUIRE_SECRET === '1',
      rawBody: raw,
    })
    if (!auth.ok) {
      send(res, 401, { ok: false, detail: auth.detail }, req)
      return
    }
    if (path === '/simulate' && parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>
      if (!obj.event) obj.event = 'simulate'
    }
    const event = parseWebhookPayload(parsed, req.headers)
    const job = await enqueueReview(event)
    send(res, 202, {
      ok: true,
      accepted: true,
      jobId: job.id,
      status: job.status,
      detail: job.detail || '已入队，后台调用现有审码 API，完成后写飞书文档',
    }, req)
    return
  }

  send(res, 404, { ok: false, detail: `未知路径 ${method} ${path}` }, req)
}

export function isServerRunning(): boolean {
  return Boolean(server?.listening)
}

export function getListenAddr(): string {
  return listenAddr
}

async function probeConfigApi(base: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const cfg = loadConfig()
    const headers: Record<string, string> = {}
    if (cfg.secret.trim()) headers['X-Remote-Review-Secret'] = cfg.secret.trim()
    const res = await fetch(`${base.replace(/\/$/, '')}/api/config`, {
      headers,
      signal: AbortSignal.timeout(2500),
    })
    if (res.status === 404) {
      return {
        ok: false,
        detail:
          `端口上的进程是旧版服务（没有设置保存接口）。请关掉终端里旧的 node lib/cli.js / pnpm start，或执行: lsof -nP -iTCP:${base.split(':').pop()} -sTCP:LISTEN 后结束该进程，再重开 WorkBuddy`,
      }
    }
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      detail?: string
      config?: unknown
      needSecret?: boolean
    }
    if (res.status === 401) {
      return { ok: false, detail: data.detail || '管理接口需要 Webhook 密钥' }
    }
    // 无密钥时服务可能返回 ok+无 config；只要不是 404 且进程能应答即视为同端口服务
    if (!res.ok || data.ok === false) {
      return { ok: false, detail: data.detail || `探测 /api/config 失败 HTTP ${res.status}` }
    }
    return { ok: true, detail: '已有可用的远端审码服务' }
  } catch (err) {
    return {
      ok: false,
      detail: `端口已被占用且无法访问设置接口：${String(err)}。请结束占用进程后重开 WorkBuddy`,
    }
  }
}

export async function startServer(): Promise<{ ok: boolean; addr: string; detail: string; already?: boolean }> {
  const cfg = loadConfig()
  if (server?.listening) {
    return { ok: true, addr: listenAddr, detail: 'Webhook 服务已在运行', already: true }
  }
  return new Promise((resolve) => {
    const s = createServer((req, res) => {
      void handle(req, res).catch((err) => {
        if (!res.headersSent) send(res, 500, { ok: false, detail: String(err) }, req)
      })
    })
    s.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        const addr = `http://${cfg.listen}:${cfg.port}`
        listenAddr = addr
        void probeConfigApi(addr).then((probe) => {
          resolve({
            ok: probe.ok,
            addr,
            already: true,
            detail: probe.ok
              ? `端口 ${cfg.port} 已有可用服务：${addr}/webhook`
              : probe.detail,
          })
        })
        return
      }
      resolve({ ok: false, addr: '', detail: String(err) })
    })
    s.listen(cfg.port, cfg.listen, () => {
      server = s
      listenAddr = `http://${cfg.listen}:${cfg.port}`
      console.log(`[remote-review] Webhook 已监听 ${listenAddr}/webhook`)
      resolve({ ok: true, addr: listenAddr, detail: `Webhook: ${listenAddr}/webhook` })
    })
  })
}

export async function stopServer(): Promise<{ ok: boolean; detail: string }> {
  if (!server) return { ok: true, detail: 'Webhook 服务未运行' }
  const s = server
  server = null
  listenAddr = ''
  return new Promise((resolve) => {
    s.close(() => resolve({ ok: true, detail: 'Webhook 服务已停止' }))
  })
}
