export type TokenBreakdown = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
  total: number
}

export function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/**
 * 与 plugins/dsh-llm-meter/src/usage.ts 同一口径。
 * LOCKED 2026-09-17：本文件是复制，禁止改公式，也禁止回头改 llm-meter。
 * total：有供应商 totalTokens 用原样；否则 input+output+cacheRead+cacheWrite。
 * reasoning 只明细，不加进合计。
 */
export function pickUsage(chunk: unknown): TokenBreakdown | null {
  if (!chunk || typeof chunk !== 'object') return null
  const rec = chunk as Record<string, unknown>
  if (rec.type !== 'usage') return null
  const raw = rec.usage && typeof rec.usage === 'object' ? rec.usage as Record<string, unknown> : rec
  const input = num(raw.inputTokens ?? raw.input_tokens ?? raw.prompt_tokens)
  const output = num(raw.outputTokens ?? raw.output_tokens ?? raw.completion_tokens)
  const cacheRead = num(raw.cacheReadTokens ?? raw.cache_read_tokens)
  const cacheWrite = num(raw.cacheWriteTokens ?? raw.cache_write_tokens)
  const reasoning = num(raw.reasoningTokens ?? raw.reasoning_tokens)
  const providerTotal = num(raw.totalTokens ?? raw.total_tokens)
  const parts = input + output + cacheRead + cacheWrite
  const total = providerTotal > 0 ? providerTotal : parts
  if (parts <= 0 && reasoning <= 0 && providerTotal <= 0) return null
  return { input, output, cacheRead, cacheWrite, reasoning, total }
}
