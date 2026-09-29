import type { ReviewEvent, ReviewJob } from './types.js'
import { feishuReady, loadConfig } from './config.js'
import { publishReviewToFeishu } from './feishu-docs.js'
import { createJob, loadJob, patchJob } from './jobs.js'
import { buildReportMarkdown, engineStatus, runExistingReview } from './review-client.js'
import { prepareWorkspace } from './workspace.js'

const queue: string[] = []
let pumping = false
const recentKeys = new Map<string, number>()

function dedupeKey(event: ReviewEvent): string {
  return `${event.repo}|${event.commit || event.localPath || ''}|${event.branch}`
}

function shouldDedupe(event: ReviewEvent): boolean {
  if (event.skip) return false
  const key = dedupeKey(event)
  const now = Date.now()
  const prev = recentKeys.get(key) || 0
  if (now - prev < 90_000) return true
  recentKeys.set(key, now)
  for (const [k, ts] of recentKeys) {
    if (now - ts > 10 * 60_000) recentKeys.delete(k)
  }
  return false
}

export async function enqueueReview(event: ReviewEvent): Promise<ReviewJob> {
  if (shouldDedupe(event)) {
    const job = createJob({
      ...event,
      skip: true,
      skipReason: '90 秒内相同仓库/提交已入队，跳过重复 Webhook',
    })
    return job
  }
  const job = createJob(event)
  if (!event.skip) {
    queue.push(job.id)
    void pump()
  }
  return job
}

async function pump(): Promise<void> {
  if (pumping) return
  pumping = true
  try {
    while (queue.length) {
      const id = queue.shift()
      if (id) await executeJob(id)
    }
  } finally {
    pumping = false
  }
}

export async function executeJob(id: string): Promise<ReviewJob> {
  const job = loadJob(id)
  if (!job) throw new Error(`任务不存在：${id}`)
  if (job.event.skip) return patchJob(id, { status: 'skipped', detail: job.event.skipReason })

  const cfg = loadConfig()
  patchJob(id, { status: 'running', detail: '准备工作区' })

  const ws = await prepareWorkspace(cfg, job.event)
  if (!ws.ok) return patchJob(id, { status: 'review_failed', workspace: ws.path, detail: ws.detail })

  const st = await engineStatus(cfg.engine)
  if (!st.ok) {
    return patchJob(id, {
      status: 'review_failed',
      workspace: ws.path,
      detail: st.detail || '现有审码车道未就绪（未改引擎，请先启动 WorkBuddy 引擎）',
    })
  }

  patchJob(id, { status: 'running', workspace: ws.path, detail: '调用现有 /api/code-review/list → /run' })
  let run
  try {
    run = await runExistingReview({
      engine: cfg.engine,
      localPath: ws.path,
      focus: job.event.focus,
    })
  } catch (err) {
    return patchJob(id, { status: 'review_failed', workspace: ws.path, detail: String(err) })
  }
  if (!run.ok) {
    return patchJob(id, { status: 'review_failed', workspace: ws.path, detail: run.detail })
  }

  const markdown = buildReportMarkdown({
    repo: job.event.repo,
    commit: job.event.commit,
    branch: job.event.branch,
    source: job.event.source,
    reportId: run.reportId,
    reply: run.reply,
    workspace: ws.path,
  })
  patchJob(id, {
    status: 'review_ok',
    workspace: ws.path,
    reportId: run.reportId,
    reportMarkdown: markdown,
    detail: '审码完成，正在写入飞书文档',
  })
  return sendJobToFeishu(id)
}

export async function sendJobToFeishu(id: string): Promise<ReviewJob> {
  const job = loadJob(id)
  if (!job) throw new Error(`任务不存在：${id}`)
  if (!job.reportMarkdown) {
    return patchJob(id, { status: 'feishu_failed', detail: '没有审码报告正文，无法发飞书' })
  }
  const cfg = loadConfig()
  const title = `审码报告 · ${job.event.repo} · ${(job.event.commit || 'HEAD').slice(0, 8)}`
  const published = await publishReviewToFeishu({ cfg, title, markdown: job.reportMarkdown })
  if (published.ok) {
    return patchJob(id, {
      status: 'feishu_ok',
      feishuUrl: published.url,
      feishuDocumentId: published.documentId,
      feishuLocalPath: published.localPath,
      detail: published.url || '已写入飞书文档',
    })
  }
  return patchJob(id, {
    status: feishuReady(cfg) ? 'feishu_failed' : 'feishu_pending',
    feishuLocalPath: published.localPath,
    detail: published.detail,
  })
}
