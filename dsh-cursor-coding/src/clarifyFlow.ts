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

function asEventList(raw: unknown): SessionEventLike[] {
  if (Array.isArray(raw)) return raw as SessionEventLike[]
  if (raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown }).items)) {
    return (raw as { items: SessionEventLike[] }).items
  }
  return []
}

/** 从 DSH execute(exec) 取出会话事件（session.events 是 getter）。 */
export function extractSessionEvents(exec: unknown): SessionEventLike[] {
  if (!exec || typeof exec !== 'object') return []
  const e = exec as {
    agent?: { session?: { events?: unknown }; events?: unknown }
    session?: { events?: unknown }
    events?: unknown
    context?: { session?: { events?: unknown } }
  }
  const candidates = [
    e.agent?.session?.events,
    e.session?.events,
    e.events,
    e.agent?.events,
    e.context?.session?.events,
  ]
  for (const raw of candidates) {
    const list = asEventList(raw)
    if (list.length) return list
  }
  return []
}

function eventType(ev: SessionEventLike | undefined): string {
  return String(ev?.type || '')
}

function isUserMessageType(t: string): boolean {
  return t === 'user/message' || t === 'user.message' || t === 'user_message'
}

function isToolCallType(t: string): boolean {
  return t === 'tool/call' || t === 'tool.call' || t === 'tool_call'
}

function isToolResultType(t: string): boolean {
  return t === 'tool/result' || t === 'tool.result' || t === 'tool_result'
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

function scanAskUser(
  events: SessionEventLike[],
  start: number,
  end = events.length,
): { answered: boolean; answers: AskUserAnswer[]; summary: string } {
  const askCallIds = new Set<string>()
  const answers: AskUserAnswer[] = []
  let answered = false
  const lo = Math.max(0, start)
  const hi = Math.min(events.length, end)
  for (let i = lo; i < hi; i++) {
    const ev = events[i]
    const data = ev?.data && typeof ev.data === 'object' ? (ev.data as Record<string, unknown>) : {}
    const t = eventType(ev)
    if (isToolCallType(t)) {
      const name = String(data.name || data.toolName || '')
      const callId = String(data.callId || data.id || '').trim()
      if (callId && isAskUserName(name)) askCallIds.add(callId)
      continue
    }
    if (!isToolResultType(t)) continue
    const callId = callIdFromResultData(data) || String(data.callId || '').trim()
    if (!callId || !askCallIds.has(callId)) continue
    if (data.error) continue
    answered = true
    const parsed = answersFromResultData(data)
    if (parsed.length) answers.push(...parsed)
  }
  return { answered, answers, summary: formatAskUserSummary(answers) }
}

function isIgnorableBeforeEcho(t: string): boolean {
  if (isUserMessageType(t) || isToolCallType(t) || isToolResultType(t)) return false
  return true
}

/**
 * 仅当最后一条 user/message 紧挨着（中间只有思考等非 tool/user 事件）一次已成功的 ask_user 结果时，
 * 才把它当成答题回声。禁止扫「上一条用户原话 → 本条」整段，否则续改会被上一轮选择题误放行。
 */
function readAskUserEchoJustBeforeLastUser(
  events: SessionEventLike[],
  lastUserAt: number,
): { answered: boolean; answers: AskUserAnswer[]; summary: string } {
  const empty = { answered: false, answers: [] as AskUserAnswer[], summary: '' }
  if (lastUserAt <= 0) return empty
  let i = lastUserAt - 1
  while (i >= 0 && isIgnorableBeforeEcho(eventType(events[i]))) i--
  if (i < 0 || !isToolResultType(eventType(events[i]))) return empty
  const data =
    events[i]?.data && typeof events[i].data === 'object'
      ? (events[i].data as Record<string, unknown>)
      : {}
  if (data.error) return empty
  const callId = callIdFromResultData(data)
  if (!callId) return empty
  for (let j = i - 1; j >= 0; j--) {
    if (isUserMessageType(eventType(events[j]))) return empty
    if (!isToolCallType(eventType(events[j]))) continue
    const cd =
      events[j]?.data && typeof events[j].data === 'object'
        ? (events[j].data as Record<string, unknown>)
        : {}
    const id = String(cd.callId || cd.id || '').trim()
    const name = String(cd.name || cd.toolName || '')
    if (id === callId && isAskUserName(name)) return scanAskUser(events, j, i + 1)
  }
  return empty
}

/**
 * 本轮用户原话之后，是否已有成功的 ask_user_question 结果。
 * DSH 权威形状：tool/call.data.name + tool/result.data.message.source.callId 配对；
 * result 上没有 name。
 * 答完后宿主可能再插一条 user/message：只认「紧挨结果」的回声，不扫整段历史。
 */
export function readAskUserAfterLastUser(events: SessionEventLike[]): {
  answered: boolean
  answers: AskUserAnswer[]
  summary: string
} {
  const empty = { answered: false, answers: [] as AskUserAnswer[], summary: '' }
  if (!Array.isArray(events) || !events.length) return empty

  let lastUserAt = -1
  for (let i = 0; i < events.length; i++) {
    if (isUserMessageType(eventType(events[i]))) lastUserAt = i
  }
  const start = lastUserAt >= 0 ? lastUserAt : 0
  const found = scanAskUser(events, start)
  if (found.answered) return found
  if (lastUserAt > 0) return readAskUserEchoJustBeforeLastUser(events, lastUserAt)
  return empty
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
