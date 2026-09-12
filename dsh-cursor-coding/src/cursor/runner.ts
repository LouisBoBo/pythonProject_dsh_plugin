/**
 * Cursor Local 执行器：全量消费 SDK 事件（thinking / assistant / tool_call），
 * 推送逼近 IDE 对话的时间线条目。
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { clampAssistantText, mergeAssistantDelta } from '../assistantText.js'
import {
  clampText,
  newTranscriptId,
  toolPathFromArgs,
  type TranscriptItem,
} from '../transcript.js'

export type CursorRunEvent = {
  type: 'assistant' | 'thinking' | 'tool_event' | 'status' | 'error' | 'user'
  message?: string
  name?: string
  path?: string
  tool_status?: string
  call_id?: string
  thinking_duration_ms?: number
  /** 完整思考正文（快照） */
  full?: string
}

export type CursorRunResult = {
  ok: boolean
  text: string
  thinking: string
  transcript: TranscriptItem[]
  agent_id: string
  run_id: string
  error?: string
  mocked?: boolean
}

export function buildPrompt(opts: {
  requirement: string
  workspaceHint: string
  parentSummary?: string
  conversational?: boolean
}): string {
  const req = String(opts.requirement || '').trim()
  const parent = opts.parentSummary
    ? `\n【续改上下文】上次已同步/已改文件摘要：\n${opts.parentSummary}\n请在此基础上增量修改。\n`
    : ''
  // 过程口吻偏 Composer；终稿仍要可验收结构
  return (
    '你是 Cursor 本机写码助手，正在沙箱工程里改代码。\n' +
    '【工作区】cwd = 沙箱根目录，请直接读写此目录。\n' +
    `【用户本机同步目录（勿当 cwd）】${opts.workspaceHint}\n\n` +
    '说话方式：像 Cursor IDE 对话框一样——边想边做边说；中文短句说明在干什么；\n' +
    '不要大段贴源码到对话；工具调用正常进行即可。\n' +
    '全部改完后，另起一段终稿，第一行必须恰好是：\n## 说明方案\n' +
    '随后写：结论、改动文件列表、验收步骤。\n' +
    '规则：只改 cwd 内文件；最小必要改动；禁止碰 `.ssh`、`.env`、密钥与宿主机家目录。\n' +
    parent +
    `\n【用户诉求】\n${req}\n`
  )
}

function shouldMock(apiKey: string): boolean {
  if (process.env.CURSOR_CODING_MOCK === '1') return true
  const k = String(apiKey || '').trim()
  if (!k) return true
  if (k === 'test-key-not-real' || k.startsWith('test-')) return true
  return false
}

function shortTool(v: unknown, limit = 240): string {
  const t = String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (t.length <= limit) return t
  return t.slice(0, limit - 1) + '…'
}

function extractAssistantText(message: unknown): string {
  if (!message || typeof message !== 'object') return ''
  const m = message as Record<string, unknown>
  const inner = m.message
  if (typeof inner === 'string') return inner
  if (inner && typeof inner === 'object') {
    const content = (inner as { content?: unknown }).content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      const parts: string[] = []
      for (const block of content) {
        if (!block || typeof block !== 'object') continue
        const b = block as { type?: string; text?: string }
        if (b.type === 'text' || b.type === 'output_text' || !b.type) {
          if (b.text) parts.push(String(b.text))
        }
      }
      return parts.join('')
    }
  }
  if (typeof m.text === 'string') return m.text
  return ''
}

function extractThinking(message: unknown): { text: string; duration?: number } {
  if (!message || typeof message !== 'object') return { text: '' }
  const m = message as Record<string, unknown>
  const text = String(m.text || m.thinking || extractAssistantText(message) || '')
  const duration =
    typeof m.thinking_duration_ms === 'number'
      ? m.thinking_duration_ms
      : typeof m.duration_ms === 'number'
        ? m.duration_ms
        : undefined
  return { text, duration }
}

function extractToolMeta(message: unknown): {
  name?: string
  path?: string
  status?: string
  call_id?: string
} {
  if (!message || typeof message !== 'object') return {}
  const m = message as Record<string, unknown>
  const name = String(m.name || m.toolName || m.tool_name || '').trim() || undefined
  const status = String(m.status || m.tool_status || '').trim() || undefined
  const call_id = String(m.call_id || m.callId || m.id || '').trim() || undefined
  const args = m.args || m.arguments || m.input || m.result
  const path = toolPathFromArgs(args) || undefined
  return { name, path, status, call_id }
}

class DialogBus {
  assistant = ''
  thinking = ''
  transcript: TranscriptItem[] = []
  private thinkingId: string | null = null
  private assistantId: string | null = null
  private toolIds = new Map<string, string>()

  private push(item: TranscriptItem): void {
    this.transcript.push(item)
    if (this.transcript.length > 240) this.transcript = this.transcript.slice(-200)
  }

