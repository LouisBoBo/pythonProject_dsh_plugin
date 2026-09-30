/**
 * Cursor 对话时间线：thinking / tool / assistant / user 交错，逼近 IDE 对话观感。
 * 只加厚过程内容字段；不改变主流程与输出通道。
 */

export type TranscriptKind = 'thinking' | 'assistant' | 'tool' | 'status' | 'user'

export type TranscriptItem = {
  id: string
  kind: TranscriptKind
  at: string
  text?: string
  name?: string
  /** 主路径（文件）；不含 pattern/command */
  path?: string
  /** Grep/Glob 等模式 */
  pattern?: string
  /** Shell 命令 */
  command?: string
  tool_status?: string
  call_id?: string
  /** 写码片断，或 Todo/结果短摘要（进度卡，限长） */
  snippet?: string
  /** 仍在流式追加 */
  streaming?: boolean
  thinking_duration_ms?: number
}

const MAX_ITEMS = 240
const MAX_TEXT = 120_000

let seq = 0

export function newTranscriptId(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now().toString(36)}-${seq}`
}

export function clampText(text: string, max = MAX_TEXT): string {
  const t = String(text || '')
  if (t.length <= max) return t
  return t.slice(0, max) + '\n\n…[已截断]'
}

export function trimTranscript(items: TranscriptItem[]): TranscriptItem[] {
  if (items.length <= MAX_ITEMS) return items
  return items.slice(-MAX_ITEMS)
}

/** 仅文件路径类字段（禁止把 pattern 填进 path） */
export function toolPathFromArgs(args: unknown): string {
  if (!args || typeof args !== 'object') return ''
  const a = args as Record<string, unknown>
  return String(a.path || a.file_path || a.filePath || a.target || a.target_file || '').trim()
}

export function toolPatternFromArgs(args: unknown): string {
  if (!args || typeof args !== 'object') return ''
  const a = args as Record<string, unknown>
  return String(a.pattern || a.glob || a.glob_pattern || a.globPattern || a.query || '').trim()
}

export function toolCommandFromArgs(args: unknown): string {
  if (!args || typeof args !== 'object') return ''
  const a = args as Record<string, unknown>
  const cmd = String(a.command || a.cmd || a.shell_command || '').trim()
  if (!cmd) return ''
  if (looksSensitivePathOrText('', cmd)) return '[已隐藏敏感命令]'
  return cmd.length > 240 ? cmd.slice(0, 237) + '…' : cmd
}

const SNIPPET_MAX_LINES = 8
const SNIPPET_MAX_CHARS = 480
const RESULT_MAX_CHARS = 360

function looksSensitivePathOrText(path: string, text: string): boolean {
  if (/\.env|\.pem|\.key$|credentials|id_rsa|secrets?\//i.test(path)) return true
  if (/-----BEGIN |api[_-]?key\s*[:=]|password\s*[:=]|secret\s*[:=]/i.test(text)) return true
  if (/\b(bearer|authorization)\s*[:=]?\s+\S+/i.test(text)) return true
  if (/\bsk-[a-zA-Z0-9]{8,}/.test(text)) return true
  if (/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/.test(text)) return true
  if (/\bAKIA[0-9A-Z]{16}\b/.test(text)) return true
  if (/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/.test(text)) return true
  if (/\bxox[baprs]-/i.test(text)) return true
  return false
}

function clampSnippet(raw: string): string {
  const lines = String(raw || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
  const cut = lines.slice(0, SNIPPET_MAX_LINES)
  let out = cut.join('\n').trimEnd()
  if (lines.length > SNIPPET_MAX_LINES) out += '\n…'
  if (out.length > SNIPPET_MAX_CHARS) out = out.slice(0, SNIPPET_MAX_CHARS - 1) + '…'
  return out
}

function clampResultPreview(raw: string): string {
  let out = String(raw || '')
    .replace(/\r\n/g, '\n')
    .trim()
  if (!out) return ''
  const lines = out.split('\n')
  if (lines.length > SNIPPET_MAX_LINES) {
    out = lines.slice(0, SNIPPET_MAX_LINES).join('\n') + '\n…'
  }
  if (out.length > RESULT_MAX_CHARS) out = out.slice(0, RESULT_MAX_CHARS - 1) + '…'
  return out
}

function textFromUnknown(v: unknown, depth = 0): string {
  if (v == null || depth > 4) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) {
    return v
      .slice(0, 20)
      .map((x) => textFromUnknown(x, depth + 1))
      .filter(Boolean)
      .join('\n')
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    for (const k of ['content', 'text', 'output', 'stdout', 'stderr', 'result', 'message', 'data']) {
      const inner = textFromUnknown(o[k], depth + 1)
      if (inner.trim()) return inner
    }
  }
  return ''
}

/**
 * 从 Write / StrReplace 等工具参数抽出短代码片断，供进度卡增强真实感。
 * 非写码类工具（read/grep/shell）不抽，避免噪音。
 */
export function toolSnippetFromArgs(args: unknown, toolName?: string, pathHint?: string): string | undefined {
  if (!args || typeof args !== 'object') return undefined
  const a = args as Record<string, unknown>
  const n = String(toolName || '').toLowerCase()
  const path = String(pathHint || toolPathFromArgs(args) || '')
  const writeish =
    /write|edit|strreplace|search_replace|apply_patch|patch|replace/.test(n) ||
    typeof a.new_string === 'string' ||
    typeof a.contents === 'string' ||
    typeof a.content === 'string' ||
    typeof a.new_text === 'string'
  if (!writeish) return undefined

  let body = ''
  let asDiffPlus = false
  if (typeof a.new_string === 'string' && a.new_string.trim()) {
    body = a.new_string
    asDiffPlus = typeof a.old_string === 'string'
  } else if (typeof a.contents === 'string' && a.contents.trim()) {
    body = a.contents
  } else if (typeof a.content === 'string' && a.content.trim()) {
    body = a.content
  } else if (typeof a.new_text === 'string' && a.new_text.trim()) {
    body = a.new_text
  } else if (typeof a.code === 'string' && a.code.trim()) {
    body = a.code
  } else if (typeof a.patch === 'string' && a.patch.trim()) {
    return clampSnippet(a.patch)
  }
  if (!body.trim()) return undefined
  if (looksSensitivePathOrText(path, body)) return undefined

  if (asDiffPlus) {
    const lined = body
      .replace(/\r\n/g, '\n')
      .split('\n')
      .slice(0, SNIPPET_MAX_LINES)
      .map((l) => '+ ' + l)
      .join('\n')
    const more = body.split('\n').length > SNIPPET_MAX_LINES
    let out = lined + (more ? '\n…' : '')
    if (out.length > SNIPPET_MAX_CHARS) out = out.slice(0, SNIPPET_MAX_CHARS - 1) + '…'
    return out
  }
  return clampSnippet(body)
}

/** TodoWrite：进度清单短摘要 */
export function toolTodoSnippetFromArgs(args: unknown, toolName?: string): string | undefined {
  if (!args || typeof args !== 'object') return undefined
  const n = String(toolName || '').toLowerCase()
  const todos = (args as { todos?: unknown }).todos
  if (!Array.isArray(todos) || !todos.length) return undefined
  if (n && !/todo/.test(n)) return undefined
  const lines: string[] = []
  for (const raw of todos.slice(0, 8)) {
    if (!raw || typeof raw !== 'object') continue
    const t = raw as Record<string, unknown>
    const st = String(t.status || '').toLowerCase()
    const mark =
      st === 'completed' || st === 'done'
        ? '[x]'
        : st === 'in_progress' || st === 'running'
          ? '[~]'
          : '[ ]'
    const title = String(t.content || t.title || t.id || '').trim()
    if (!title) continue
    lines.push(`${mark} ${title}`)
  }
  if (!lines.length) return undefined
  if (todos.length > 8) lines.push('…')
  return lines.join('\n')
}

/**
 * Read / Grep / Shell 完成态结果短摘要（限长；敏感内容跳过）。
 */
export function toolResultPreview(
  result: unknown,
  toolName?: string,
  pathHint?: string,
): string | undefined {
  const n = String(toolName || '').toLowerCase()
  if (!/read|grep|rg|search|shell|bash|terminal|exec/.test(n)) return undefined

  const path = String(pathHint || '')
  const text = clampResultPreview(textFromUnknown(result))
  if (!text) return undefined
  if (looksSensitivePathOrText(path, text)) return undefined
  return text
}

/** 简易行级 diff 片断（进度卡用；非完整 unified diff） */
export function snippetFromTextDiff(before: string, after: string): string | undefined {
  const a = String(before || '').replace(/\r\n/g, '\n').split('\n')
  const b = String(after || '').replace(/\r\n/g, '\n').split('\n')
  if (a.length === b.length && a.every((line, i) => line === b[i])) return undefined

  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1
  let ae = a.length - 1
  let be = b.length - 1
  while (ae >= i && be >= i && a[ae] === b[be]) {
    ae -= 1
    be -= 1
  }

  const out: string[] = []
  for (let k = i; k <= ae && out.length < SNIPPET_MAX_LINES; k += 1) {
    out.push('- ' + a[k])
  }
  for (let k = i; k <= be && out.length < SNIPPET_MAX_LINES; k += 1) {
    out.push('+ ' + b[k])
  }
  if (!out.length) {
    for (let k = Math.max(0, b.length - SNIPPET_MAX_LINES); k < b.length; k += 1) {
      out.push('+ ' + b[k])
    }
  }
  if (!out.length) return undefined
  let text = out.join('\n')
  if (ae - i + 1 + (be - i + 1) > SNIPPET_MAX_LINES) text += '\n…'
  if (text.length > SNIPPET_MAX_CHARS) text = text.slice(0, SNIPPET_MAX_CHARS - 1) + '…'
  return text
}

export function isWriteToolName(name?: string): boolean {
  const n = String(name || '').toLowerCase()
  return (
    n === 'edit' ||
    n === 'write' ||
    /write|edit|strreplace|search_replace|apply_patch|patch/.test(n)
  )
}

/**
 * 进度卡是否展示该 assistant 段：过程短句可展示；终稿标题段留给正文结论。
 */
export function isProcessAssistantText(text: string): boolean {
  const t = String(text || '').trim()
  if (!t) return false
  if (looksLikeFinalPlanBody(t)) return false
  // 勿用 \b：中文后无 JS word boundary，会漏匹配
  if (/##\s*说明方案/.test(t)) return false
  if (/##\s*本轮结论/.test(t)) return false
  if (/【本轮结论】/.test(t)) return false
  return true
}

/** 无「## 说明方案」标题时的终稿体（流式拆段常见） */
export function looksLikeFinalPlanBody(text: string): boolean {
  const s = String(text || '').trim()
  if (!s) return false
  if (/^\*\*结论[：:]?\*\*/.test(s)) return true
  if (/^结论[：:]/.test(s)) return true
  const hits = [
    /\*\*结论[：:]?\*\*/,
    /\*\*改动文件/,
    /\*\*说明[：:]?\*\*/,
    /\*\*验收步骤[：:]?\*\*/,
    /验收步骤[：:]/,
  ].filter((re) => re.test(s)).length
  return hits >= 2
}

/**
 * 去掉段内终稿标题及之后（终稿只进正文结论）。
 * 兼容：行首标题、粘在行尾的 `…正常## 说明方案`、流式残留孤立 `##`。
 */
