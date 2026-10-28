import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { classifyCall } from './classify.js'
import { pickUsage, type TokenBreakdown } from './usage.js'

/** 标题生成、网页搜索的供应商用量。会话格式存不下 usage，用量页读这个文件。 */
export function sideUsagePath(home = homedir()): string {
  return join(home, '.dsh', 'key-quota', 'side-usage.jsonl')
}

/** 插件自己的用户用量台账。每次 LLM 调用都记当前登录人，用量与账号一一对应，不依赖引擎 user_id。 */
export function userUsagePath(home = homedir()): string {
  return join(home, '.dsh', 'key-quota', 'user-usage.jsonl')
}

const WEB_SEARCH_TOOL = 'web_search_20250305'

let readUserId = (): string => ''

/** 写入时记下当前登录人。读用量页时不再把别人的补记算到打开页面的人身上。 */
export function setSideUsageUser(read: () => string): void {
  readUserId = read
}

function userId(): string {
  try {
    return readUserId() || ''
  } catch {
    return ''
  }
}

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

type FetchBox = {
  fetch?: FetchFn
  __kqWebSearchFetch?: boolean
}

function shanghaiIso(ms: number): string {
  const sh = new Date(ms + 8 * 60 * 60 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${sh.getUTCFullYear()}-${p(sh.getUTCMonth() + 1)}-${p(sh.getUTCDate())}T${p(sh.getUTCHours())}:${p(sh.getUTCMinutes())}:${p(sh.getUTCSeconds())}+08:00`
}

function newSideId(ms: number): string {
  const stamp = shanghaiIso(ms).replace(/[-:T+]/g, '').slice(0, 14)
  const tail = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')
  return `kqside_${stamp}_${tail}`
}

export function sideEventLine(input: {
  provider: string
  model: string
  usage: TokenBreakdown
  task: string
  lane: string
  sessionId?: string
  now?: number
}): string {
  const now = input.now ?? Date.now()
  return JSON.stringify({
    v: 1,
    id: newSideId(now),
    ts: shanghaiIso(now),
    source: input.lane,
    provider: input.provider,
    model: input.model,
    session_id: input.sessionId || '',
    user_id: userId(),
    quality: 'provider',
    prompt_tokens: input.usage.input,
    completion_tokens: input.usage.output,
    cache_read_tokens: input.usage.cacheRead,
    cache_write_tokens: input.usage.cacheWrite,
    reasoning_tokens: input.usage.reasoning,
    total_tokens: input.usage.total,
    task: input.task,
  })
}

export function appendSideLine(line: string, home = homedir()): void {
  const path = sideUsagePath(home)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  appendFileSync(path, line.endsWith('\n') ? line : `${line}\n`, { encoding: 'utf8', mode: 0o600 })
}

export function appendUserLine(line: string, home = homedir()): void {
  const path = userUsagePath(home)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  appendFileSync(path, line.endsWith('\n') ? line : `${line}\n`, { encoding: 'utf8', mode: 0o600 })
}

/**
 * 标题生成走 llm/stream，purpose 为 session-title。
 * 流上的 usage 块原样转给调用方，供应商数字另记一行。没有 usage 不记。
 */
export async function* recordTitleUsage(
  options: unknown,
  source: AsyncIterable<unknown>,
  write: (line: string) => void = (line) => appendSideLine(line),
): AsyncGenerator<unknown> {
  const meta = classifyCall(options)
  if (meta.source !== 'dsh_title') {
    yield* source
    return
  }
  let usage: TokenBreakdown | null = null
  try {
    for await (const chunk of source) {
      const parsed = pickUsage(chunk)
      if (parsed) usage = parsed
      yield chunk
    }
  } finally {
    if (usage && usage.total > 0) {
      try {
        write(sideEventLine({
          provider: meta.provider,
          model: meta.model,
          usage,
          task: '会话标题',
          lane: 'dsh_title',
          sessionId: meta.sessionId,
        }))
      } catch {
        // 记账失败不打断标题生成
      }
    }
  }
}

/**
 * 所有 LLM 调用都走这里：流上的 usage 块原样转给调用方，
 * 同时把用量连带当前登录人写进用户台账。用量与账号一一对应，不依赖引擎 user_id。
 */
export async function* recordUserUsage(
  options: unknown,
  source: AsyncIterable<unknown>,
  write: (line: string) => void = (line) => appendUserLine(line),
): AsyncGenerator<unknown> {
  const meta = classifyCall(options)
  let usage: TokenBreakdown | null = null
  try {
    for await (const chunk of source) {
      const parsed = pickUsage(chunk)
      if (parsed) usage = parsed
      yield chunk
    }
  } finally {
    if (usage && usage.total > 0) {
      try {
        write(sideEventLine({
          provider: meta.provider,
          model: meta.model,
          usage,
          task: meta.source === 'dsh_title' ? '会话标题' : meta.source,
          lane: meta.source,
          sessionId: meta.sessionId,
        }))
      } catch {
        // 记账失败不打断对话
      }
    }
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url
  return ''
}

function bodyText(body: BodyInit | null | undefined): string {
  if (typeof body === 'string') return body
  if (Buffer.isBuffer(body)) return body.toString('utf8')
  if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8')
  return ''
}

/** 只认宿主请求体里的工具类型，不看用户句子。 */
export function isWebSearchBody(body: string): { model: string } | null {
  if (!body.includes(WEB_SEARCH_TOOL)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const rec = parsed as Record<string, unknown>
  const tools = rec.tools
  if (!Array.isArray(tools)) return null
  const hit = tools.some((tool) => {
    if (!tool || typeof tool !== 'object') return false
    return (tool as Record<string, unknown>).type === WEB_SEARCH_TOOL
  })
  if (!hit) return null
  return { model: typeof rec.model === 'string' ? rec.model : '' }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

function isModelHost(url: string): boolean {
  const host = hostOf(url)
  return host === 'api.deepseek.com' || host.endsWith('.deepseek.com')
    || host === 'open.bigmodel.cn' || host.endsWith('.bigmodel.cn')
}

function providerOfUrl(url: string): string {
  const host = hostOf(url)
  if (host === 'api.deepseek.com' || host.endsWith('.deepseek.com')) return 'deepseek-official'
  if (host === 'open.bigmodel.cn' || host.endsWith('.bigmodel.cn')) return 'zhipu'
  return host
}

/** Anthropic Messages 的 usage 字段名和对话流不一样，先改成 pickUsage 已认识的名字。 */
export function usageFromAnthropic(usage: unknown): TokenBreakdown | null {
  if (!usage || typeof usage !== 'object') return null
  const raw = usage as Record<string, unknown>
  return pickUsage({
    type: 'usage',
    usage: {
      inputTokens: raw.input_tokens ?? raw.inputTokens,
      outputTokens: raw.output_tokens ?? raw.outputTokens,
      cacheReadTokens: raw.cache_read_input_tokens ?? raw.cache_read_tokens ?? raw.cacheReadTokens,
      cacheWriteTokens: raw.cache_creation_input_tokens ?? raw.cache_write_tokens ?? raw.cacheWriteTokens,
      reasoningTokens: raw.reasoning_tokens ?? raw.reasoningTokens,
      totalTokens: raw.total_tokens ?? raw.totalTokens,
    },
  })
}

/**
 * 网页搜索不走 llm/stream，宿主 fetch 后丢掉了 response.usage。
 * 只包带 web_search 工具的请求，响应体原样返回。
 */
export function installWebSearchUsageCapture(
  target: FetchBox = globalThis as FetchBox,
  write: (line: string) => void = (line) => { appendSideLine(line); appendUserLine(line) },
): void {
  if (target.__kqWebSearchFetch) return
  const original = target.fetch
  if (typeof original !== 'function') return
  const call = original.bind(target)
  target.__kqWebSearchFetch = true
  target.fetch = async (input, init) => {
    const response = await call(input, init)
    try {
      const url = requestUrl(input)
      if (!isModelHost(url)) return response
      const text = bodyText(init?.body)
      const search = text ? isWebSearchBody(text) : null
      if (search) {
        const json = await response.clone().json() as { usage?: unknown }
        const usage = usageFromAnthropic(json?.usage)
        if (usage && usage.total > 0) {
          write(sideEventLine({
            provider: providerOfUrl(url),
            model: search.model,
            usage,
            task: '网页搜索',
            lane: 'dsh_search',
          }))
        }
      }
    } catch {
      // 读用量失败不影响搜索结果
    }
    return response
  }
}
