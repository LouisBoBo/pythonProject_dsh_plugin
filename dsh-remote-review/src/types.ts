export type FeishuConfig = {
  appId: string
  appSecret: string
  folderToken: string
}

export type RemoteReviewConfig = {
  engine: string
  listen: string
  port: number
  secret: string
  workspaceRoot: string
  dataRoot: string
  feishu: FeishuConfig
}

export type ReviewEvent = {
  source: 'local' | 'github' | 'gitlab' | 'simulate'
  repo: string
  commit: string
  branch: string
  localPath?: string
  cloneUrl?: string
  focus: string
  skip?: boolean
  skipReason?: string
}

export type JobStatus =
  | 'queued'
  | 'running'
  | 'review_ok'
  | 'review_failed'
  | 'feishu_ok'
  | 'feishu_pending'
  | 'feishu_failed'
  | 'skipped'

export type ReviewJob = {
  id: string
  createdAt: string
  updatedAt: string
  status: JobStatus
  event: ReviewEvent
  workspace?: string
  reportId?: string
  reportMarkdown?: string
  feishuUrl?: string
  feishuDocumentId?: string
  feishuLocalPath?: string
  detail?: string
}

export type EngineRunResult = {
  ok: boolean
  reportId: string
  reply: string
  raw: Record<string, unknown>
  detail?: string
}
