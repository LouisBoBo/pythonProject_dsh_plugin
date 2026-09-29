/**
 * 真机验证：已终态 job 的 wait 路径必须毫秒级返回精简正文（禁止卡 Deep diving）。
 * 用法：pnpm build && node lib/verify-wait-fast.js [job_id]
 */
import { loadJob } from './jobs.js'

const TERMINAL = new Set([
  'pending_review',
  'succeeded',
  'failed',
  'cancelled',
  'blocked_no_runner',
])

function buildDoneBody(jobId: string): string {
  const job = loadJob(jobId)
  if (!job) return `任务不存在：${jobId}`
  const tools = (job.transcript || []).filter((t) => t.kind === 'tool')
  const asst = (job.assistant_text || '').trim()
  const lines = [
    `**Cursor 写码已结束**`,
    ``,
    `- job: \`${job.id}\``,
    `- 状态: **${job.status}**`,
    `- 工具调用: ${tools.length} 次`,
    `- 说明: ${job.detail || ''}`,
    ``,
  ]
  if (asst) {
    const clip = asst.length > 2500 ? asst.slice(0, 2500) + '\n\n…[说明已截断]' : asst
    lines.push(`### 说明`, ``, clip, ``)
  }
  if (job.status === 'pending_review') {
    const files = job.review_in_scope || []
    lines.push(`### 待同步（范围内 ${files.length}）`, ``)
    for (const f of files) lines.push(`- ${f}`)
  }
  return lines.join('\n')
}

function main() {
  const id = process.argv[2] || 'ccj-20260912-091259-6191'
  const t0 = Date.now()
  const job = loadJob(id)
  if (!job) {
    console.error('FAIL: job missing', id)
    process.exit(1)
  }
  if (!TERMINAL.has(job.status)) {
    console.error('FAIL: not terminal', job.status)
    process.exit(1)
  }
  const body = buildDoneBody(id)
  const ms = Date.now() - t0
  console.log('job', id, job.status)
  console.log('elapsed_ms', ms)
  console.log('body_chars', body.length)
  console.log('in_scope', (job.review_in_scope || []).length)
  console.log('--- body preview ---')
  console.log(body.slice(0, 600))
  if (ms > 500) {
    console.error('FAIL: too slow for terminal snapshot')
    process.exit(1)
  }
  if (body.length > 20_000) {
    console.error('FAIL: body too large', body.length)
    process.exit(1)
  }
  if (!body.includes('待同步') && job.status === 'pending_review') {
    console.error('FAIL: missing 待同步 section')
    process.exit(1)
  }
  console.log('PASS: wait-done path is fast and compact')
}

main()
