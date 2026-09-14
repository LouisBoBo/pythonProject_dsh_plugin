/** 插件本机配置与 Job 类型 */

import type { TranscriptItem } from './transcript.js'

export type CursorCodingConfig = {
  listen: string
  port: number
  dataRoot: string
  cursorApiKey: string
  writeScope: string[]
  /** 默认 composer-2.5 */
  model: string
}

export type JobStatus =
  | 'queued'
  | 'running'
  | 'pending_review'
  | 'syncing'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'blocked_no_runner'

export type CursorCodingJob = {
  id: string
  status: JobStatus
  workspace: string
  requirement: string
  parent_job_id: string | null
  /** DSH 会话 id；续改与 pending 对账用，不是聊天库 */
  dsh_session_id: string | null
  /** DSH tool/call id；刷新后认同一张卡 */
  dsh_call_id: string | null
  created_at: string
  updated_at: string
  detail: string
  events: StreamEvent[]
  changed_files: string[]
  deleted_files: string[]
  deferred_files: string[]
  synced_files: string[]
  last_synced_files: string[]
  write_scope: string[]
  sandbox_path: string | null
  agent_id: string | null
  run_id: string | null
  continue_count: number
  /** 本任务「本轮结论」是否已交付（begin/continue 收口或 finish 兜底）；再写码须改走 continue */
  conclusion_delivered?: boolean
  review_in_scope?: string[]
  review_deleted?: string[]
  review_deferred?: string[]
  assistant_text: string
  thinking_text: string
  transcript: TranscriptItem[]
  cancelled: boolean
}

export type StreamEvent = {
  type:
    | 'status'
    | 'tool_event'
    | 'assistant'
    | 'thinking'
    | 'user'
    | 'review'
    | 'error'
    | 'done'
  at: string
  message?: string
  status?: JobStatus
  name?: string
  path?: string
  tool_status?: string
  call_id?: string
  /** 写码片断 / Todo / 读搜壳结果摘要（进度卡） */
  snippet?: string
  pattern?: string
  command?: string
  thinking_duration_ms?: number
}

export type HitlAction =
  | 'cursor-coding.confirm'
  | 'cursor-coding.apply'
  | 'cursor-coding.steer'
  | 'cursor-coding.cancel'

export type HitlRecord = {
  action: HitlAction
  exp: number
  workspace?: string
  requirement_hash?: string
  job_id?: string
  /** confirm 签发时绑定 pending id，consume 时必须一致 */
  confirm_token?: string
  used: boolean
}
