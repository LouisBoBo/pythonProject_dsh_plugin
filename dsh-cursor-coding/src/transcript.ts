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
