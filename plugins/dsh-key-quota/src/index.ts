import type { Server } from 'node:http'
import { assignDenyMessage, hasAssignee, resolveAssignedKey, usesDeepseekApiKey } from './bind.js'
import { classifyCall, METER_SOURCES } from './classify.js'
import { resolveConfig, type QuotaConfig } from './config.js'
import { denyMessage, type Snap } from './decide.js'
import { platformSession } from './engine-usage.js'
import { keyIdOf, tailOf } from './key-id.js'
import { Ledger } from './ledger.js'
import { PendingStore, type PendingRow } from './pending.js'
import { periodOf } from './period.js'
import { advertiseUrls, loadClientPanel, loadReportToken, registerQuotaWeb, startQuotaServer, type QuotaHttpOpts, type QuotaLogger } from './server.js'
import { installAssignedKeyTransport, pullWithAssignedKey } from './transport.js'
import { KeyVault } from './vault.js'
import { readDeepseekApiKey } from './workbuddy-key.js'
import { installWebSearchUsageCapture, recordTitleUsage, setSideUsageUser } from './side-usage.js'
import { gateStream, quotaFinishChunk, type GateArgs } from './wrap.js'

export { Config } from './config.js'
export const name = 'key-quota'
export const inject = ['llm'] as const

type WebServer = Parameters<typeof registerQuotaWeb>[0]

type Credentials = {
  resolve: (ref: string) => Promise<{ value: string, source: string } | undefined>
}

type Host = {
  on?: (name: string, fn: (options: unknown, next: () => AsyncIterable<unknown>) => AsyncIterable<unknown>, opts?: { global?: boolean }) => void
  logger?: QuotaLogger
  effect?: (fn: () => (() => void) | void) => void
  inject?: (deps: string[], plugin: (httpCtx: { webServer?: WebServer; get?: (name: string) => unknown; effect?: (dispose: () => void) => void }) => void) => void
  webServer?: WebServer
  get?: (name: string) => unknown
  credentials?: Credentials
}

/**
 * 取 credentials 服务。禁止读 `ctx.credentials`：未在 inject 声明时 Cordis 会抛
 * `cannot get property "credentials" without inject`，整插件启用失败。
 */
export function resolveCredentialsService(ctx: Host): Credentials | undefined {
  let found: unknown
  try {
    found = typeof ctx.get === 'function' ? ctx.get('credentials') : undefined
  } catch {
    return undefined
  }
  if (!found || typeof found !== 'object' || typeof (found as Credentials).resolve !== 'function') return undefined
  return found as Credentials
}

function installCredentialsTransport(ctx: Host): void {
  installAssignedKeyTransport(resolveCredentialsService(ctx))
  if (typeof ctx.inject !== 'function') return
  try {
    // credentials 可能晚于本插件就绪；挂上后再补一层 resolve 拦截
    ctx.inject(['credentials'], (credCtx) => {
      installAssignedKeyTransport(resolveCredentialsService(credCtx as Host))
    })
  } catch {
    // 宿主无 credentials 服务时保持仅 fetch 改写
  }
}

type Prepared = GateArgs | { pass: true }

async function postJson(url: string, token: string, keyId: string, body: unknown): Promise<Record<string, unknown> | null> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'x-key-id': keyId,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(3000),
  })
  const parsed = await res.json() as Record<string, unknown>
  if (!res.ok) return null
  return parsed
}

function snapFrom(body: Record<string, unknown> | null): Snap | null {
  if (!body || body.ok !== true || typeof body.period !== 'string') return null
  const limit = body.limitTokens
  return {
    used: Number(body.used) || 0,
    limitTokens: limit == null ? null : Number(limit),
    blocked: body.blocked === true,
    period: body.period,
  }
}

