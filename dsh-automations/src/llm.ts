import { loadConfig } from './config.js'
import { AutomationError } from './types.js'

type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string }

export async function chatComplete(messages: ChatMsg[], opts?: { timeoutMs?: number }): Promise<string> {
  const cfg = loadConfig()
  const base = cfg.llmBaseUrl.replace(/\/+$/, '')
  const key = cfg.llmApiKey.trim()
  if (!base || !key) {
    throw new AutomationError('llm_unconfigured', '未配置执行用 LLM（左侧栏「自动化」→ 推送配置 填写 Base URL 与 API Key）')
  }
  const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), opts?.timeoutMs ?? 60_000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: cfg.llmModel || 'deepseek-chat',
        temperature: 0.2,
        messages,
      }),
    })
    const text = await res.text()
    if (!res.ok) {
      throw new AutomationError('llm_unconfigured', `LLM 请求失败 HTTP ${res.status}`)
    }
    let data: { choices?: { message?: { content?: string } }[] }
    try {
      data = JSON.parse(text) as { choices?: { message?: { content?: string } }[] }
    } catch {
      throw new AutomationError('llm_unconfigured', 'LLM 返回非 JSON')
    }
    const content = data.choices?.[0]?.message?.content?.trim() || ''
    if (!content) throw new AutomationError('llm_unconfigured', 'LLM 未返回内容')
    return content
  } finally {
    clearTimeout(t)
  }
}

export function llmConfigured(): boolean {
  const cfg = loadConfig()
  return Boolean(cfg.llmBaseUrl.trim() && cfg.llmApiKey.trim())
}