  addStatus(message: string): void {
    this.push({
      id: newTranscriptId('st'),
      kind: 'status',
      at: new Date().toISOString(),
      text: message,
    })
  }

  addUser(text: string): void {
    this.push({
      id: newTranscriptId('user'),
      kind: 'user',
      at: new Date().toISOString(),
      text: clampText(text, 20_000),
    })
  }

  mergeThinking(piece: string, duration?: number): string {
    const merged = mergeAssistantDelta(this.thinking, piece)
    if (!merged.delta && merged.full === this.thinking) return ''
    this.thinking = clampText(merged.full)
    if (!this.thinkingId) {
      this.thinkingId = newTranscriptId('think')
      this.push({
        id: this.thinkingId,
        kind: 'thinking',
        at: new Date().toISOString(),
        text: this.thinking,
        streaming: true,
        thinking_duration_ms: duration,
      })
    } else {
      const row = this.transcript.find((x) => x.id === this.thinkingId)
      if (row) {
        row.text = this.thinking
        row.streaming = true
        if (duration != null) row.thinking_duration_ms = duration
      }
    }
    return merged.delta
  }

  sealThinking(): void {
    if (!this.thinkingId) return
    const row = this.transcript.find((x) => x.id === this.thinkingId)
    if (row) row.streaming = false
    this.thinkingId = null
  }

  mergeAssistant(piece: string): string {
    const merged = mergeAssistantDelta(this.assistant, piece)
    if (!merged.delta) return ''
    this.assistant = clampAssistantText(merged.full)
    // 新 assistant 段：thinking 结束后另起；若连续 delta 则更新同一块
    if (!this.assistantId) {
      this.assistantId = newTranscriptId('asst')
      this.push({
        id: this.assistantId,
        kind: 'assistant',
        at: new Date().toISOString(),
        text: this.assistant,
        streaming: true,
      })
    } else {
      const row = this.transcript.find((x) => x.id === this.assistantId)
      if (row) {
        row.text = this.assistant
        row.streaming = true
      }
    }
    return merged.delta
  }

  sealAssistant(): void {
    if (!this.assistantId) return
    const row = this.transcript.find((x) => x.id === this.assistantId)
    if (row) row.streaming = false
    this.assistantId = null
  }

  upsertTool(meta: {
    name?: string
    path?: string
    status?: string
    call_id?: string
  }): void {
    this.sealThinking()
    // 工具打断正文段
    this.sealAssistant()
    const key = meta.call_id || `${meta.name || 'tool'}:${meta.path || ''}`
    let id = this.toolIds.get(key)
    if (!id) {
      id = newTranscriptId('tool')
      this.toolIds.set(key, id)
      this.push({
        id,
        kind: 'tool',
        at: new Date().toISOString(),
        name: meta.name || 'tool',
        path: meta.path,
        tool_status: meta.status || 'running',
        call_id: meta.call_id,
      })
      return
    }
    const row = this.transcript.find((x) => x.id === id)
    if (row) {
      if (meta.name) row.name = meta.name
      if (meta.path) row.path = meta.path
      if (meta.status) row.tool_status = meta.status
      row.at = new Date().toISOString()
    }
  }
}

async function runMock(opts: {
  sandbox: string
  requirement: string
  onEvent: (ev: CursorRunEvent) => void
  isCancel: () => boolean
  userPreface?: string
}): Promise<CursorRunResult> {
  const bus = new DialogBus()
  if (opts.userPreface) {
    bus.addUser(opts.userPreface)
    opts.onEvent({ type: 'user', message: opts.userPreface })
  }
  bus.addStatus('Mock Cursor：模拟 IDE 对话流')
  opts.onEvent({ type: 'status', message: 'Mock Cursor：模拟 IDE 对话流' })
  if (opts.isCancel()) {
    return {
      ok: false,
      text: '',
      thinking: '',
      transcript: bus.transcript,
      agent_id: '',
      run_id: '',
      error: '已取消',
      mocked: true,
    }
  }

  const thinkPieces = [
    '先确认工作区里有哪些文件。',
    '准备写入标记文件以验证同步链路。',
  ]
  for (const p of thinkPieces) {
    const d = bus.mergeThinking(p)
    if (d) opts.onEvent({ type: 'thinking', message: d, full: bus.thinking })
  }
  bus.sealThinking()

  const marker = join(opts.sandbox, '.cursor-coding-mock.md')
  const prev = existsSync(marker) ? readFileSync(marker, 'utf8') : ''
  const body =
    prev +
    `\n## mock run\n- at: ${new Date().toISOString()}\n- requirement: ${opts.requirement.slice(0, 200)}\n`
  writeFileSync(marker, body.trim() + '\n', 'utf8')
  bus.upsertTool({
    name: 'Write',
    path: '.cursor-coding-mock.md',
    status: 'completed',
    call_id: 'mock-write-1',
  })
  opts.onEvent({
    type: 'tool_event',
    name: 'Write',
    path: '.cursor-coding-mock.md',
    tool_status: 'completed',
    call_id: 'mock-write-1',
  })

  const parts = [
    '正在查看工作区…\n',
    `已写入 \`.cursor-coding-mock.md\`（诉求：${opts.requirement.slice(0, 80)}）。\n\n`,
    '## 说明方案\n**结论**\nMock 已完成改码（自检/无真实 Key）。\n',
  ]
  for (const piece of parts) {
    const d = bus.mergeAssistant(piece)
    if (d) opts.onEvent({ type: 'assistant', message: d })
  }
  bus.sealAssistant()

  return {
    ok: true,
    text: bus.assistant,
    thinking: bus.thinking,
    transcript: bus.transcript,
    agent_id: 'mock-agent',
    run_id: 'mock-run',
    mocked: true,
  }
}

