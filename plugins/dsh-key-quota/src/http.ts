import { timingSafeEqual } from 'node:crypto'
import type { PlatformViewer } from './engine-usage.js'
import { keyIdOf, tailOf } from './key-id.js'
import type { Ledger } from './ledger.js'
import { periodOf } from './period.js'

export type DispatchResult = {
  status: number
  body: Record<string, unknown>
}

export type DispatchDeps = {
  ledger: Ledger
  reportToken: string
  role: 'client' | 'server'
  now?: () => Date
  /** 生产环境由本机 Key 计算后传入，浏览器不能改。测试不传则认请求头。 */
  localKeyId?: string | null
  /** 仅 server 的本机面板告诉同事该填的地址。 */
  advertiseUrls?: string[]
  /** 工作助手当前登录。不传时管理页不认管理员。 */
  session?: () => { viewer: PlatformViewer | null, colleagues: Array<{ id: string, displayName: string }> }
  /** 保存 Key 原文的密文。不传时只登记尾号，调用时不能取出。 */
  seal?: (apiKey: string) => string
}

type HttpInput = {
  method: string
  path: string
  headers: Record<string, string | undefined>
  body: unknown
  remoteAddress: string
}

const METER_SOURCES = new Set(['dsh_chat', 'dsh_knowledge', 'dsh_memory', 'dsh_title', 'dsh_other'])

export function isLoopback(addr: string): boolean {
  const host = addr.trim().toLowerCase().replace(/^::ffff:/, '')
  return host === '127.0.0.1' || host === '::1'
}

function fail(status: number, code: string, message: string): DispatchResult {
  return { status, body: { ok: false, error: { code, message } } }
}

function header(headers: Record<string, string | undefined>, name: string): string {
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())
  return found?.[1]?.trim() || ''
}

