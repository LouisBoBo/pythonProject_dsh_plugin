import { loadConfig } from './config.js'
import { AutomationError } from './types.js'
import { readWorkbuddyCreds } from './workbuddy_config.js'

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'
export type ChatToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}
export type ChatMessage = {
  role: ChatRole
  content?: string | null
  name?: string
  tool_call_id?: string
  tool_calls?: ChatToolCall[]
}
export type ChatTool = {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string }

function resolveLlm(): { base: string; key: string; model: string } {
  const cfg = loadConfig()
  const wb = readWorkbuddyCreds()
  return {
    base: (cfg.llmBaseUrl.trim() || wb.llmBaseUrl).replace(/\/+$/, ''),
    key: cfg.llmApiKey.trim() || wb.llmApiKey,
    model: cfg.llmModel.trim() || wb.llmModel || 'deepseek-chat',
  }
}

/** 对照 simplified：DeepSeek 根域名补 /v1，再拼 chat/completions。拒绝 userinfo，避免把密钥打到其它主机。 */
export function chatCompletionsUrl(base: string): string {
  const raw = String(base || '').trim()
  if (!raw) return ''
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return ''
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
  if (u.username || u.password) return ''
  let path = u.pathname.replace(/\/+$/, '')
  if (path.endsWith('/chat/completions')) return `${u.origin}${path}`
  if (/^api\.deepseek\.com$/i.test(u.hostname) && !/\/v\d+$/i.test(path)) {
    path = path && path !== '/' ? `${path}/v1` : '/v1'
  }
  const prefix = !path || path === '/' ? '' : path
  return `${u.origin}${prefix}/chat/completions`
}

function parseToolCalls(msg: {
  content?: string | null
  tool_calls?: ChatToolCall[]
  function_call?: { name?: string; arguments?: string }
}): ChatToolCall[] {
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) return msg.tool_calls
  const fn = msg.function_call
  if (fn?.name) {
    return [
      {
        id: 'call_0',
        type: 'function',
        function: { name: fn.name, arguments: fn.arguments || '{}' },
      },
    ]
  }
  return []
}

async function postChat(
  cred: { base: string; key: string; model: string },
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<{
  content: string
  tool_calls: ChatToolCall[]
}> {
  const url = chatCompletionsUrl(cred.base)
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cred.key}`,
      },
      body: JSON.stringify(payload),
    })
    const text = await res.text()
    if (!res.ok) {
      throw new AutomationError('llm_failed', 'AI 暂时不可用，请稍后重试或手工完善指令')
    }
    let data: {
      choices?: {
        message?: {
          content?: string | null
          tool_calls?: ChatToolCall[]
          function_call?: { name?: string; arguments?: string }
        }
      }[]
    }
    try {
      data = JSON.parse(text) as typeof data
    } catch {
      throw new AutomationError('llm_failed', 'AI 返回异常，请稍后重试')
    }
    const msg = data.choices?.[0]?.message || {}
    const tool_calls = parseToolCalls(msg)
    const content = String(msg.content || '').trim()
    if (!content && !tool_calls.length) {
      throw new AutomationError('llm_failed', 'AI 未返回有效内容')
    }
    return { content, tool_calls }
  } finally {
    clearTimeout(t)
  }
}

export async function chatComplete(
  messages: ChatMsg[],
  opts?: { timeoutMs?: number; maxTokens?: number },
): Promise<string> {
  const cred = resolveLlm()
  if (!cred.base || !cred.key) {
    throw new AutomationError(
      'llm_unconfigured',
      '未配置执行用 LLM。请到 WorkBuddy「系统配置」填写对话模型。',
    )
  }
  const payload: Record<string, unknown> = {
    model: cred.model,
    temperature: 0.2,
    messages,
  }
  if (opts?.maxTokens && opts.maxTokens > 0) payload.max_tokens = opts.maxTokens
  const out = await postChat(cred, payload, opts?.timeoutMs ?? 60_000)
  return out.content
}

export async function chatWithTools(
  messages: ChatMessage[],
  tools: ChatTool[],
  handler: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  opts?: { timeoutMs?: number; maxTokens?: number; maxRounds?: number },
): Promise<string> {
  const cred = resolveLlm()
  if (!cred.base || !cred.key) {
    throw new AutomationError(
      'llm_unconfigured',
      '未配置执行用 LLM。请到 WorkBuddy「系统配置」填写对话模型。',
    )
  }
  const history = messages.map((m) => ({ ...m }))
  const maxRounds = Math.min(8, Math.max(1, opts?.maxRounds ?? 6))
  const timeoutMs = opts?.timeoutMs ?? 45_000
  for (let round = 0; round < maxRounds; round++) {
    const payload: Record<string, unknown> = {
      model: cred.model,
      temperature: 0.2,
      messages: history,
      tools,
      tool_choice: 'auto',
    }
    if (opts?.maxTokens && opts.maxTokens > 0) payload.max_tokens = opts.maxTokens
    const out = await postChat(cred, payload, timeoutMs)
    if (!out.tool_calls.length) return out.content
    history.push({
      role: 'assistant',
      content: out.content || '',
      tool_calls: out.tool_calls,
    })
    for (const call of out.tool_calls) {
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(call.function?.arguments || '{}') as Record<string, unknown>
      } catch {
        args = {}
      }
      let result: unknown
      try {
        result = await handler(String(call.function?.name || ''), args)
      } catch (e) {
        result = { error: e instanceof Error ? e.message : String(e) }
      }
      history.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.function?.name,
        content: JSON.stringify(result).slice(0, 12000),
      })
    }
  }
  throw new AutomationError('llm_failed', 'MES 查数轮次过多，未得到有效摘要')
}

export function llmConfigured(): boolean {
  const cred = resolveLlm()
  return Boolean(cred.base && cred.key)
}
