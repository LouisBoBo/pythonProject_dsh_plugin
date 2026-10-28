import { clampUtf8, type ProjectedAssistant, type ProjectedTurn } from './events.js'

export const MAX_TRANSCRIPT_BYTES = 2 * 1024 * 1024

export interface TurnDocument {
  sessionTitle: string
  sessionId: string
  turn: number
  writtenAt: string
  projected: ProjectedTurn
}

export function renderTurnDocument(doc: TurnDocument): string {
  const parts: string[] = [
    [
      `# 第 ${doc.turn} 轮`,
      '',
      `- 会话：${doc.sessionTitle}`,
      `- 会话 id：\`${sanitizeInline(doc.sessionId)}\``,
      `- 轮次：${doc.turn}`,
      `- 写入时间：\`${doc.writtenAt}\``,
    ].join('\n'),
  ]
  if (doc.projected.users.length > 0) {
    parts.push(['## 用户', '', doc.projected.users.map((message) => message.body).join('\n\n')].join('\n'))
  }
  for (const assistant of orderAssistants(doc.projected.assistants)) {
    parts.push([assistantHeading(assistant), '', assistant.body].join('\n'))
  }
  for (const tool of doc.projected.tools) {
    parts.push(
      [
        `## 工具 · ${tool.name}`,
        '',
        `- callId：\`${sanitizeInline(tool.callId)}\``,
        '',
        '### 参数',
        '',
        tool.arguments.length > 0 ? tool.arguments : '（空）',
        '',
        '### 结果',
        '',
        tool.result === undefined ? '（无结果）' : tool.result.length > 0 ? tool.result : '（空）',
      ].join('\n'),
    )
  }
  for (const result of doc.projected.unpaired) {
    parts.push(
      [
        '## 工具结果（未配对）',
        '',
        `- callId：\`${result.callId ? sanitizeInline(result.callId) : '（无）'}\``,
        '',
        '### 结果',
        '',
        result.body.length > 0 ? result.body : '（空）',
      ].join('\n'),
    )
  }
  return finalizeTranscript(parts.join('\n\n') + '\n')
}

export function renderSessionCover(input: {
  title: string
  sessionId: string
  workspace?: string
  updated: string
  turns: string[]
}): string {
  const lines = [`# ${input.title || '未命名会话'}`, '', `- 会话 id：\`${sanitizeInline(input.sessionId)}\``]
  if (input.workspace) lines.push(`- 工作区：\`${sanitizeInline(input.workspace)}\``)
  lines.push(`- 最近更新：\`${input.updated}\``, '', '## 轮次', '')
  if (input.turns.length === 0) lines.push('- （尚无轮次）')
  else {
    for (const turn of input.turns) lines.push(`- [${turn}](${turn}/对话.md)`)
  }
  return lines.join('\n') + '\n'
}

export interface IndexRow {
  title: string
  sessionId: string
  latestTurn: string
  updated: string
}

export function renderIndex(rows: readonly IndexRow[]): string {
  const lines = ['# 会话归档', '']
  if (rows.length === 0) lines.push('- （尚无会话）')
  for (const row of rows) {
    const title = linkLabel(row.title)
    const latest = row.latestTurn || '（无）'
    const updated = row.updated || '（无）'
    lines.push(`- [${title}](${row.sessionId}/会话.md) · \`${sanitizeInline(row.sessionId)}\` · 最近一轮 ${latest} · \`${updated}\``)
  }
  return lines.join('\n') + '\n'
}

export function readSessionCover(markdown: string): { title: string; updated: string } {
  const lines = markdown.split('\n')
  const heading = lines[0]?.startsWith('# ') ? lines[0].slice(2).trim() : ''
  let updated = ''
  for (const line of lines) {
    const matched = /^- 最近更新：`([^`]*)`/.exec(line)
    if (matched?.[1]) updated = matched[1]
  }
  return { title: heading || '未命名会话', updated }
}

export function finalizeTranscript(markdown: string): string {
  if (Buffer.byteLength(markdown, 'utf8') <= MAX_TRANSCRIPT_BYTES) return markdown
  const note = '\n\n已截断\n'
  const room = MAX_TRANSCRIPT_BYTES - Buffer.byteLength(note)
  return clampUtf8(markdown, Math.max(0, room)).text + note
}

function orderAssistants(messages: readonly ProjectedAssistant[]): ProjectedAssistant[] {
  if (messages.length === 0) return []
  const indexed = messages.map((message, index) => ({ message, index }))
  const sortable = indexed.every((row) => row.message.step !== undefined)
  if (!sortable) return messages.slice()
  return indexed
    .sort((a, b) => (a.message.step ?? 0) - (b.message.step ?? 0) || a.index - b.index)
    .map((row) => row.message)
}

function assistantHeading(message: ProjectedAssistant): string {
  if (message.step === undefined) return '## 助手'
  return `## 助手 · 第 ${message.step} 步`
}

function sanitizeInline(value: string): string {
  return value.replace(/[\r\n`]/g, '').trim()
}

function linkLabel(title: string): string {
  const cleaned = title.replace(/[\[\]]/g, '').trim()
  return cleaned || '未命名会话'
}
