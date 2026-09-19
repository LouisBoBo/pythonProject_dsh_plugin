import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { loadConfig, publicConfigView, saveConfig } from './config.js'
import { publicCatalog } from './catalog.js'
import {
  applyScene,
  clearSessionScene,
  loadState,
  patchState,
  publicState,
  saveState,
  setActiveExpert,
  setConnectorEnabled,
  setSkillEnabled,
  summonScene,
  unsummonScene,
  summonExpert,
  unsummonExpert,
  OUTBOUND_CONNECTOR_IDS,
} from './store.js'
import {
  createUserScene,
  deleteUserScene,
  publicScenes,
  reviewSceneCombo,
} from './scenes.js'
import { keepOrReplace, normalizeHttpBaseUrl } from './util.js'
import { PLUGIN_VERSION } from './util.js'
import { probeMes } from './adapters/mes.js'
import { probeDify } from './adapters/dify.js'
import { probeChart } from './adapters/mcp_chart.js'
import { probeWecom } from './adapters/wecom.js'
import { probeFeishu } from './adapters/feishu.js'
import { assertPublicHttpUrl, probeWebRead } from './adapters/web_read.js'
import type { ConnectorConfig, QueryResult, SceneReview } from './types.js'

let server: Server | null = null
let listenAddr = ''
let onStateChange: (() => void) | null = null