export function apply(ctx: Host, config?: QuotaConfig): void {
  const cfg = resolveConfig(config)
  if (!cfg.enabled) return

  const logger = ctx.logger
  const pending = new PendingStore(cfg.dataDir)
  const ledger = new Ledger(cfg.dataDir)
  const vault = new KeyVault(cfg.dataDir)
  installCredentialsTransport(ctx)
  let sideUserId = ''
  setSideUsageUser(() => sideUserId)
  const reportToken = loadReportToken(cfg.dataDir, cfg.reportToken, cfg.role === 'server')
  let server: Server | null = null

  const httpOpts: QuotaHttpOpts = {
    logger,
    apiKey: () => readDeepseekApiKey(),
    deps: {
      ledger,
      reportToken,
      role: cfg.role,
      advertiseUrls: cfg.role === 'server' ? advertiseUrls(cfg.port) : [],
      session: () => platformSession(),
      seal: (apiKey) => vault.seal(apiKey),
    },
    clientPanel: cfg.role === 'client'
      ? () => loadClientPanel({
          apiKey: readDeepseekApiKey(),
          quotaBaseUrl: cfg.quotaBaseUrl,
          reportToken: cfg.reportToken,
        })
      : undefined,
  }

  try {
    server = startQuotaServer({
      ...httpOpts,
      listen: cfg.listen,
      port: cfg.port,
    })
  } catch (err) {
    logger?.warn?.(`key-quota: 服务未启动（${err instanceof Error ? err.message : String(err)}）。管理页可能打不开。`)
  }

  attachQuotaPage(ctx, httpOpts)

  const close = () => {
    server?.close()
  }
  try {
    ctx.effect?.(() => close)
  } catch {
    // 宿主没有 effect 时随进程退出
  }

  try {
    installWebSearchUsageCapture()
  } catch (err) {
    logger?.warn?.(`key-quota: 网页搜索用量未挂上（${err instanceof Error ? err.message : String(err)}）。搜索结果不受影响。`)
  }

  if (typeof ctx.on !== 'function') return

  try {
    ctx.on('llm/stream', (options, next) => {
      const title = classifyCall(options).source === 'dsh_title'
      // 还没有任何分配时不换 Key、不拒绝。有分配之后，未分到的账号才走 key_unassigned。
      if (!usesDeepseekApiKey(options) || !hasAssignee(ledger.entries())) {
        if (title) {
          try { sideUserId = platformSession().viewer?.id || '' } catch { sideUserId = '' }
        }
        return title ? recordTitleUsage(options, next()) : next()
      }
      return (async function* () {
        const viewerId = platformSession().viewer?.id || ''
        sideUserId = viewerId
        const bound = resolveAssignedKey({
          viewerId,
          rows: ledger.entries(),
          open: (sealed) => vault.open(sealed),
        })
        if (!bound.ok) {
          yield quotaFinishChunk(bound.code, assignDenyMessage(bound.code))
          return
        }
        const row = ledger.get(bound.keyId)
        if (!row || row.assigneeUserId !== viewerId) {
          yield quotaFinishChunk('key_unassigned', assignDenyMessage('key_unassigned'))
          return
        }
        let prepared: Prepared
        try {
          prepared = await prepare(bound.apiKey, viewerId)
        } catch (err) {
          logger?.warn?.(`key-quota: 限额检查失败，本次不发出（${err instanceof Error ? err.message : String(err)}）`)
          yield quotaFinishChunk('quota_unreachable', denyMessage('quota_unreachable', 0, null))
          return
        }
        if ('pass' in prepared) {
          yield quotaFinishChunk('key_unassigned', assignDenyMessage('key_unassigned'))
          return
        }
        installAssignedKeyTransport(resolveCredentialsService(ctx))
        const stream = pullWithAssignedKey(bound.apiKey, gateStream(options, next, prepared))
        yield* title ? recordTitleUsage(options, stream) : stream
      })()
    }, { global: true })
  } catch (err) {
    logger?.warn?.(`key-quota: 未挂上 llm/stream（${err instanceof Error ? err.message : String(err)}）。聊天保持原样。`)
    close()
  }

  async function prepare(apiKey: string, viewerId: string): Promise<Prepared> {
    if (!apiKey) return { pass: true }
    const period = periodOf()
    const keyId = keyIdOf(apiKey)
    if (cfg.role === 'server') {
      const row = ledger.get(keyId)
      if (!row || row.assigneeUserId !== viewerId) return { pass: true }
      const snap: Snap = {
        used: ledger.used(keyId, period),
        limitTokens: row.limitTokens,
        blocked: row.blocked,
        period,
      }
      return {
        quotaBaseUrl: cfg.quotaBaseUrl || 'http://127.0.0.1',
        apiKey,
        period,
        pendingTotal: 0,
        snap,
        lastServer: snap,
        report: (body) => localReport(keyId, body),
      }
    }
    await flushPending(keyId)
    let snap: Snap | null = null
    try {
      snap = snapFrom(await postJson(`${cfg.quotaBaseUrl}/v1/check`, reportToken, keyId, {
        keyId,
        tail: tailOf(apiKey),
        period,
      }))
      if (snap) pending.saveSnap(snap)
    } catch {
      snap = null
    }
    return {
      quotaBaseUrl: cfg.quotaBaseUrl,
      apiKey,
      period,
      pendingTotal: pending.total(period),
      snap,
      lastServer: pending.loadSnap(),
      report: (row) => sendReport(row),
    }
  }

  async function flushPending(keyId: string): Promise<void> {
    for (const row of pending.list()) {
      try {
        const body = await postJson(`${cfg.quotaBaseUrl}/v1/report`, reportToken, keyId, row.body)
        if (body?.ok === true) pending.remove(row.callId)
        else break
      } catch {
        break
      }
    }
  }

  async function localReport(expectedKeyId: string, row: Record<string, unknown>): Promise<void> {
    const keyId = String(row.keyId || '')
    if (!expectedKeyId || keyId !== expectedKeyId) return
    const source = String(row.source || 'dsh_other')
    await ledger.report({
      callId: String(row.callId || ''),
      keyId,
      tail: String(row.tail || '').slice(-4),
      period: String(row.period || periodOf()),
      source: (METER_SOURCES as readonly string[]).includes(source) ? source as typeof METER_SOURCES[number] : 'dsh_other',
      model: String(row.model || '').slice(0, 80),
      quality: row.quality === 'provider' ? 'provider' : 'missing',
      prompt_tokens: Number(row.prompt_tokens) || 0,
      completion_tokens: Number(row.completion_tokens) || 0,
      cache_read_tokens: Number(row.cache_read_tokens) || 0,
      cache_write_tokens: Number(row.cache_write_tokens) || 0,
      reasoning_tokens: Number(row.reasoning_tokens) || 0,
      total_tokens: Number(row.total_tokens) || 0,
    })
  }

  async function sendReport(row: Record<string, unknown>): Promise<void> {
    const callId = String(row.callId || '')
    const item: PendingRow = {
      callId,
      period: String(row.period || ''),
      total_tokens: Number(row.total_tokens) || 0,
      body: row,
    }
    pending.add(item)
    try {
      const body = await postJson(`${cfg.quotaBaseUrl}/v1/report`, reportToken, String(row.keyId || ''), row)
      if (body?.ok === true) pending.remove(callId)
    } catch {
      // 留在 pending，下次调用再补
    }
  }
}

function attachQuotaPage(ctx: Host, opts: QuotaHttpOpts): void {
  const register = (httpCtx: { webServer?: WebServer; get?: (name: string) => unknown; effect?: (dispose: () => void) => void }) => {
    const server = httpCtx.webServer ?? (typeof httpCtx.get === 'function' ? httpCtx.get('webServer') as WebServer | undefined : undefined)
    if (!server || typeof server.register !== 'function') return
    try {
      const dispose = registerQuotaWeb(server, opts)
      httpCtx.effect?.(() => dispose)
    } catch (err) {
      ctx.logger?.warn?.(`key-quota: 页面接口未挂上（${err instanceof Error ? err.message : String(err)}）`)
    }
  }
  try {
    if (typeof ctx.inject === 'function') ctx.inject(['webServer'], register)
    else if (ctx.webServer) register({ webServer: ctx.webServer })
  } catch (err) {
    ctx.logger?.warn?.(`key-quota: 页面接口未挂上（${err instanceof Error ? err.message : String(err)}）`)
  }
}
