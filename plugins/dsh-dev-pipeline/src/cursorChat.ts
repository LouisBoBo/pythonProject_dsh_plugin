/** 对话写码插件 HTTP 客户端：只调 :18791 /api/cursor-chat/*。 */

export const DEFAULT_BASE = 'http://127.0.0.1:18791'
export const HITL_CONFIRM_ACTION = 'cursor-chat.confirm'
export const HITL_CANCEL_ACTION = 'cursor-chat.cancel'
export const API_PREFIX = '/api/cursor-chat'
export const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'blocked_no_runner'])

export interface ProbeResult {
  ok: boolean
  base: string
  detail: string
  cursor_key_configured: boolean
  wrong_service?: boolean
}

export interface CursorJob {
  id: string
  status: string
  detail?: string
  workspace?: string
  changed_files?: string[]
  deleted_files?: string[]
  synced_files?: string[]
  deferred_files?: string[]
  assistant_text?: string
  updated_at?: string
}

export class CursorHttpError extends Error {
  status: number
  network: boolean
  detail: string

  constructor(message: string, status = 0, network = false) {
    super(message)
    this.name = 'CursorHttpError'
    this.status = status
    this.network = network
    this.detail = message
  }
}

interface FetchOptions {
  timeoutMs?: number
  signal?: AbortSignal
}

interface JsonResult {
  status: number
  data: Record<string, unknown>
  network: boolean
}

