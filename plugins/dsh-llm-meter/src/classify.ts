export const METER_SOURCES = ['dsh_chat', 'dsh_knowledge', 'dsh_memory', 'dsh_title', 'dsh_other'] as const
export type MeterSource = (typeof METER_SOURCES)[number]

export type CallMeta = {
  source: MeterSource
  sessionId: string
  provider: string
  model: string
  promptChars: number
}

const SOURCE_SET = new Set<string>(METER_SOURCES)

type ClassifyOptions = {
  isAgentLoop?: (options: object) => boolean
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function explicitSource(options: Record<string, unknown>): MeterSource | null {
  const raw = options.meterTag ?? options.llmMeterTag
  if (typeof raw !== 'string') return null
  const tag = raw.trim()
  return SOURCE_SET.has(tag) ? tag as MeterSource : null
}

function systemText(options: Record<string, unknown>): string {
  return typeof options.system === 'string' ? options.system : ''
}

function sessionIdOf(options: Record<string, unknown>): string {
  const sid = options.sessionId
  return typeof sid === 'string' ? sid : ''
}

function purposeOf(options: Record<string, unknown>): string {
  return typeof options.purpose === 'string' ? options.purpose : ''
}

/** 只计字符数，不返回正文。 */
export function countPromptChars(options: unknown): number {
  const rec = asRecord(options)
  let n = systemText(rec).length
  const messages = rec.messages
  if (!Array.isArray(messages)) return n
  for (const msg of messages) {
    const row = asRecord(msg)
    const content = row.content
    if (typeof content === 'string') {
      n += content.length
      continue
    }
    if (!Array.isArray(content)) continue
    for (const block of content) {
      const text = asRecord(block).text
      if (typeof text === 'string') n += text.length
    }
  }
  return n
}

/**
 * 来源标签：显式字段与 GenerateOptions.purpose 优先于启发式。
 * 不扫用户消息正文；不改 options。
 */
export function classifyCall(options: unknown, extras: ClassifyOptions = {}): CallMeta {
  const rec = asRecord(options)
  const sessionId = sessionIdOf(rec)
  const provider = typeof rec.provider === 'string' ? rec.provider : ''
  const model = typeof rec.model === 'string' ? rec.model : ''
  const promptChars = countPromptChars(rec)
  const tagged = explicitSource(rec)
  if (tagged) return { source: tagged, sessionId, provider, model, promptChars }

  const purpose = purposeOf(rec)
  if (purpose === 'session-title') {
    return { source: 'dsh_title', sessionId, provider, model, promptChars }
  }
  if (purpose === 'compaction') {
    return { source: 'dsh_other', sessionId, provider, model, promptChars }
  }

  const sys = systemText(rec)
  if (/knowledge base|document-oriented knowledge|Extract only knowledge/i.test(sys)) {
    return { source: 'dsh_knowledge', sessionId, provider, model, promptChars }
  }
  if (/mneme|dream|consolidat|summarize_compress/i.test(sys)) {
    return { source: 'dsh_memory', sessionId, provider, model, promptChars }
  }
  if (/会话标题|session title|title/i.test(sys) && sys.length < 2000) {
    return { source: 'dsh_title', sessionId, provider, model, promptChars }
  }

  if (extras.isAgentLoop?.(rec)) {
    return { source: 'dsh_chat', sessionId, provider, model, promptChars }
  }
  return { source: sessionId ? 'dsh_chat' : 'dsh_other', sessionId, provider, model, promptChars }
}