export function setOnStateChange(fn: () => void): void {
  onStateChange = fn
}

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
    'Cache-Control': 'no-store',
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
      if (size > 256 * 1024) {
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

function notify(): void {
  try {
    onStateChange?.()
  } catch {
    /* ignore */
  }
}

function reviewFromError(e: unknown): SceneReview | undefined {
  if (e && typeof e === 'object' && 'review' in e) {
    return (e as { review: SceneReview }).review
  }
  return undefined
}

function buildDraft(_state: ReturnType<typeof loadState>, _dataRoot: string) {
  return null
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

  // 健康检查：版本、监听地址、当前专家
  if (method === 'GET' && (path === '/health' || path === '/')) {
    const state = loadState(cfg.dataRoot)
    send(
      res,
      200,
      {
        ok: true,
        service: 'dsh-esc',
        version: PLUGIN_VERSION,
        listen: listenAddr || `http://${cfg.listen}:${cfg.port}`,
        view: publicConfigView(cfg),
        state: publicState(state),
      },
      req,
    )
    return
  }

  if (rejectNonLoopback(req, res)) return

  // 预制专家 / 技能 / 连接器 / 场景列表（含本机自建卡）
  if (method === 'GET' && path === '/api/catalog') {
    send(res, 200, { ok: true, ...publicCatalog(publicScenes(cfg.dataRoot)) }, req)
    return
  }

  // 查询启用状态、当前专家、本会话场景卡
  if (method === 'GET' && path === '/api/session-state') {
    const u = new URL(req.url || '/', 'http://127.0.0.1')
    const sessionId = u.searchParams.get('sessionId') || ''
    const state = loadState(cfg.dataRoot)
    send(res, 200, { ok: true, state: publicState(state, sessionId), draft: buildDraft(state, cfg.dataRoot) }, req)
    return
  }

  // 设置当前专家、启用技能/连接器
  if (method === 'PUT' && path === '/api/session-state') {
    try {
      const body = await readJson(req)
      let state = loadState(cfg.dataRoot)
      if ('activeExpertId' in body) {
        const id = body.activeExpertId === null || body.activeExpertId === '' ? null : String(body.activeExpertId)
        state = await setActiveExpert(cfg.dataRoot, id)
      }
      if (body.skillId) {
        state = await setSkillEnabled(cfg.dataRoot, String(body.skillId), Boolean(body.enabled))
      }
      if (body.connectorId && 'enabled' in body && !body.skillId) {
        state = await setConnectorEnabled(cfg.dataRoot, String(body.connectorId), Boolean(body.enabled))
      }
      notify()
      send(res, 200, { ok: true, state: publicState(state) }, req)
    } catch (e) {
      send(res, 400, { ok: false, detail: e instanceof Error ? e.message : String(e) }, req)
    }
    return
  }

  if (method === 'POST' && path === '/api/scenes/review') {
    try {
      const body = await readJson(req)
      const review = reviewSceneCombo(
        String(body.expertId || ''),
        Array.isArray(body.skillIds) ? body.skillIds.map((x) => String(x)) : [],
        Array.isArray(body.connectorIds) ? body.connectorIds.map((x) => String(x)) : [],
        { existing: publicScenes(cfg.dataRoot), ignoreSceneId: body.ignoreSceneId ? String(body.ignoreSceneId) : undefined },
      )
      send(res, 200, { ok: review.ok, review }, req)
    } catch (e) {
      send(res, 400, { ok: false, detail: e instanceof Error ? e.message : String(e) }, req)
    }
    return
  }

  // 创建自建场景卡（规则审核不通过则拒绝）
  if (method === 'POST' && path === '/api/scenes' && !path.endsWith('/apply') && !path.endsWith('/review')) {
    try {
      const body = await readJson(req)
      const created = createUserScene(cfg.dataRoot, {
        title: String(body.title || ''),
        description: String(body.description || ''),
        expertId: String(body.expertId || ''),
        skillIds: Array.isArray(body.skillIds) ? body.skillIds.map((x) => String(x)) : [],
        connectorIds: Array.isArray(body.connectorIds) ? body.connectorIds.map((x) => String(x)) : [],
      })
      notify()
      send(res, 200, { ok: true, scene: created.scene, review: created.review }, req)
    } catch (e) {
      const review = reviewFromError(e)
      send(res, 400, { ok: false, detail: e instanceof Error ? e.message : String(e), review }, req)
    }
    return
  }

  const delScene = path.match(/^\/api\/scenes\/([^/]+)$/)
  if (delScene && method === 'DELETE') {
    try {
      deleteUserScene(cfg.dataRoot, decodeURIComponent(delScene[1]))
      await unsummonScene(cfg.dataRoot, decodeURIComponent(delScene[1]))
      notify()
      send(res, 200, { ok: true }, req)
    } catch (e) {
      send(res, 400, { ok: false, detail: e instanceof Error ? e.message : String(e) }, req)
    }
    return
  }

  if (method === 'POST' && path === '/api/scenes/summon') {
    try {
      const body = await readJson(req)
      const sceneId = String(body.sceneId || body.id || '')
      const state = await summonScene(cfg.dataRoot, sceneId)
      notify()
      send(res, 200, { ok: true, state: publicState(state), detail: '已召唤该场景卡' }, req)
    } catch (e) {
      send(res, 400, { ok: false, detail: e instanceof Error ? e.message : String(e) }, req)
    }
    return
  }

  if (method === 'POST' && path === '/api/scenes/unsummon') {
    try {
      const body = await readJson(req)
      const sceneId = String(body.sceneId || body.id || '')
      const state = await unsummonScene(cfg.dataRoot, sceneId)
      notify()
      send(res, 200, { ok: true, state: publicState(state), detail: '已取消召唤' }, req)
    } catch (e) {
      send(res, 400, { ok: false, detail: e instanceof Error ? e.message : String(e) }, req)
    }
    return
  }

  if (method === 'POST' && path === '/api/experts/summon') {
    try {
      const body = await readJson(req)
      const expertId = String(body.expertId || body.id || '')
      const state = await summonExpert(cfg.dataRoot, expertId)
      notify()
      send(res, 200, { ok: true, state: publicState(state), detail: '已召唤该专家' }, req)
    } catch (e) {
      send(res, 400, { ok: false, detail: e instanceof Error ? e.message : String(e) }, req)
    }
    return
  }

  if (method === 'POST' && path === '/api/experts/unsummon') {
    try {
      const body = await readJson(req)
      const expertId = String(body.expertId || body.id || '')
      const state = await unsummonExpert(cfg.dataRoot, expertId)
      notify()
      send(res, 200, { ok: true, state: publicState(state), detail: '已取消召唤' }, req)
    } catch (e) {
      send(res, 400, { ok: false, detail: e instanceof Error ? e.message : String(e) }, req)
    }
    return
  }

  if (method === 'POST' && path === '/api/scenes/apply') {
    try {
      const body = await readJson(req)
      const sessionId = String(body.sessionId || '').trim()
      const sceneId = String(body.sceneId || body.id || '')
      const state = await applyScene(cfg.dataRoot, sceneId, sessionId || undefined, { armOutbound: true })
      notify()
      send(
        res,
        200,
        {
          ok: true,
          state: publicState(state, sessionId),
          detail: sessionId ? '已把该场景卡绑到本会话，整段对话有效' : '已启用该场景的专家、技能与连接器',
        },
        req,
      )
    } catch (e) {
      send(res, 400, { ok: false, detail: e instanceof Error ? e.message : String(e) }, req)
    }
    return
  }

  // 清除本会话场景卡（权威字段 sceneId 空字符串）
  if (method === 'POST' && path === '/api/session-scene/clear') {
    try {
      const body = await readJson(req)
      const sessionId = String(body.sessionId || '').trim()
      const state = await clearSessionScene(cfg.dataRoot, sessionId)
      notify()
      send(res, 200, { ok: true, state: publicState(state, sessionId), detail: '已清除本会话场景卡' }, req)
    } catch (e) {
      send(res, 400, { ok: false, detail: e instanceof Error ? e.message : String(e) }, req)
    }
    return
  }

  const connMatch = path.match(/^\/api\/connectors\/([^/]+)\/(config|test)$/)
  if (connMatch) {
    const id = decodeURIComponent(connMatch[1])
    const action = connMatch[2]
    const state = loadState(cfg.dataRoot)
    const row = state.connectors[id]
    if (!row) {
      send(res, 404, { ok: false, detail: '未知连接器' }, req)
      return
    }
    // 保存连接器地址与密钥（回读脱敏）
    if (action === 'config' && method === 'PUT') {
      try {
        const body = await readJson(req)
        const enabled = 'enabled' in body ? Boolean(body.enabled) : row.enabled
        let mode = body.mode === 'http' ? 'http' : body.mode === 'mock' ? 'mock' : row.mode
        if (enabled && body.mode !== 'mock') {
          if (id === 'mes' || id === 'mcp-chart' || id === 'mcp-wecom' || id === 'mcp-feishu' || id === 'mcp-web-read') {
            mode = 'http'
          }
        }
        const nextRow: ConnectorConfig = {
          ...row,
          enabled,
          mode,
          datasetId: 'datasetId' in body ? String(body.datasetId || '').trim() : row.datasetId,
          apiKey: keepOrReplace(body.apiKey, row.apiKey),
          password: keepOrReplace(body.password, row.password),
          token: keepOrReplace(body.token, row.token),
        }
        if (id === 'dify') {
          nextRow.baseUrl =
            'baseUrl' in body ? normalizeHttpBaseUrl(String(body.baseUrl || ''), '连接器地址') : row.baseUrl
          nextRow.username = 'username' in body ? String(body.username || '').trim() : row.username
          nextRow.enterpriseCode =
            'enterpriseCode' in body ? String(body.enterpriseCode || '').trim() : row.enterpriseCode
        } else if (id === 'mcp-chart') {
          nextRow.apiKey = ''
          nextRow.password = ''
          nextRow.token = ''
          nextRow.username = ''
          if ('baseUrl' in body) {
            const raw = String(body.baseUrl || '').trim()
            if (!raw) nextRow.baseUrl = ''
            else {
              const url = assertPublicHttpUrl(raw)
              if (url.protocol !== 'https:') throw new Error('图表服务只允许 https')
              url.hash = ''
              nextRow.baseUrl = url.href.replace(/\/+$/, '')
            }
          }
        } else {
          nextRow.baseUrl = ''
          nextRow.username = ''
          nextRow.password = ''
          nextRow.token = ''
          nextRow.apiKey = ''
          nextRow.enterpriseCode =
            id === 'mes' && 'enterpriseCode' in body
              ? String(body.enterpriseCode || '').trim()
              : row.enterpriseCode
        }
        if (OUTBOUND_CONNECTOR_IDS.has(id) && 'enabled' in body) {
          nextRow.outboundArmed = enabled
        }
        const next = await patchState(cfg.dataRoot, { connectors: { ...state.connectors, [id]: nextRow } })
        notify()
        send(res, 200, { ok: true, state: publicState(next) }, req)
      } catch (e) {
        send(res, 400, { ok: false, detail: e instanceof Error ? e.message : String(e) }, req)
      }
      return
    }
    // 测连通
    if (action === 'test' && method === 'POST') {
      const probes: Record<string, (row: ConnectorConfig) => Promise<QueryResult>> = {
        mes: probeMes,
        dify: probeDify,
        'mcp-chart': probeChart,
        'mcp-wecom': probeWecom,
        'mcp-feishu': probeFeishu,
        'mcp-web-read': probeWebRead,
      }
      const probe = probes[id]
      if (!probe) {
        send(res, 404, { ok: false, detail: '该连接器无测通实现' }, req)
        return
      }
      const result = await probe(row)
      send(res, result.ok ? 200 : 400, { ok: result.ok, result }, req)
      return
    }
  }

  if (method === 'GET' && path === '/api/settings') {
    send(res, 200, { ok: true, view: publicConfigView(cfg) }, req)
    return
  }

  if (method === 'PUT' && path === '/api/settings') {
    try {
      const body = await readJson(req)
      let port = cfg.port
      if (body.port !== undefined && String(body.port).trim() !== '') {
        const n = Number(body.port)
        if (!Number.isInteger(n) || n <= 0 || n > 65535) throw new Error(`端口非法：${body.port}`)
        port = n
      }
      const next = saveConfig({ port })
      send(res, 200, { ok: true, view: publicConfigView(next), detail: '已保存。改端口后请重启宿主再连。' }, req)
    } catch (e) {
      send(res, 400, { ok: false, detail: e instanceof Error ? e.message : String(e) }, req)
    }
    return
  }

  send(res, 404, { ok: false, detail: 'not found' }, req)
}

export async function startServer(): Promise<{ ok: boolean; addr: string; detail: string }> {
  if (server) return { ok: true, addr: listenAddr, detail: `已在监听 ${listenAddr}` }
  const cfg = loadConfig()
  await saveState(cfg.dataRoot, loadState(cfg.dataRoot))
  return new Promise((resolve) => {
    const s = createServer((req, res) => {
      void handle(req, res).catch((err) => {
        console.warn('[esc] handle error', err)
        if (!res.headersSent) send(res, 500, { ok: false, detail: '内部错误' }, req)
      })
    })
    s.once('error', (err: NodeJS.ErrnoException) => {
      const detail =
        err.code === 'EADDRINUSE'
          ? `端口 ${cfg.port} 已被占用。请改设置端口（不要误杀写码 18788 / 审码 18787 / 自动化 18789）。`
          : String(err)
      resolve({ ok: false, addr: '', detail })
    })
    s.listen(cfg.port, cfg.listen, () => {
      server = s
      listenAddr = `http://${cfg.listen}:${cfg.port}`
      console.log(`[esc] 本机服务已监听 ${listenAddr}`)
      resolve({ ok: true, addr: listenAddr, detail: `服务: ${listenAddr}` })
    })
  })
}
