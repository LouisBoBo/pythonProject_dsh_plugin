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
 * 只认 chunk.type === 'usage'，数值读 chunk.usage（兼容顶层蛇形字段）。
 * 全 0 视为无用量，返回 null，由调用方记 quality=missing。
 *
 * LOCKED 2026-09-17：分项/合计口径未经用户明确允许不得改。
 * 展示权威在 WorkBuddy `_event_parts`（reasoning 不加 total）。
 * total：有供应商 totalTokens 用原样；否则 input+output+cacheRead+cacheWrite。
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
  // reasoning 只明细，禁止加进合计
  const total = providerTotal > 0 ? providerTotal : parts
  if (parts <= 0 && reasoning <= 0 && providerTotal <= 0) return null
  return { input, output, cacheRead, cacheWrite, reasoning, total }
}
