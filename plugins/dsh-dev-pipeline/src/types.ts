/** 一体化流水线：运行态与账本类型。 */

export type StepId = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10'

export const STEP_IDS: readonly StepId[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']

export type StepStatus =
  | 'pending'
  | 'running'
  | 'pass'
  | 'fail'
  | 'skipped'
  | 'waiting_hitl'
  | 'cancelled'

export type RunStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'waiting_hitl'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export interface PipelineConfig {
  dataRoot: string
  cursorChatBase: string
  maxFixRounds: number
  maxDeployAttempts: number
  autoRun: boolean
  push: boolean
  prProvider: 'auto' | 'skip'
  stepPaceMs: number
  cursorTimeoutMs: number
  validateCommands: string[]
  deploy: {
    command: string
    healthUrl: string
    timeoutMs: number
  }
  llm: {
    provider: string
    model: string
  }
  warnings: string[]
}

export interface FileSnippet {
  path: string
  bytes: number
  excerpt: string
}

export interface RawIntake {
  text: string
  chars: number
  images: string[]
  one_liner: string
  source: 'text' | 'image' | 'mixed'
}

export interface Prd {
  rev: number
  what: string
  how: string
  done: string[]
  non_goals: string[]
  scope: string[]
  scenario: string
  delivery: string
  change_limit: number
  created_at: string
}

export interface ContextPack {
  summary: string
  dirs: string[]
  stack: string[]
  key_files: FileSnippet[]
  must_read: string[]
  risks: string[]
  created_at: string
}

export interface Plan {
  rev: number
  problem: string
  changes: string[]
  validations: string[]
  paths: string[]
  created_at: string
}

export interface ImplementState {
  job_id: string
  status: string
  detail: string
  /** 已真正落盘的源码变更（不是插件沙箱里的全部改动）。 */
  changed_files: string[]
  deleted_files: string[]
  /** 插件报告但未同步/被写范围过滤的文件，仅作审计。 */
  deferred_files?: string[]
  gate: { class: string; reason: string; summary: string }
  /** 等待人工确认时的一次性票据，确认后立即清空。 */
  confirm_token?: string
  started_at: string
  ended_at: string
}

/** 写码前的工程脏文件基线；用于区分“本次写码改动”和“用户原有未提交改动”。 */
export interface ScopeBaseline {
  git: boolean
  paths: Record<string, string>
  created_at: string
}

export interface ValidateCommandResult {
  command: string
  exit_code: number | null
  timed_out: boolean
  output: string
}

export interface ValidateState {
  commands: ValidateCommandResult[]
  verdict: 'pass' | 'fail' | 'skipped'
  summary: string
}

export interface ReviewState {
  verdict: 'pass' | 'fail' | 'skipped'
  blockers: string[]
  warnings: string[]
  summary: string
  diff_bytes: number
}

export interface CommitState {
  sha: string
  message: string
  pushed: boolean
  files: string[]
  soft_skip: boolean
  summary: string
}

export interface PrState {
  provider: string
  url: string
  skipped: boolean
  reason: string
}

export interface DeployState {
  attempts: number
  command: string
  exit_code: number | null
  health_ok: boolean | null
  status: 'pass' | 'fail' | 'skipped'
  summary: string
}

export interface FixMandate {
  round: number
  must_fix: string[]
  source: string
}

export interface EpicArtifacts {
  scope_baseline?: ScopeBaseline
  implement?: ImplementState
  validate?: ValidateState
  review?: ReviewState
  commit?: CommitState
  pr?: PrState
  deploy?: DeployState
  implement_fix_mandate?: FixMandate
}

export interface Epic {
  id: string
  workspace: string
  raw_intake: RawIntake
  prd?: Prd
  context_pack?: ContextPack
  plan?: Plan
  artifacts: EpicArtifacts
  created_at: string
  updated_at: string
}

export interface RunEvent {
  ts: string
  step_id?: StepId
  kind: 'status' | 'step' | 'log' | 'warn' | 'error' | 'cursor'
  message: string
}

export interface StepState {
  step_id: StepId
  skill: string
  title: string
  status: StepStatus
  summary: string
  detail: string
  attempts: number
  started_at: string
  ended_at: string
  evidence: Record<string, unknown>
}

export interface Run {
  id: string
  epic_id: string
  session_id: string
  workspace: string
  status: RunStatus
  current_step: StepId
  steps: StepState[]
  events: RunEvent[]
  fix_round: number
  max_fix_rounds: number
  cancel_requested: boolean
  /** 基建类重试次数（不占写码打回轮次）。 */
  infra_retries?: number
  mode: 'auto' | 'manual'
  message: string
  created_at: string
  updated_at: string
  started_at: string
  ended_at: string
  error: string
}

export interface StepResult {
  status: 'pass' | 'fail' | 'skipped' | 'waiting_hitl'
  summary: string
  detail?: string
  evidence?: Record<string, unknown>
  /** 不可通过打回写码修复的失败（基建、配置、权限）。 */
  fatal?: boolean
  /** infra=临时断连/上游网络失败，可原步重试且不占打回轮次。 */
  retryable?: 'infra'
}

export interface StepContext {
  ctx: PipelineCtx
  cfg: PipelineConfig
  epic: Epic
  run: Run
  signal: AbortSignal
  log: (message: string) => void
  save: () => void
}

/** 只声明用到的宿主服务，避免把 cordis 类型带进业务模块。 */
export interface PipelineCtx {
  llm: {
    listProviders(): Array<{ id: string; name: string }>
    listModels(provider: string): Promise<Array<{ id: string; name?: string }>>
    stream(options: Record<string, unknown>): AsyncIterable<Record<string, unknown>>
  }
  skills: {
    register(skill: Record<string, unknown>): () => void
  }
  tools: {
    register(tool: unknown): () => void
  }
}

export interface StepDefinition {
  id: StepId
  skill: string
  title: string
  run: (sc: StepContext) => Promise<StepResult>
}

export const STEP_TITLES: Record<StepId, string> = {
  '1': '需求采集',
  '2': '需求理解 · PRD-lite',
  '3': '读库上下文 · Prime',
  '4': '规划实现 · validation-first',
  '5': '写代码 · Cursor 插件',
  '6': '机器验证 · 只认 PASS/FAIL',
  '7': '复核 · 审码（仅本次改动）',
  '8': '提交 · Git commit/push',
  '9': '开 PR',
  '10': '部署上线',
}

export const STEP_SKILLS: Record<StepId, string> = {
  '1': 'req-intake-multimodal',
  '2': 'plan-create-prd',
  '3': 'prime-codebase',
  '4': 'piv-plan-implementation',
  '5': 'piv-implement',
  '6': 'piv-validate',
  '7': 'piv-review-changes',
  '8': 'piv-commit',
  '9': 'piv-create-pr',
  '10': 'piv-deploy',
}
