/**
 * Cursor 写码：澄清 → 确认卡 的唯一规则（禁止在 WorkBuddy / 提示词里再抄一套）。
 *
 * 状态机（入口级新增/删除页面·菜单·报表入口）：
 *   1. 未澄清 → 拦 begin，模型看见「先 ask_user_question」，聊天不渲染确认卡
 *   2. 用户答完选择题（DSH tool/call+tool/result 配对为权威）→ 放行
 *   3. 读不到会话事件时的兜底：clarified=true 且 message 带「澄清结论」痕迹才放行
 *   4. 放行后 begin 必须阻塞在确认卡（waitConfirmThenStart），禁止空返回冒充已出卡
 *
 * 硬禁：
 *   - 只信 Agent 参数 clarified=true（没有会话答完、也没有结论痕迹）
 *   - 把用户原话里的「彻底删除 / 删除菜单」当成已经澄清
 *   - 确认卡显隐靠前端猜文案（前端只认 need_clarify / await_ask_user）
 *
 * 小改（增列/修样式/修 bug）不进本门禁，直接出确认卡。
 */
import { hasClarifyEvidence, looksLikeAddOrDeletePageMenu, truthy } from './requirementGate.js'

export type SessionEventLike = {
  type?: string
  data?: Record<string, unknown>
}

export type AskUserAnswer = {
  id: string
  selected: string[]
  custom?: string
}

export type ClarifyDecision =
  | { action: 'block'; reason: 'empty' | 'need_ask_user' }
  | {
      action: 'pass'
      requirement: string
      via: 'not_entry' | 'ask_user_answered' | 'message_evidence'
    }

/** 从 DSH execute(exec) 取出会话事件（session.events 是 getter）。 */
export function extractSessionEvents(exec: unknown): SessionEventLike[] {
  if (!exec || typeof exec !== 'object') return []
  const e = exec as {
    agent?: { session?: { events?: unknown } }
    session?: { events?: unknown }
    events?: unknown
  }
  const raw = e.agent?.session?.events ?? e.session?.events ?? e.events
  return Array.isArray(raw) ? (raw as SessionEventLike[]) : []
}

function isAskUserName(name: string): boolean {
  return /ask_user/.test(String(name || ''))
}

function callIdFromResultData(data: Record<string, unknown>): string {
  const msg =
    data.message && typeof data.message === 'object' ? (data.message as Record<string, unknown>) : null
  const source =
    msg && msg.source && typeof msg.source === 'object' ? (msg.source as Record<string, unknown>) : null
  return String(source?.callId || data.callId || '').trim()
}

function textFromUnknown(node: unknown): string {
  if (!node) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(textFromUnknown).join('\n')
  if (typeof node !== 'object') return ''
  const o = node as Record<string, unknown>
  if (typeof o.text === 'string') return o.text
  if (o.content !== undefined) return textFromUnknown(o.content)
  return ''
}

function parseAnswersJson(raw: string): AskUserAnswer[] {
  const s = String(raw || '').trim()
  if (!s) return []
  const start = s.indexOf('{')
  const blob = start >= 0 ? s.slice(start) : s
  try {
    const v = JSON.parse(blob) as { answers?: unknown }
    if (!Array.isArray(v.answers)) return []
    const out: AskUserAnswer[] = []
    for (const item of v.answers) {
      if (!item || typeof item !== 'object') continue
      const row = item as { id?: unknown; selected?: unknown; custom?: unknown }
      const selected = Array.isArray(row.selected)
        ? row.selected.map((x) => String(x || '').trim()).filter(Boolean)
        : []
      const custom = String(row.custom || '').trim()
      if (!selected.length && !custom) continue
      const ans: AskUserAnswer = { id: String(row.id || ''), selected }
      if (custom) ans.custom = custom
      out.push(ans)
    }
    return out
  } catch {
    return []
  }
}

function answersFromResultData(data: Record<string, unknown>): AskUserAnswer[] {
  const msg =
    data.message && typeof data.message === 'object' ? (data.message as Record<string, unknown>) : null
  const blob = textFromUnknown(msg?.content ?? data.content ?? data)
  return parseAnswersJson(blob)
}

function formatAskUserSummary(answers: AskUserAnswer[]): string {
  const parts: string[] = []
  for (const a of answers) {
    const bits = [...a.selected]
    if (a.custom) bits.push(a.custom)
    if (bits.length) parts.push(bits.join('、'))
  }
  return parts.join('；')
}

/**
 * 本轮用户原话之后，是否已有成功的 ask_user_question 结果。
 * DSH 权威形状：tool/call.data.name + tool/result.data.message.source.callId 配对；
 * result 上没有 name。
 */
export function readAskUserAfterLastUser(events: SessionEventLike[]): {
  answered: boolean
  answers: AskUserAnswer[]
  summary: string
} {
  if (!Array.isArray(events) || !events.length) {
    return { answered: false, answers: [], summary: '' }
  }
  let lastUserAt = -1
  for (let i = 0; i < events.length; i++) {
    if (events[i]?.type === 'user/message') lastUserAt = i
  }
  const start = lastUserAt >= 0 ? lastUserAt : 0
  const askCallIds = new Set<string>()
  const answers: AskUserAnswer[] = []
  let answered = false

  for (let i = start; i < events.length; i++) {
    const ev = events[i]
    const data = ev?.data && typeof ev.data === 'object' ? ev.data : {}
    if (ev?.type === 'tool/call') {
      const name = String(data.name || '')
      const callId = String(data.callId || '').trim()
      if (callId && isAskUserName(name)) askCallIds.add(callId)
      continue
    }
    if (ev?.type !== 'tool/result') continue
    const callId = callIdFromResultData(data)
    if (!callId || !askCallIds.has(callId)) continue
    if (data.error) continue
    answered = true
    const parsed = answersFromResultData(data)
    if (parsed.length) answers.push(...parsed)
  }

  return { answered, answers, summary: formatAskUserSummary(answers) }
}

export function mergeRequirementWithAskUser(message: string, summary: string): string {
  const msg = String(message || '').trim()
  const extra = String(summary || '').trim()
  if (!extra) return msg
  if (!msg) return '澄清结论：' + extra
  if (hasClarifyEvidence(msg) && msg.includes(extra)) return msg
  if (/澄清结论[:：]/.test(msg) || /范围[:：]/.test(msg)) return msg
  return msg + '\n澄清结论：' + extra
}

/**
 * begin/continue 是否该出确认卡。
 * 会话答完选择题为第一权威；文案痕迹只是读不到事件时的兜底。
 */
export function decideCodingGate(opts: {
  message: string
  clarified?: unknown
  events?: SessionEventLike[]
}): ClarifyDecision {
  const msg = String(opts.message || '').trim()
  if (!msg) return { action: 'block', reason: 'empty' }
  if (!looksLikeAddOrDeletePageMenu(msg)) {
    return { action: 'pass', requirement: msg, via: 'not_entry' }
  }

  const ask = readAskUserAfterLastUser(opts.events || [])
  if (ask.answered) {
    return {
      action: 'pass',
      requirement: mergeRequirementWithAskUser(msg, ask.summary),
      via: 'ask_user_answered',
    }
  }
  if (truthy(opts.clarified) && hasClarifyEvidence(msg)) {
    return { action: 'pass', requirement: msg, via: 'message_evidence' }
  }
  return { action: 'block', reason: 'need_ask_user' }
}