function unwrapSdkMessage(message: unknown): { mtype: string; payload: Record<string, unknown> } {
  if (!message || typeof message !== 'object') return { mtype: '', payload: {} }
  const raw = message as Record<string, unknown>
  // LocalRunStream 包装
  if (raw.type === 'sdk_message' && raw.message && typeof raw.message === 'object') {
    const inner = raw.message as Record<string, unknown>
    return { mtype: String(inner.type || ''), payload: inner }
  }
  return { mtype: String(raw.type || ''), payload: raw }
}

/**
 * 在沙箱 cwd 跑 Cursor Local；支持 resume（续改/追问）。
 */
export async function runCursorLocal(opts: {
  sandbox: string
  apiKey: string
  prompt: string
  resumeAgentId?: string | null
  model?: string
  onEvent: (ev: CursorRunEvent) => void
  isCancel: () => boolean
  /** 写入 transcript 的用户侧文案 */
  userPreface?: string
}): Promise<CursorRunResult> {
  mkdirSync(opts.sandbox, { recursive: true })
  if (shouldMock(opts.apiKey)) {
    return runMock({
      sandbox: opts.sandbox,
      requirement: opts.prompt.includes('【用户诉求】')
        ? opts.prompt.split('【用户诉求】').pop()!.trim().slice(0, 500)
        : opts.prompt.slice(0, 500),
      onEvent: opts.onEvent,
      isCancel: opts.isCancel,
      userPreface: opts.userPreface,
    })
  }

  const { Agent, CursorAgentError } = await import('@cursor/sdk')
  const model = opts.model || 'composer-2.5'
  const bus = new DialogBus()
  if (opts.userPreface) {
    bus.addUser(opts.userPreface)
    opts.onEvent({ type: 'user', message: opts.userPreface })
  }

  opts.onEvent({ type: 'status', message: '正在启动 Cursor Local，请稍候…' })
  bus.addStatus('正在启动 Cursor Local，请稍候…')

  let agent: Awaited<ReturnType<typeof Agent.create>>
  try {
    if (opts.resumeAgentId) {
      const tip = `续跑 Agent ${opts.resumeAgentId.slice(0, 12)}…`
      opts.onEvent({ type: 'status', message: tip })
      bus.addStatus(tip)
      try {
        agent = await Agent.resume(opts.resumeAgentId, {
          apiKey: opts.apiKey,
          model: { id: model },
          local: { cwd: opts.sandbox },
        })
      } catch (resumeErr) {
        const rmsg =
          resumeErr instanceof CursorAgentError
            ? resumeErr.message
            : String(resumeErr)
        // 父 Agent 过期/不存在时：保留已复用沙箱，降级新建 Agent（仍注入 parentSummary）
        const missing =
          /not found|unknown agent|no such agent|expired|invalid agent/i.test(rmsg)
        if (!missing) throw resumeErr
        const fallbackTip = `父 Agent 不可用，改用新 Agent（沙箱已复用）：${rmsg.slice(0, 120)}`
        opts.onEvent({ type: 'status', message: fallbackTip })
        bus.addStatus(fallbackTip)
        agent = await Agent.create({
          apiKey: opts.apiKey,
          model: { id: model },
          local: { cwd: opts.sandbox },
        })
      }
    } else {
      agent = await Agent.create({
        apiKey: opts.apiKey,
        model: { id: model },
        local: { cwd: opts.sandbox },
      })
    }
  } catch (err) {
    const msg =
      err instanceof CursorAgentError
        ? `${err.message}（retryable=${Boolean(err.isRetryable)}）`
        : String(err)
    opts.onEvent({ type: 'error', message: msg })
    return {
      ok: false,
      text: '',
      thinking: '',
      transcript: bus.transcript,
      agent_id: '',
      run_id: '',
      error: msg,
    }
  }

  const agentId = String(agent.agentId || '')
  let runId = ''

  const emitFromBusThinking = (delta: string) => {
    if (!delta) return
    opts.onEvent({ type: 'thinking', message: delta, full: bus.thinking })
  }

  try {
    if (opts.isCancel()) {
      await disposeAgent(agent)
      return {
        ok: false,
        text: bus.assistant,
        thinking: bus.thinking,
        transcript: bus.transcript,
        agent_id: agentId,
        run_id: '',
        error: '已取消',
      }
    }
    const run = await agent.send(opts.prompt)
    runId = String(run.id || '')
    opts.onEvent({ type: 'status', message: 'Cursor 正在改码，过程见进度卡…' })
    bus.addStatus('Cursor 正在改码，过程见进度卡…')

    try {
      for await (const message of run.stream()) {
        if (opts.isCancel()) {
          if (run.supports('cancel')) await run.cancel()
          break
        }
        const { mtype, payload } = unwrapSdkMessage(message)

        if (mtype === 'thinking') {
          const th = extractThinking(payload)
          if (th.text) {
            const d = bus.mergeThinking(th.text, th.duration)
            emitFromBusThinking(d)
          }
          continue
        }

        if (mtype === 'assistant' || mtype === 'message' || mtype === 'assistant_message') {
          bus.sealThinking()
          const chunk = extractAssistantText(payload)
          if (chunk) {
            const d = bus.mergeAssistant(chunk)
            if (d) opts.onEvent({ type: 'assistant', message: d })
          }
          continue
        }

        if (mtype === 'tool_call' || mtype === 'toolCall' || mtype.includes('tool')) {
          const meta = extractToolMeta(payload)
          bus.upsertTool({
            name: meta.name || mtype,
            path: meta.path,
            status: meta.status || 'running',
            call_id: meta.call_id,
          })
          opts.onEvent({
            type: 'tool_event',
            name: meta.name || mtype,
            path: meta.path,
            tool_status: meta.status || 'running',
            call_id: meta.call_id,
            message: shortTool(meta.name || mtype),
          })
          continue
        }

        if (mtype === 'status') {
          const st = String(payload.status || '')
          const msg = String(payload.message || st || '')
          if (msg) {
            bus.addStatus(msg)
            opts.onEvent({ type: 'status', message: msg })
          }
          continue
        }

        if (mtype === 'task') {
          const text = String(payload.text || '')
          if (text) {
            bus.addStatus(text)
            opts.onEvent({ type: 'status', message: text })
          }
        }
      }
    } catch (streamErr) {
      opts.onEvent({ type: 'error', message: `流读取：${String(streamErr)}` })
    }

    bus.sealThinking()
    bus.sealAssistant()

    const result = await run.wait()
    const status = String(result.status || '')
    if (opts.isCancel()) {
      await disposeAgent(agent)
      return {
        ok: false,
        text: bus.assistant,
        thinking: bus.thinking,
        transcript: bus.transcript,
        agent_id: agentId,
        run_id: runId,
        error: '已取消',
      }
    }
    if (status === 'error') {
      const errMsg = shortTool((result as { error?: unknown }).error || 'run error', 400)
      opts.onEvent({ type: 'error', message: errMsg })
      await disposeAgent(agent)
      return {
        ok: false,
        text: bus.assistant,
        thinking: bus.thinking,
        transcript: bus.transcript,
        agent_id: agentId,
        run_id: runId,
        error: errMsg,
      }
    }
    const waitText = String((result as { result?: string }).result || '')
    if (waitText) {
      const d = bus.mergeAssistant(waitText)
      if (d) opts.onEvent({ type: 'assistant', message: d })
      bus.sealAssistant()
    }
    await disposeAgent(agent)
    return {
      ok: true,
      text: clampAssistantText(bus.assistant),
      thinking: clampText(bus.thinking),
      transcript: bus.transcript,
      agent_id: agentId,
      run_id: runId,
    }
  } catch (err) {
    const msg =
      err instanceof CursorAgentError
        ? `${err.message}（retryable=${Boolean(err.isRetryable)}）`
        : String(err)
    opts.onEvent({ type: 'error', message: msg })
    try {
      await disposeAgent(agent)
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      text: clampAssistantText(bus.assistant),
      thinking: clampText(bus.thinking),
      transcript: bus.transcript,
      agent_id: agentId,
      run_id: runId,
      error: msg,
    }
  }
}

async function disposeAgent(agent: {
  [Symbol.asyncDispose]?: () => Promise<void>
  close?: () => void | Promise<void>
}): Promise<void> {
  try {
    if (typeof agent[Symbol.asyncDispose] === 'function') {
      await agent[Symbol.asyncDispose]!()
      return
    }
    if (typeof agent.close === 'function') {
      await agent.close()
    }
  } catch {
    /* ignore */
  }
}
