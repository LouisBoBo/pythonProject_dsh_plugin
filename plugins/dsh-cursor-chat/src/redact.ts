/**
 * 对外脱敏：只改返回副本，不改 job 落盘。
 * 从 Python mom public_redact.py + redact.py 移植。
 *
 * 脱敏范围：
 *   1. 敏感票据替换（api_key / token / Bearer / sk-xxx → ••••）
 *   2. 超长文本截断
 *   3. job 级别：剥掉 stream_token 等密钥字段
 *   4. events 级别：每条事件的 text/detail/message/title 脱敏
 *
 * 安全原则：脱敏函数**永不抛**，失败则原样截断。
 */

const KEYISH = /(api[_-]?key|secret|token|password|authorization)\s*[:=]\s*\S+/gi
const BEARER = /bearer\s+[A-Za-z0-9._\-]{16,}/gi
const SK = /\bsk-[A-Za-z0-9]{16,}\b/g

const STRIP_KEYS = new Set<string>(['stream_token', 'cursor_api_key', 'bearer_token', 'access_token'])

const EVENT_TEXT_KEYS = [
  'text', 'detail', 'message', 'title', 'reply', 'error',
  'assistant_text', 'thinking_text', 'delivery_text',
  'current_action', 'runtime_hint', 'requirement', 'progress',
] as const

const JOB_TEXT_KEYS = [
  'live_text', 'delivery_text', 'thinking_text', 'progress',
  'error', 'current_action', 'runtime_hint', 'requirement', 'message',
] as const

/**
 * 敏感词轻量脱敏 + 截断。
 * 失败则原样返回（不抛）。
 */
export function redactText(text: unknown, opts?: { maxChars?: number }): { value: string; truncated: boolean } {
  const raw = text === null || text === undefined ? '' : String(text)
  let out = raw
  try {
    out = out.replace(KEYISH, (m, key) => `${key}=••••`)
    out = out.replace(BEARER, 'Bearer ••••')
    out = out.replace(SK, 'sk-••••')
  } catch { /* regex 永不抛，但保险 */ }
  let truncated = false
  const lim = Math.max(1024, opts?.maxChars ?? 65536)
  if (out.length > lim) {
    out = out.slice(0, lim) + '\n\n…（已截断）'
    truncated = true
  }
  return { value: out, truncated }
}

function redactScalar(val: unknown, maxChars: number): unknown {
  if (val === null || val === undefined) return val
  if (typeof val !== 'string') return val
  return redactText(val, { maxChars }).value
}

/**
 * 脱敏一条 SSE 事件（浅拷贝 + 重写字段）。
 * 只处理 event 顶层标量字段，不递归事件里嵌套的复杂对象。
 */
export function redactSseEvent<T extends Record<string, unknown>>(ev: T): T {
  if (!ev || typeof ev !== 'object') return ev
  const out: Record<string, unknown> = { ...ev }
  for (const tk of EVENT_TEXT_KEYS) {
    if (tk in out && out[tk] !== null && out[tk] !== undefined) {
      if (typeof out[tk] === 'string') {
        out[tk] = redactText(out[tk] as string, { maxChars: 20_000 }).value
      }
    }
  }
  // 事件里若带 job 快照 → 递归脱敏
  if (out.job && typeof out.job === 'object' && !Array.isArray(out.job)) {
    out.job = redactJobPublic(out.job as Record<string, unknown>)
  }
  // snapshot 里常带 transcript → 逐条脱敏 text
  if (Array.isArray(out.transcript)) {
    out.transcript = out.transcript.map(it => {
      if (!it || typeof it !== 'object') return it
      const it2: Record<string, unknown> = { ...(it as Record<string, unknown>) }
      if (typeof it2.text === 'string') {
        it2.text = redactText(it2.text as string, { maxChars: 20_000 }).value
      }
      return it2
    })
  }
  return out as T
}

function redactMessages(messages: unknown): unknown {
  if (!Array.isArray(messages)) return messages
  return messages.map(m => {
    if (!m || typeof m !== 'object') return m
    const m2: Record<string, unknown> = { ...(m as Record<string, unknown>) }
    if ('content' in m2 && m2.content !== null && m2.content !== undefined) {
      m2.content = redactScalar(m2.content, 40_000)
    }
    return m2
  })
}

function redactBrief(brief: unknown): unknown {
  if (!brief || typeof brief !== 'object') return brief
  const b2: Record<string, unknown> = { ...(brief as Record<string, unknown>) }
  for (const k of ['original_goal', 'summary', 'goal', 'notes', 'detail']) {
    if (k in b2 && b2[k] !== null && b2[k] !== undefined) {
      b2[k] = redactScalar(b2[k], 20_000)
    }
  }
  return b2
}

/**
 * 返回脱敏后的 job 副本。
 * 禁止回显密钥字段；所有文本字段走 redactText。
 */
export function redactJobPublic(job: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!job || typeof job !== 'object') return {}
  const out: Record<string, unknown> = { ...job }
  // 剥密钥
  for (const k of STRIP_KEYS) delete out[k]
  // 文本字段脱敏
  for (const k of JOB_TEXT_KEYS) {
    if (k in out && out[k] !== null && out[k] !== undefined) {
      out[k] = redactScalar(out[k], 120_000)
    }
  }
  if ('messages' in out) out.messages = redactMessages(out.messages)
  if ('brief' in out) out.brief = redactBrief(out.brief)
  // events 数组：逐条脱敏
  if (Array.isArray(out.events)) {
    out.events = out.events.map(ev => {
      if (!ev || typeof ev !== 'object') return ev
      const e2: Record<string, unknown> = { ...(ev as Record<string, unknown>) }
      for (const tk of EVENT_TEXT_KEYS) {
        if (tk in e2 && e2[tk] !== null && e2[tk] !== undefined) {
          if (typeof e2[tk] === 'string') {
            e2[tk] = redactText(e2[tk] as string, { maxChars: 20_000 }).value
          }
        }
      }
      return e2
    })
  }
  return out
}
