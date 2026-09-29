import type { EngineRunResult } from './types.js'

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text()
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return { ok: false, detail: text.slice(0, 500) || `HTTP ${res.status}` }
  }
}

export async function engineStatus(engine: string): Promise<{ ok: boolean; raw: Record<string, unknown>; detail?: string }> {
  try {
    const res = await fetch(`${engine.replace(/\/$/, '')}/api/code-review/status`, {
      signal: AbortSignal.timeout(8000),
    })
    const raw = await readJson(res)
    const lane = raw.code_review && typeof raw.code_review === 'object' ? (raw.code_review as Record<string, unknown>) : raw
    const ok = res.ok && raw.ok !== false && lane.ok !== false
    return { ok, raw, detail: String(raw.detail || raw.reply || (ok ? '审码车道就绪' : '审码车道未就绪')) }
  } catch (err) {
    return { ok: false, raw: {}, detail: `引擎不可达 ${engine}：${String(err)}` }
  }
}

export async function runExistingReview(opts: {
  engine: string
  localPath: string
  focus: string
}): Promise<EngineRunResult> {
  const base = opts.engine.replace(/\/$/, '')
  try {
    const listRes = await fetch(`${base}/api/code-review/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ local_path: opts.localPath, scope: '' }),
      signal: AbortSignal.timeout(120_000),
    })
    const listJson = await readJson(listRes)
    const ticket = String(listJson.path_ticket || '')
    if (!listRes.ok || !ticket) {
      return {
        ok: false,
        reportId: '',
        reply: '',
        raw: listJson,
        detail: String(listJson.detail || listJson.reply || 'list 未返回 path_ticket'),
      }
    }

    const runRes = await fetch(`${base}/api/code-review/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        local_path: opts.localPath,
        scope: '',
        focus: opts.focus,
        path_ticket: ticket,
      }),
      signal: AbortSignal.timeout(900_000),
    })
    const runJson = await readJson(runRes)
    const reportId = String(runJson.report_id || runJson.id || '')
    const reply = String(runJson.reply || '')
    const ok = runRes.ok && runJson.ok !== false && Boolean(reportId || reply)
    return {
      ok,
      reportId,
      reply,
      raw: runJson,
      detail: ok ? undefined : String(runJson.detail || runJson.reply || `run HTTP ${runRes.status}`),
    }
  } catch (err) {
    return { ok: false, reportId: '', reply: '', raw: {}, detail: `引擎不可达 ${base}：${String(err)}` }
  }
}

export function buildReportMarkdown(opts: {
  repo: string
  commit: string
  branch: string
  source: string
  reportId: string
  reply: string
  workspace: string
}): string {
  const now = new Date().toISOString()
  const body = (opts.reply || '').trim() || '（引擎未返回 Markdown 正文）'
  return [
    `# 代码审核汇总报告`,
    ``,
    `- 仓库：${opts.repo}`,
    `- 分支：${opts.branch}`,
    `- 提交：${opts.commit || '—'}`,
    `- 来源：${opts.source}`,
    `- 报告 ID：${opts.reportId || '—'}`,
    `- 检出路径：${opts.workspace}`,
    `- 生成时间：${now}`,
    ``,
    `---`,
    ``,
    body,
    ``,
  ].join('\n')
}