function tokenOk(expected: string, authorization: string): boolean {
  const got = authorization.replace(/^Bearer\s+/i, '').trim()
  const a = Buffer.from(expected)
  const b = Buffer.from(got)
  if (a.length === 0 || a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

/** 本机回环由服务端放入 localKeyId，避免页面伪造别人的 Key。局域网请求才认 X-Key-Id。 */
function actor(input: HttpInput, deps: DispatchDeps): string {
  if (typeof deps.localKeyId === 'string') return deps.localKeyId
  return header(input.headers, 'x-key-id')
}

function publicSelf(ledger: Ledger, keyId: string, period: string): Record<string, unknown> | null {
  const row = ledger.get(keyId)
  if (!row) return null
  return {
    tail: row.tail,
    alias: row.alias,
    role: row.role,
    blocked: row.blocked,
    limitTokens: row.limitTokens,
    used: ledger.used(keyId, period),
    period,
  }
}

function currentSession(deps: DispatchDeps): { viewer: PlatformViewer | null, colleagues: Array<{ id: string, displayName: string }> } {
  return deps.session?.() ?? { viewer: null, colleagues: [] }
}

function publicKey(ledger: Ledger, keyId: string, period: string): Record<string, unknown> | null {
  const row = ledger.get(keyId)
  if (!row) return null
  return {
    keyId,
    tail: row.tail,
    assigneeUserId: row.assigneeUserId || '',
    assigneeName: row.assigneeName || '',
    blocked: row.blocked,
    limitTokens: row.limitTokens,
    used: ledger.used(keyId, period),
    ready: Boolean(row.sealed),
    period,
  }
}

function fullKeys(ledger: Ledger, period: string): Array<Record<string, unknown>> {
  return ledger.entries().map((row) => ({
    keyId: row.keyId,
    tail: row.tail,
    alias: row.alias,
    assigneeUserId: row.assigneeUserId || '',
    assigneeName: row.assigneeName || '',
    role: row.role,
    blocked: row.blocked,
    limitTokens: row.limitTokens,
    used: ledger.used(row.keyId, period),
    ready: Boolean(row.sealed),
    period,
  }))
}

export async function dispatch(input: HttpInput, deps: DispatchDeps): Promise<DispatchResult> {
  const method = input.method.toUpperCase()
  const path = input.path.split('?')[0]
  const loopback = isLoopback(input.remoteAddress)
  const period = periodOf(deps.now?.() ?? new Date())

  if (method === 'POST' && path === '/v1/local/admin') {
    if (!loopback || deps.role !== 'server') {
      return fail(403, 'admin_appoint_local_only', '只能在运行额度服务的这台电脑上指定管理员。')
    }
    const keyId = String(asRecord(input.body).keyId || '')
    const result = await deps.ledger.appoint(keyId)
    if (!result.ok) return fail(404, 'not_found', '这把 Key 还没有登记。')
    return { status: 200, body: { ok: true, keyId } }
  }

  if (method === 'GET' && path === '/v1/local/panel') {
    if (!loopback) return fail(403, 'not_owner', '本机面板只接受本机访问。')
    const session = currentSession(deps)
    const admin = session.viewer?.role === 'admin'
    const mine = session.viewer
      ? deps.ledger.entries().find((row) => row.assigneeUserId === session.viewer?.id)
      : undefined
    return {
      status: 200,
      body: {
        ok: true,
        viewer: session.viewer
          ? { id: session.viewer.id, displayName: session.viewer.displayName, admin }
          : null,
        colleagues: admin ? session.colleagues : [],
        keys: admin ? fullKeys(deps.ledger, period) : null,
        self: !admin && mine ? publicKey(deps.ledger, mine.keyId, period) : null,
      },
    }
  }

  if (method === 'POST' && path === '/v1/local/keys') {
    if (!loopback) return fail(403, 'not_admin', '只能在本机管理 Key。')
    const session = currentSession(deps)
    if (session.viewer?.role !== 'admin') return fail(403, 'not_admin', '只有管理员可以分配 Key。')
    const body = asRecord(input.body)
    const apiKey = String(body.apiKey || '').trim()
    const assigneeUserId = String(body.assigneeUserId || '').trim()
    const person = session.colleagues.find((item) => item.id === assigneeUserId)
    if (apiKey.length < 8 || !person) return fail(400, 'not_found', '请填写 Key，并选择平台上的同事。')
    const limitTokens = body.limitTokens == null || body.limitTokens === '' ? null : Number(body.limitTokens)
    if (limitTokens != null && (!Number.isFinite(limitTokens) || limitTokens < 0)) {
      return fail(400, 'not_found', '上限需要是大于等于 0 的整数。')
    }
    const tail = tailOf(apiKey)
    let sealed = ''
    if (deps.seal) {
      try {
        sealed = deps.seal(apiKey)
      } catch {
        return fail(500, 'not_found', '这把 Key 没有保存成功。')
      }
      if (!sealed) return fail(500, 'not_found', '这把 Key 没有保存成功。')
    }
    await deps.ledger.assign({
      keyId: keyIdOf(apiKey),
      tail,
      assigneeUserId: person.id,
      assigneeName: person.displayName,
      limitTokens,
      sealed,
    })
    return { status: 200, body: { ok: true, tail, assigneeUserId: person.id } }
  }

  const localKey = path.match(/^\/v1\/local\/keys\/([^/]+)$/)
  if (localKey && method === 'DELETE') {
    if (!loopback) return fail(403, 'not_admin', '只能在本机管理 Key。')
    if (currentSession(deps).viewer?.role !== 'admin') return fail(403, 'not_admin', '只有管理员可以删除 Key。')
    const result = await deps.ledger.remove(decodeURIComponent(localKey[1]))
    if (!result.ok) return fail(404, 'not_found', '这把 Key 还没有登记。')
    return { status: 200, body: { ok: true } }
  }

  const localPatch = method === 'PATCH' ? localKey : null
  if (localPatch) {
    if (!loopback) return fail(403, 'not_admin', '只能在本机管理 Key。')
    if (currentSession(deps).viewer?.role !== 'admin') return fail(403, 'not_admin', '只有管理员可以设置限额。')
    const body = asRecord(input.body)
    const hasLimit = Object.prototype.hasOwnProperty.call(body, 'limitTokens')
    const limitTokens = hasLimit && body.limitTokens != null ? Number(body.limitTokens) : null
    const result = await deps.ledger.patch(decodeURIComponent(localPatch[1]), {
      alias: typeof body.alias === 'string' ? body.alias : undefined,
      blocked: typeof body.blocked === 'boolean' ? body.blocked : undefined,
      limitTokens: hasLimit ? limitTokens : undefined,
      hasLimit,
    })
    if (!result.ok) return fail(404, 'not_found', '这把 Key 还没有登记。')
    return { status: 200, body: { ok: true } }
  }

  if (!tokenOk(deps.reportToken, header(input.headers, 'authorization'))) {
    return fail(401, 'not_owner', '上报令牌不正确。')
  }

  const caller = actor(input, deps)
  if (!caller) return fail(400, 'not_owner', '缺少 Key 标识。')

  if (method === 'GET' && path === '/v1/me') {
    const self = publicSelf(deps.ledger, caller, period)
    if (!self) return fail(404, 'not_found', '这把 Key 还没有登记。')
    return { status: 200, body: { ok: true, ...self } }
  }

  if (method === 'GET' && path === '/v1/admin/keys') {
    if (deps.ledger.get(caller)?.role !== 'admin') {
      return fail(403, 'not_admin', '只有管理员可以查看全部 Key。')
    }
    return { status: 200, body: { ok: true, keys: fullKeys(deps.ledger, period) } }
  }

  const patchMatch = method === 'PATCH' ? path.match(/^\/v1\/admin\/keys\/([^/]+)$/) : null
  if (patchMatch) {
    if (deps.ledger.get(caller)?.role !== 'admin') {
      return fail(403, 'not_admin', '只有管理员可以设置限额。')
    }
    const body = asRecord(input.body)
    if ('role' in body) return fail(403, 'role_change_forbidden', '改限额的接口不能指定管理员。')
    const keyId = decodeURIComponent(patchMatch[1])
    const hasLimit = Object.prototype.hasOwnProperty.call(body, 'limitTokens')
    const limitTokens = hasLimit && body.limitTokens != null ? Number(body.limitTokens) : null
    const result = await deps.ledger.patch(keyId, {
      alias: typeof body.alias === 'string' ? body.alias : undefined,
      blocked: typeof body.blocked === 'boolean' ? body.blocked : undefined,
      limitTokens: hasLimit ? limitTokens : undefined,
      hasLimit,
    })
    if (!result.ok) return fail(404, 'not_found', '这把 Key 还没有登记。')
    return { status: 200, body: { ok: true } }
  }

  if (method === 'POST' && path === '/v1/check') {
    const body = asRecord(input.body)
    const keyId = String(body.keyId || '')
    if (keyId !== caller) return fail(403, 'not_owner', '只能查询自己的 Key。')
    const row = deps.ledger.ensure(keyId, String(body.tail || '').slice(-4), period)
    const used = deps.ledger.used(keyId, period)
    const allow = !row.blocked && (row.limitTokens == null || used < row.limitTokens)
    return {
      status: 200,
      body: {
        ok: true,
        allow,
        blocked: row.blocked,
        limitTokens: row.limitTokens,
        used,
        period,
        alias: row.alias,
        role: row.role,
      },
    }
  }

  if (method === 'POST' && path === '/v1/report') {
    const body = asRecord(input.body)
    const keyId = String(body.keyId || '')
    if (keyId !== caller) return fail(403, 'not_owner', '只能上报自己的 Key。')
    const source = String(body.source || 'dsh_other')
    const quality = body.quality === 'provider' ? 'provider' : 'missing'
    const result = await deps.ledger.report({
      callId: String(body.callId || ''),
      keyId,
      tail: String(body.tail || '').slice(-4),
      period,
      source: METER_SOURCES.has(source) ? source : 'dsh_other',
      model: String(body.model || '').slice(0, 80),
      quality,
      prompt_tokens: Number(body.prompt_tokens) || 0,
      completion_tokens: Number(body.completion_tokens) || 0,
      cache_read_tokens: Number(body.cache_read_tokens) || 0,
      cache_write_tokens: Number(body.cache_write_tokens) || 0,
      reasoning_tokens: Number(body.reasoning_tokens) || 0,
      total_tokens: Number(body.total_tokens) || 0,
    })
    return { status: 200, body: { ok: true, duplicate: result.duplicate, used: result.used, period } }
  }

  return fail(404, 'not_found', '没有这个接口。')
}
