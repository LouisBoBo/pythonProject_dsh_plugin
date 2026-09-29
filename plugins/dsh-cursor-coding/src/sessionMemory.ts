/**
 * 续改交给 Cursor 的压缩上下文（L2→执行器），不写入 DSH 聊天日志。
 * 分层标准：本仓库 docs/架构与选型/DSH会话与记忆分层.md（与 WorkBuddy 同源定稿）
 */
import type { CursorCodingJob } from './types.js'

const HANDOFF_REQ = 400
const HANDOFF_DETAIL = 500
const HANDOFF_FILES = 40

export function compactParentHandoff(parent: CursorCodingJob): string {
  const files = (
    parent.last_synced_files?.length ? parent.last_synced_files : parent.synced_files || []
  )
    .slice(0, HANDOFF_FILES)
    .map((f) => `- ${f}`)
    .join('\n')
  const req = String(parent.requirement || '')
    .trim()
    .slice(0, HANDOFF_REQ)
  const conclusion = String(parent.assistant_text || parent.detail || '')
    .trim()
    .slice(0, HANDOFF_DETAIL)
  const lines = [`parent=${parent.id}`]
  if (req) lines.push(`上次诉求：${req}`)
  if (files) lines.push(`上次已同步/已改：`, files)
  else if (parent.detail) lines.push(String(parent.detail))
  if (conclusion) lines.push(`上次结论摘录：${conclusion}`)
  return lines.join('\n')
}
