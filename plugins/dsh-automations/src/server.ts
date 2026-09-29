import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import {
  applyConfigFromUi,
  editableConfigView,
  loadConfig,
  pluginVersion,
  publicConfigView,
} from './config.js'
import {
  createAutomation,
  deleteAutomation,
  getAutomation,
  listAutomations,
  listRuns,
  recoverOrphanRuns,
  updateAutomation,
} from './store.js'
import { clearAllRunning } from './runtime.js'
import { executeById } from './executor.js'
import { scheduleSummary } from './schedule.js'
import { AUTOMATION_SCHEDULE_PRESETS, AUTOMATION_TEMPLATES, PROMPT_SKELETON } from './templates.js'
import { formatWecomText } from './run_summary_text.js'
import { attachRunCharts } from './mes_charts.js'
import { rewriteAutomationPrompt } from './rewrite.js'
import { startScheduler, stopScheduler } from './scheduler.js'

let server: Server | null = null
let listenAddr = ''

export function isServerRunning(): boolean {
  return Boolean(server)
}

export function getListenAddr(): string {
  return listenAddr
}

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

function corsHeaders(req?: IncomingMessage): Record<string, string> {
  const origin = req ? requestOrigin(req) : ''
  if (origin && isLoopbackBrowserOrigin(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
      Vary: 'Origin',
    }
  }
  return {}
}

function send(res: ServerResponse, status: number, body: unknown, req?: IncomingMessage): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders(req),
  })
  res.end(JSON.stringify(body))
}

function pathname(req: IncomingMessage): string {
  try {
    return new URL(req.url || '/', 'http://127.0.0.1').pathname
  } catch {
    return '/'
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c) => {
      const buf = Buffer.isBuffer(c) ? c : Buffer.from(c)
      size += buf.length
      if (size > 512 * 1024) {
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

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req)
  if (!raw.trim()) return {}
  const data = JSON.parse(raw) as unknown
  if (!data || typeof data !== 'object') return {}
  return data as Record<string, unknown>
}

function rejectNonLoopback(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = requestOrigin(req)
  if (origin && !isLoopbackBrowserOrigin(origin)) {
    send(res, 403, { ok: false, detail: '拒绝非本机 Origin' }, req)
    return true
  }
  return false
}

function withSchedule(items: ReturnType<typeof listAutomations>) {
  return items.map((x) => ({ ...x, schedule_label: scheduleSummary(x) }))
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
    const items = listAutomations(cfg.dataRoot)
    const upcoming = items
      .filter((x) => x.status === 'active' && typeof x.next_run_at === 'number')
      .sort((a, b) => (a.next_run_at || 0) - (b.next_run_at || 0))[0]
    send(
      res,
      200,
      {
        ok: true,
        service: 'dsh-automations',
        version: pluginVersion(),
        listen: listenAddr || `http://${cfg.listen}:${cfg.port}`,
        schedulerEnabled: cfg.schedulerEnabled,
        next: upcoming ? { id: upcoming.id, name: upcoming.name, next_run_at: upcoming.next_run_at } : null,
        view: publicConfigView(cfg),
      },
      req,
    )
    return
  }

  if (rejectNonLoopback(req, res)) return

  if (method === 'GET' && path === '/api/config') {
    send(res, 200, { ok: true, config: editableConfigView(cfg), view: publicConfigView(cfg) }, req)
    return
  }

  if ((method === 'PUT' || method === 'POST') && path === '/api/config') {
    try {
      const body = await readJson(req)
      const next = applyConfigFromUi(body.config && typeof body.config === 'object' ? (body.config as Record<string, unknown>) : body)
      stopScheduler()
      startScheduler()
      send(
        res,
        200,
        {
          ok: true,
          detail: '已保存到本机 ~/.zhongruan/automations/config.json',
          config: editableConfigView(next),
          view: publicConfigView(next),
        },
        req,
      )
    } catch (e) {
      send(res, 400, { ok: false, detail: e instanceof Error ? e.message : String(e) }, req)
    }
    return
  }

  if (method === 'GET' && path === '/api/templates') {
    send(res, 200, { ok: true, items: AUTOMATION_TEMPLATES, presets: AUTOMATION_SCHEDULE_PRESETS, skeleton: PROMPT_SKELETON }, req)
    return
  }

  if (method === 'POST' && path === '/api/rewrite-prompt') {
    try {
      const body = await readJson(req)
      const prompt = await rewriteAutomationPrompt(
        String(body.draft || body.prompt || ''),
        String(body.task_name || body.name || ''),
      )
      send(res, 200, { ok: true, prompt }, req)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const client = msg.includes('请先') || msg.includes('未配置') || msg.includes('未返回')
      send(res, client ? 400 : 502, { ok: false, detail: msg }, req)
    }
    return
  }

  if (method === 'GET' && path === '/api/automations') {
    send(res, 200, { ok: true, items: withSchedule(listAutomations(cfg.dataRoot)) }, req)
    return
  }

  if (method === 'POST' && path === '/api/automations') {
    try {
      const body = await readJson(req)
      const item = await createAutomation(cfg.dataRoot, body)
      send(res, 200, { ok: true, item: { ...item, schedule_label: scheduleSummary(item) } }, req)
    } catch (e) {
      send(res, 400, { ok: false, detail: e instanceof Error ? e.message : String(e) }, req)
    }
    return
  }

  if (method === 'GET' && path === '/api/automations/runs') {
    const u = new URL(req.url || '/', 'http://127.0.0.1')
    const page = Number(u.searchParams.get('page') || '1')
    const pageSize = Number(u.searchParams.get('page_size') || '10')
    const listed = listRuns(cfg.dataRoot, page, pageSize)
    send(
      res,
      200,
      {
        ok: true,
        ...listed,
        items: listed.items.map((row) => ({
          ...row,
          display_text: row.summary
            ? formatWecomText(row.summary, row.automation_name, row.started_at)
            : '',
          charts: attachRunCharts(row),
        })),
      },
      req,
    )
    return
  }

  const idMatch = path.match(/^\/api\/automations\/([^/]+)(\/run)?$/)
  if (idMatch) {
    const id = decodeURIComponent(idMatch[1])
    if (method === 'PATCH') {
      const body = await readJson(req)
      const item = await updateAutomation(cfg.dataRoot, id, body)
      if (!item) {
        send(res, 404, { ok: false, detail: '任务不存在' }, req)
        return
      }
      send(res, 200, { ok: true, item: { ...item, schedule_label: scheduleSummary(item) } }, req)
      return
    }
    if (method === 'DELETE') {
      const ok = await deleteAutomation(cfg.dataRoot, id)
      send(res, ok ? 200 : 404, { ok, detail: ok ? '已删除任务定义（运行记录保留）' : '任务不存在' }, req)
      return
    }
    if (method === 'POST' && idMatch[2] === '/run') {
      const found = getAutomation(cfg.dataRoot, id)
      if (!found) {
        send(res, 404, { ok: false, detail: '任务不存在' }, req)
        return
      }
      const result = await executeById(cfg.dataRoot, id)
      if (result.skipped && result.reason === 'already_running') {
        send(res, 409, { ok: false, code: 'already_running', detail: '已有任务在执行' }, req)
        return
      }
      send(res, result.ok ? 200 : 400, { ok: result.ok, run: result.run, detail: result.reason || result.run?.error?.message }, req)
      return
    }
  }

  send(res, 404, { ok: false, detail: 'not found' }, req)
}

