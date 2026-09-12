/**
 * Cursor 对话时间线：thinking / tool / assistant / user 交错，逼近 IDE 对话观感。
 */

export type TranscriptKind = 'thinking' | 'assistant' | 'tool' | 'status' | 'user'

export type TranscriptItem = {
  id: string
  kind: TranscriptKind
  at: string
  text?: string
  name?: string
  path?: string
  tool_status?: string
  call_id?: string
  /** 写码工具参数里抽的短代码片断（仅进度卡，≤8 行） */
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

/** 把工具 args 收成可读路径 */
export function toolPathFromArgs(args: unknown): string {
  if (!args || typeof args !== 'object') return ''
  const a = args as Record<string, unknown>
  return String(a.path || a.file_path || a.filePath || a.target || a.glob || a.pattern || '').trim()
}

const SNIPPET_MAX_LINES = 8
const SNIPPET_MAX_CHARS = 480

function looksSensitivePathOrText(path: string, text: string): boolean {
  if (/\.env|\.pem|\.key$|credentials|id_rsa|secrets?\//i.test(path)) return true
  if (/-----BEGIN |api[_-]?key\s*[:=]|password\s*[:=]|secret\s*[:=]/i.test(text)) return true
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
      lines.push(
        `- **Tool** \`${it.name || 'tool'}\` ${it.tool_status || ''} ${it.path ? '`' + it.path + '`' : ''}`,
      )
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
