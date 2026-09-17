export type AutomationStatus = 'active' | 'paused'
export type ScheduleType = 'recurring' | 'once'
export type AutomationSource = 'template' | 'custom'
export type RunStatus = 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled'
export type DeliveryStatus = 'pending' | 'sent' | 'failed' | 'skipped' | 'dry_run'

export type Automation = {
  id: string
  name: string
  prompt: string
  source: AutomationSource
  template_id: string | null
  prompt_fingerprint: string
  status: AutomationStatus
  schedule_type: ScheduleType
  rrule: string
  scheduled_at: string | null
  valid_from: string | null
  valid_until: string | null
  cwds: string[]
  push_to_wecom: boolean
  next_run_at: number | null
  last_run_at: number | null
  created_at: number
  updated_at: number
}

export type AutomationRun = {
  id: string
  automation_id: string
  automation_name: string
  status: RunStatus
  skip_reason?: string
  summary: string
  error?: { code: string; message: string } | null
  started_at: number
  finished_at: number | null
  delivery_status?: DeliveryStatus
  delivery_error?: string
  cwd?: string | null
}

export type AutomationErrorBody = { code: string; message: string }

export class AutomationError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'AutomationError'
    this.code = code
  }
}

export type AutomationsConfig = {
  listen: string
  port: number
  dataRoot: string
  schedulerEnabled: boolean
  tickSec: number
  llmBaseUrl: string
  llmApiKey: string
  llmModel: string
  wecomPushEnabled: boolean
  wecomWebhookKey: string
  wecomDryRun: boolean
  mesBaseUrl: string
}

export type TemplateDef = {
  id: string
  title: string
  description: string
  prompt: string
  push_to_wecom: boolean
  schedule_type: ScheduleType
  rrule: string
  scheduleLabel: string
  icon?: string
}

export type SchedulePreset = {
  value: string
  label: string
  rrule: string
}
