/** 插件本机配置与 Job 类型 */

import type { TranscriptItem } from './transcript.js'
import type { ChatImageRef } from './images.js'
import type { QualityReport } from './qualityGate.js'
import type { BackendRestartOffer } from './backendRestart.js'

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
  /**
   * code=改代码（沙箱 → 同步）；ops=重启/测试/日志等终端操作（真实项目，不改代码）。
   * 缺省按诉求再判；旧账本没有该字段。
   */
  work_kind?: 'code' | 'ops'
  /** 本轮随诉求传入的截图（落盘路径，供 Cursor SDK 多模态） */
  images?: ChatImageRef[]
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
  /** 拷贝超时/失败而未进入沙箱的文件（相对路径） */
  sandbox_skipped_files?: string[]
  agent_id: string | null
  run_id: string | null
  continue_count: number
  /** 本任务「本轮结论」是否已交付（begin/continue 收口或 finish 兜底）；再写码须改走 continue */
  conclusion_delivered?: boolean
  /** 结论首次交付时间：upd 之后的任务补丁会刷新 updated_at，挂载轮次须认这个时间 */
  conclusion_at?: string | null
  review_in_scope?: string[]
  review_deleted?: string[]
  review_deferred?: string[]
  /**
   * pending_review 子态（权威字段，供 UI 相位；禁止用 detail 正文猜）。
   * await_user=人工勾选；auto_applying=自动同步中；auto_failed=自动同步失败待手工。
   */
  review_gate?: 'await_user' | 'auto_applying' | 'auto_failed' | null
  assistant_text: string
  thinking_text: string
  transcript: TranscriptItem[]
  cancelled: boolean
  /** 质量门控报告（质量链 ① 步产出，绿色=通过，黄色=有问题，红色=阻塞同步） */
  quality_report?: QualityReport
  /**
   * 沙箱编译验证结果。仅在实际跑过 verifyInSandbox 时写入。
   * false → 禁止自动同步（改人工审）；未跑则为 undefined。
   */
  verify_ok?: boolean
  /**
   * 同步后交付审计（落盘指纹 / API 挂载 / 菜单 / 删除验尸）。
   * ok=false 时任务须为 failed，禁止「已完成」假交付。
   */
  delivery_audit?: {
    ok: boolean
    detail: string
    checks?: { name: string; ok: boolean; detail: string }[]
    /** 通过数 / 实际跑过的检查数。没有检查项时不写。 */
    completion?: { passed: number; total: number; percent: number }
  } | null
  /**
   * 门禁通过后才有：本机写码服务执行后端重启（可见终端窗）。
   * 缺省/undefined = 本轮不提供自动重启。
   */
  backend_restart?: BackendRestartOffer | null
  /**
   * 有后端变更但无法自动解析启动命令/端口时的文案提示（保证仍告知需重启）。
   */
  backend_restart_hint?: string | null
  /**
   * 同步后由 Cursor SDK 在真实项目终端里确认前后端。
   * ok=false 时不得写成「已完成、可以看页面」。
   */
  service_check?: {
    required: boolean
    ok: boolean
    skipped?: boolean
    detail: string
    frontend: string
    backend: string
    api: string
  } | null
  /**
   * Cursor 调用 ask_user_choice 时挂起的用户选择题。
   * 进度卡据此弹选项；答完或取消后须清 null。
   */
  pending_user_choice?: {
    job_id: string
    call_id: string
    question: string
    options: { id: string; label: string }[]
    created_at: string
  } | null
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
  | 'cursor-chat.confirm'
  | 'cursor-chat.apply'
  | 'cursor-chat.steer'
  | 'cursor-chat.cancel'
  | 'cursor-chat.restart-backend'
  | 'cursor-chat.user-choice'

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