export async function startServer(): Promise<{ ok: boolean; addr: string; detail: string }> {
  if (server) return { ok: true, addr: listenAddr, detail: `已在监听 ${listenAddr}` }
  const cfg = loadConfig()
  await recoverOrphanRuns(cfg.dataRoot)
  await clearAllRunning(cfg.dataRoot)

  return new Promise((resolve) => {
    const s = createServer((req, res) => {
      void handle(req, res).catch((err) => {
        console.warn('[automations] handle error', err)
        if (!res.headersSent) send(res, 500, { ok: false, detail: '内部错误' }, req)
      })
    })
    s.once('error', (err: NodeJS.ErrnoException) => {
      const detail =
        err.code === 'EADDRINUSE'
          ? `端口 ${cfg.port} 已被占用。请改设置端口或结束占用进程（不要误杀写码 18788 / 审码 18787）。`
          : String(err)
      resolve({ ok: false, addr: '', detail })
    })
    s.listen(cfg.port, cfg.listen, () => {
      server = s
      listenAddr = `http://${cfg.listen}:${cfg.port}`
      console.log(`[automations] 本机服务已监听 ${listenAddr}`)
      startScheduler()
      resolve({ ok: true, addr: listenAddr, detail: `服务: ${listenAddr}` })
    })
  })
}

export async function stopServer(): Promise<{ ok: boolean; detail: string }> {
  stopScheduler()
  if (!server) return { ok: true, detail: '服务未运行' }
  const s = server
  server = null
  listenAddr = ''
  return new Promise((resolve) => {
    s.close(() => resolve({ ok: true, detail: '已停止' }))
  })
}
