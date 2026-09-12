/**
 * 合并 Cursor SDK 正文增量（改编自 WorkBuddy _absorb_plain / _merge_assistant_delta 语义）。
 * 目标：尽量原样保留 Cursor 返回正文，便于与 IDE 对照。
 */

const ASSISTANT_TEXT_MAX = 200_000

export function clampAssistantText(text: string, max = ASSISTANT_TEXT_MAX): string {
  const t = String(text || '')
  if (t.length <= max) return t
  return t.slice(0, max) + '\n\n…[正文已截断，超出存储上限]'
}

/** 合并增量或全量快照 → 完整正文 */
export function absorbAssistantText(prev: string, incoming: string): string {
  const p = prev || ''
  const n = incoming || ''
  if (!n) return p
  if (!p) return n
  if (n === p) return p
  if (n.startsWith(p)) return n
  if (p.startsWith(n) && n.length < p.length) return p
  if (p.endsWith(n)) return p
  const max = Math.min(p.length, n.length, 2048)
  for (let k = max; k > 0; k--) {
    if (p.endsWith(n.slice(0, k))) return p + n.slice(k)
  }
  return p + n
}

/** 返回 [full, delta]；无变化时 delta 为空 */
export function mergeAssistantDelta(prev: string, piece: string): { full: string; delta: string } {
  const full = absorbAssistantText(prev, piece)
  if (full === prev) return { full: prev, delta: '' }
  if (full.startsWith(prev)) return { full, delta: full.slice(prev.length) }
  return { full, delta: full }
}

export { ASSISTANT_TEXT_MAX }