async function fetchJson(
  method: string,
  url: string,
  body?: Record<string, unknown>,
  opts: FetchOptions = {},
): Promise<JsonResult> {
  const timeoutMs = opts.timeoutMs ?? 30_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  opts.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json', Accept: 'application/json' } : {
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
    const raw = await res.text()
    let data: Record<string, unknown> = {}
    if (raw.trim()) {
      try {
        const parsed = JSON.parse(raw)
        data = parsed && typeof parsed === 'object' ? parsed : { data: parsed }
      } catch {
        data = { detail: raw.slice(0, 500) }
      }
    }
    return { status: res.status, data, network: false }
  } catch (err) {
    return {
      status: 0,
      data: { ok: false, detail: `连接失败：${String(err)}` },
      network: true,
    }
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function baseOf(base: string): string {
  const raw = String(base || '').trim().replace(/\/+$/, '')
  return raw || DEFAULT_BASE
}

export async function probe(base: string, signal?: AbortSignal): Promise<ProbeResult> {
  const b = baseOf(base)
  let cfg = await fetchJson('GET', `${b}/api/config`, undefined, {
    timeoutMs: 5_000,
    signal,
  })
  for (let attempt = 0; cfg.network && attempt < 2 && !signal?.aborted; attempt += 1) {
    await sleep(400)
    cfg = await fetchJson('GET', `${b}/api/config`, undefined, { timeoutMs: 5_000, signal })
  }
  if (cfg.status === 0) {
    return {
      ok: false,
      base: b,
      cursor_key_configured: false,
      detail: `对话写码插件不可达（${b}）；请先安装并启用 @zhongruan/dsh-cursor-chat`,
    }
  }
  const cfgObj =
    cfg.data.config && typeof cfg.data.config === 'object'
      ? (cfg.data.config as Record<string, unknown>)
      : cfg.data
  const keyOk = Boolean(cfgObj.cursorKeyConfigured || cfgObj.cursor_key_configured)

  const route = await fetchJson(
    'GET',
    `${b}${API_PREFIX}/pending-latest?workspace=/`,
    undefined,
    { timeoutMs: 5_000, signal },
  )
  const detail = String(route.data.detail || '')
  if (route.status === 404 || detail.includes('未知路径')) {
    return {
      ok: false,
      base: b,
      cursor_key_configured: keyOk,
      wrong_service: true,
      detail: `${b} 不是对话写码服务；请确认端口是 :18791 且已装 @zhongruan/dsh-cursor-chat`,
    }
  }
  if (cfg.data.ok === false || cfg.status >= 400) {
    return {
      ok: false,
      base: b,
      cursor_key_configured: keyOk,
      detail: String(cfg.data.detail || `配置读取失败 HTTP ${cfg.status}`),
    }
  }
  return {
    ok: true,
    base: b,
    cursor_key_configured: keyOk,
    detail: keyOk ? '对话写码插件就绪' : '对话写码插件可达，但未配置 Cursor API Key',
  }
}

export async function createPending(
  base: string,
  opts: {
    workspace: string
    requirement: string
    sessionId?: string
    images?: Array<{ path: string; mimeType: string; name?: string }>
  },
  signal?: AbortSignal,
): Promise<{ confirm_token: string; image_count: number }> {
  const b = baseOf(base)
  const res = await fetchJson(
    'POST',
    `${b}${API_PREFIX}/pending`,
    {
      workspace: opts.workspace,
      requirement: opts.requirement,
      session_id: opts.sessionId || undefined,
      images: opts.images && opts.images.length ? opts.images : undefined,
    },
    { timeoutMs: 30_000, signal },
  )
  if (res.status >= 400 || res.data.ok === false) {
    throw new Error(String(res.data.detail || `创建确认单失败 HTTP ${res.status}`))
  }
  const token = String(res.data.confirm_token || '').trim()
  if (!token) throw new Error('对话写码未返回 confirm_token')
  const pending =
    res.data.pending && typeof res.data.pending === 'object'
      ? (res.data.pending as Record<string, unknown>)
      : {}
  return { confirm_token: token, image_count: Number(pending.image_count || 0) }
}

export async function issueNonce(
  base: string,
  action: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> {
  const b = baseOf(base)
  const res = await fetchJson(
    'POST',
    `${b}/api/hitl/issue`,
    { action, ...body },
    { timeoutMs: 30_000, signal },
  )
  if (res.status >= 400 || res.data.ok === false) {
    throw new Error(String(res.data.detail || `签发 nonce 失败 HTTP ${res.status}`))
  }
  const nonce = String(res.data.nonce || '').trim()
  if (!nonce) throw new Error('HITL 未返回 nonce')
  return nonce
}

export async function confirmStart(
  base: string,
  opts: { confirmToken: string; nonce: string },
  signal?: AbortSignal,
): Promise<{ job_id: string; job?: CursorJob }> {
  const b = baseOf(base)
  const res = await fetchJson(
    'POST',
    `${b}${API_PREFIX}/confirm`,
    { confirm_token: opts.confirmToken, nonce: opts.nonce },
    { timeoutMs: 60_000, signal },
  )
  if (res.status >= 400 || res.data.ok === false) {
    throw new Error(String(res.data.detail || `确认开工失败 HTTP ${res.status}`))
  }
  const jobId = String(res.data.job_id || '').trim()
  if (!jobId) throw new Error('确认开工未返回 job_id')
  const job =
    res.data.job && typeof res.data.job === 'object'
      ? (res.data.job as CursorJob)
      : undefined
  return { job_id: jobId, job }
}

export async function getJob(
  base: string,
  jobId: string,
  signal?: AbortSignal,
): Promise<CursorJob> {
  const b = baseOf(base)
  const res = await fetchJson(
    'GET',
    `${b}${API_PREFIX}/jobs/${encodeURIComponent(jobId)}`,
    undefined,
    { timeoutMs: 30_000, signal },
  )
  if (res.status >= 400 || res.data.ok === false) {
    throw new CursorHttpError(
      String(res.data.detail || `读取 Job 失败 HTTP ${res.status}`),
      res.status,
      res.network,
    )
  }
  const job =
    res.data.job && typeof res.data.job === 'object'
      ? (res.data.job as CursorJob)
      : (res.data as unknown as CursorJob)
  if (!job.id) job.id = jobId
  return job
}

/** 确认响应丢失时，用会话/需求从 pending 表找回已创建的 Job。 */
export async function latestPending(
  base: string,
  opts: { workspace: string; sessionId?: string; requirement: string },
  signal?: AbortSignal,
): Promise<{ confirm_token: string; job_id: string; status: string } | null> {
  const b = baseOf(base)
  const params = new URLSearchParams({ workspace: opts.workspace })
  if (opts.sessionId) params.set('session_id', opts.sessionId)
  params.set('requirement', opts.requirement)
  const res = await fetchJson(
    'GET',
    `${b}${API_PREFIX}/pending-latest?${params.toString()}`,
    undefined,
    { timeoutMs: 10_000, signal },
  )
  if (res.status >= 400 || res.data.ok === false) return null
  const pending =
    res.data.pending && typeof res.data.pending === 'object'
      ? (res.data.pending as Record<string, unknown>)
      : null
  if (!pending) return null
  return {
    confirm_token: String(pending.confirm_token || ''),
    job_id: String(pending.job_id || ''),
    status: String(pending.status || ''),
  }
}

export async function cancelJob(
  base: string,
  jobId: string,
  signal?: AbortSignal,
): Promise<void> {
  const b = baseOf(base)
  const nonce = await issueNonce(
    b,
    HITL_CANCEL_ACTION,
    { job_id: jobId },
    signal,
  )
  await fetchJson(
    'POST',
    `${b}${API_PREFIX}/jobs/${encodeURIComponent(jobId)}/cancel`,
    { nonce },
    { timeoutMs: 30_000, signal },
  )
}

export interface WaitJobOptions {
  timeoutMs: number
  signal?: AbortSignal
  onUpdate?: (job: CursorJob) => void
  pollMs?: number
}

export async function waitJob(
  base: string,
  jobId: string,
  opts: WaitJobOptions,
): Promise<CursorJob> {
  const deadline = Date.now() + opts.timeoutMs
  const pollMs = opts.pollMs ?? 1500
  let last: CursorJob | null = null
  let networkMisses = 0
  const maxNetworkMisses = 10

  while (Date.now() < deadline) {
    if (opts.signal?.aborted) {
      await cancelJob(base, jobId, undefined).catch(() => undefined)
      throw new Error('已取消')
    }
    let job: CursorJob
    try {
      job = await getJob(base, jobId, opts.signal)
      networkMisses = 0
    } catch (err) {
      if (opts.signal?.aborted) {
        await cancelJob(base, jobId, undefined).catch(() => undefined)
        throw new Error('已取消')
      }
      if (err instanceof CursorHttpError && err.network) {
        networkMisses += 1
        if (networkMisses >= maxNetworkMisses) {
          throw new CursorHttpError(
            `写码插件连接中断（连续 ${networkMisses} 次）：${err.detail}`,
            0,
            true,
          )
        }
        await sleep(pollMs)
        continue
      }
      throw err
    }
    last = job
    opts.onUpdate?.(job)
    if (TERMINAL.has(String(job.status || ''))) return job
    await sleep(pollMs)
  }
  throw new Error(
    `写码 Job 超时（${Math.round(opts.timeoutMs / 1000)}s）；最后状态：${last?.status || '未知'}`,
  )
}