export function stripFinalPlanSection(text: string): string {
  let t = String(text || '')
  const markers = [/##\s*说明方案/, /##\s*本轮结论/, /【本轮结论】/]
  let cut = -1
  for (const re of markers) {
    const m = t.match(re)
    if (m && m.index != null && (cut < 0 || m.index < cut)) cut = m.index
  }
  if (cut === 0) return ''
  if (cut > 0) t = t.slice(0, cut)
  t = t.trim()
  // 流式半截标题（含 ##\n\n**结论**）
  t = t.replace(/^#{1,6}\s*(?:\n+|$)/, '').trim()
  if (!t || /^#{1,6}\s*$/.test(t)) return ''
  if (looksLikeFinalPlanBody(t)) return ''
  return t
}

/**
 * 若 curr 以 prev 为前缀（模型整段重述再追加），只保留增量。
 */
export function stripRepeatedAssistantPrefix(previous: string, current: string): string {
  const prev = String(previous || '').trim()
  const curr = String(current || '').trim()
  if (!curr) return ''
  if (!prev) return curr
  if (curr === prev) return ''
  if (curr.startsWith(prev)) {
    return curr.slice(prev.length).replace(/^\s+/, '')
  }
  return curr
}

/**
 * 入库/展示共用：相对此前 assistant 段去复读前缀，并去掉终稿段。
 * previousTexts：时间序上更早的 assistant 正文（建议最近一段即可，可传多段从新到旧）。
 */
export function refineAssistantSegmentText(incoming: string, previousTexts: string[] = []): string {
  let t = stripFinalPlanSection(incoming)
  if (!t) return ''
  for (let i = previousTexts.length - 1; i >= 0; i -= 1) {
    const next = stripRepeatedAssistantPrefix(previousTexts[i] || '', t)
    if (next !== t) {
      t = next
      break
    }
  }
  t = stripFinalPlanSection(t)
  if (!t || !isProcessAssistantText(t)) return ''
  return t
}

/** 状态行展示文案（不改 Job.status，只改可见字） */
export function normalizeStatusDisplay(message: string): string {
  const msg = String(message || '').trim()
  if (!msg) return ''
  if (/^RUNNING$/i.test(msg)) return 'Cursor 运行中，请稍候…'
  return String(message || '')
}

/**
 * 正文结论取材：优先最后一段「## 说明方案」；否则取尾部，避免整段过程噪声。
 * 不改变结论外壳结构，只优化正文主体。
 */
export function preferredConclusionAssistantText(assistant: string, maxLen = 3500): string {
  const asst = String(assistant || '').trim()
  if (!asst) return ''
  const markers = ['## 说明方案', '## 本轮结论']
  let start = -1
  for (const m of markers) {
    const i = asst.lastIndexOf(m)
    if (i > start) start = i
  }
  let body = start >= 0 ? asst.slice(start).trim() : asst
  // 同一终稿被模型刷两遍时去重
  if (start >= 0) {
    const first = body
    const again = body.indexOf('## 说明方案', 3)
    const again2 = body.indexOf('## 本轮结论', 3)
    const second = [again, again2].filter((i) => i > 0).sort((a, b) => a - b)[0]
    if (second != null && second > 0) {
      const a = body.slice(0, second).trim()
      const b = body.slice(second).trim()
      if (a === b || b.startsWith(a) || a.startsWith(b)) body = a.length >= b.length ? a : b
    }
  }
  if (start < 0 && body.length > maxLen) {
    body = '…\n\n' + body.slice(-(maxLen - 6))
  } else if (body.length > maxLen) {
    body = body.slice(0, maxLen) + '\n\n…[已截断]'
  }
  return body
}

/**
 * 工具路径展示成相对沙箱根（Composer 时间线风格）；失败则尽量剥掉 …/sandboxes/<id>/。
 */
export function relativizeToolPath(raw: string | undefined, sandboxRoot?: string): string | undefined {
  const p = String(raw || '').trim()
  if (!p) return undefined
  if (sandboxRoot) {
    const root = sandboxRoot.replace(/[/\\]+$/, '')
    const normP = p.replace(/\\/g, '/')
    const normR = root.replace(/\\/g, '/')
    if (normP === normR) return '.'
    if (normP.startsWith(normR + '/')) return normP.slice(normR.length + 1)
  }
  const m = p.replace(/\\/g, '/').match(/\/sandboxes\/[^/]+\/(.+)$/)
  if (m) return m[1]
  return p
}

export function formatDialogMarkdown(opts: {
  jobId: string
  workspace: string
  thinking: string
  assistant: string
  transcript: TranscriptItem[]
}): string {
  const lines: string[] = [
    `# Cursor 对话回放`,
    ``,
    `- job: ${opts.jobId}`,
    `- workspace: ${opts.workspace}`,
    `- thinking chars: ${(opts.thinking || '').length}`,
    `- assistant chars: ${(opts.assistant || '').length}`,
    `- transcript items: ${opts.transcript.length}`,
    ``,
    `---`,
    ``,
  ]
  for (const it of opts.transcript) {
    if (it.kind === 'thinking') {
      lines.push(`### 💭 Thinking`)
      lines.push(``)
      lines.push(it.text || '')
      lines.push(``)
    } else if (it.kind === 'assistant') {
      lines.push(`### Assistant`)
      lines.push(``)
      lines.push(it.text || '')
      lines.push(``)
    } else if (it.kind === 'tool') {
      const bits = [
        it.name || 'tool',
        it.tool_status || '',
        it.path ? `\`${it.path}\`` : '',
        it.pattern ? `pattern=\`${it.pattern}\`` : '',
        it.command ? `cmd=\`${it.command}\`` : '',
      ].filter(Boolean)
      lines.push(`- **Tool** ${bits.join(' ')}`)
      if (it.snippet) {
        lines.push('```')
        lines.push(it.snippet)
        lines.push('```')
      }
    } else if (it.kind === 'user') {
      lines.push(`### You`)
      lines.push(``)
      lines.push(it.text || '')
      lines.push(``)
    } else if (it.kind === 'status') {
      lines.push(`- _${it.text || ''}_`)
    }
  }
  if (!opts.transcript.length) {
    lines.push(`### Thinking`)
    lines.push(``)
    lines.push(opts.thinking || '（空）')
    lines.push(``)
    lines.push(`### Assistant`)
    lines.push(``)
    lines.push(opts.assistant || '（空）')
  }
  return lines.join('\n')
}
