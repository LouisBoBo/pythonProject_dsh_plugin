export type FeishuConfig = {
  appId: string
  appSecret: string
  /** 可选：个人云盘文件夹（常因权限失败；优先用 wiki） */
  folderToken: string
  /** 推荐：文档库（知识空间）space_id，报告会出现在「我的文档库」 */
  wikiSpaceId: string
  /** 可选：挂到文档库某父节点下；空则在文档库根目录 */
  wikiParentNodeToken: string
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
