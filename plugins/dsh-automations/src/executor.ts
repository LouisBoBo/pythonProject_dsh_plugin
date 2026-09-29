import type { Automation, AutomationRun, ReportChart } from './types.js'
import { AutomationError } from './types.js'
import { nowSec, newId, truncate } from './util.js'
import { detectForbiddenAction } from './safety.js'
import { sanitizeCwds } from './paths.js'
import {
  appendRun,
  getAutomation,
  listRuns,
  updateAutomation,
  updateRun,
  usesTemplatePipeline,
} from './store.js'
import { markRunning, clearRunning } from './runtime.js'
import { computeNextRunAt } from './schedule.js'
import { runCustomAgent } from './agent.js'
import {
  runDirWatchPipeline,
  runMesPipelineBundle,
  runNewsPipeline,
  runWeeklyPipeline,
} from './pipelines.js'
import { deliverWecom } from './wecom.js'
import { deliverFeishuDoc } from './feishu_docs.js'
import { deliverYuqueDoc } from './yuque_docs.js'
import { shanghaiYmd } from './mes_report.js'

export type ExecuteResult = {
  ok: boolean
  skipped?: boolean
  reason?: string
  run?: AutomationRun | null
}

async function produceSummary(
  automation: Automation,
  cwd: string | null,
): Promise<{ summary: string; feishuTitle: string; charts?: ReportChart[] }> {
  const forbidden = detectForbiddenAction(automation.prompt)
  if (forbidden) {
    throw new AutomationError(forbidden, '自动化任务禁止写码、提交或部署')
  }
  if (!automation.prompt.trim()) {
    throw new AutomationError('empty_prompt', '任务缺少执行指令')
  }
  const fallbackTitle = `${automation.name} ${shanghaiYmd()}`
  if (usesTemplatePipeline(automation)) {
    switch (automation.template_id) {
      case 'daily-ai-news':
        return { summary: await runNewsPipeline(), feishuTitle: fallbackTitle }
      case 'weekly-work-report':
        return { summary: await runWeeklyPipeline(cwd), feishuTitle: fallbackTitle }
      case 'mes-daily-production-report': {
        const out = await runMesPipelineBundle()
        return { summary: out.summary, feishuTitle: `生产运营日报 ${out.yesterday}`, charts: out.charts }
      }
      case 'dir-watch-digest':
        return { summary: await runDirWatchPipeline(automation, cwd), feishuTitle: fallbackTitle }
      default:
        break
    }
  }
  return { summary: await runCustomAgent(automation, cwd), feishuTitle: fallbackTitle }
}

export async function executeAutomation(dataRoot: string, automation: Automation): Promise<ExecuteResult> {
  const runId = newId('run')
  const started = nowSec()
  const locked = await markRunning(dataRoot, automation.id, runId)
  if (!locked) {
    return { ok: false, skipped: true, reason: 'already_running' }
  }
  const cwds = sanitizeCwds(automation.cwds)
  const cwd = cwds[0] || null
  const rec = await appendRun(dataRoot, {
    id: runId,
    automation_id: automation.id,
    automation_name: automation.name,
    status: 'running',
    started_at: started,
    cwd,
    summary: '',
  })

  let status: AutomationRun['status'] = 'failed'
  let summary = ''
  let feishuTitle = automation.name
  let charts: ReportChart[] = []
  let error: { code: string; message: string } | null = null
  try {
    const produced = await produceSummary(automation, cwd)
    summary = produced.summary.trim()
    feishuTitle = produced.feishuTitle
    charts = produced.charts || []
    if (!summary) {
      error = { code: 'empty_prompt', message: '未返回有效摘要' }
    } else {
      status = 'succeeded'
    }
  } catch (e) {
    if (e instanceof AutomationError) {
      error = { code: e.code, message: e.message.slice(0, 2000) }
    } else {
      error = { code: 'failed', message: (e instanceof Error ? e.message : String(e)).slice(0, 2000) }
    }
    status = 'failed'
  } finally {
    await clearRunning(dataRoot, automation.id, runId)
  }

  const finished = nowSec()
  await updateRun(dataRoot, rec.id, {
    status,
    finished_at: finished,
    summary: truncate(summary, 16000),
    error,
    ...(charts.length ? { charts } : {}),
  })

  if (status === 'succeeded' && summary) {
    try {
      const delivery = await deliverWecom({
        pushToWecom: automation.push_to_wecom,
        name: automation.name,
        summary,
        startedAt: started,
      })
      await updateRun(dataRoot, rec.id, delivery)
    } catch (e) {
      await updateRun(dataRoot, rec.id, {
        delivery_status: 'failed',
        delivery_error: e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500),
      })
    }
    try {
      const feishu = await deliverFeishuDoc({
        automation,
        title: feishuTitle,
        summary,
        charts,
      })
      await updateRun(dataRoot, rec.id, feishu)
    } catch (e) {
      await updateRun(dataRoot, rec.id, {
        feishu_status: 'failed',
        feishu_error: e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500),
      })
    }
    try {
      const yuque = await deliverYuqueDoc({
        automation,
        title: feishuTitle,
        summary,
        charts,
        dataRoot,
      })
      await updateRun(dataRoot, rec.id, yuque)
    } catch (e) {
      await updateRun(dataRoot, rec.id, {
        yuque_status: 'failed',
        yuque_error: e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500),
      })
    }
  }

  const last = finished
  if (error?.code === 'forbidden_action') {
    await updateAutomation(dataRoot, automation.id, {
      status: 'paused',
      last_run_at: last,
      next_run_at: null,
    })
  } else if (automation.schedule_type === 'once') {
    await updateAutomation(dataRoot, automation.id, {
      status: 'paused',
      last_run_at: last,
      next_run_at: null,
    })
  } else {
    const next = computeNextRunAt({ ...automation, status: 'active' }, new Date())
    await updateAutomation(dataRoot, automation.id, { last_run_at: last, next_run_at: next })
  }

  const latest = listRuns(dataRoot, 1, 50).items.find((x) => x.id === rec.id)
  return { ok: status === 'succeeded', run: latest || rec }
}

export async function executeById(dataRoot: string, id: string): Promise<ExecuteResult> {
  const item = getAutomation(dataRoot, id)
  if (!item) return { ok: false, reason: 'not_found' }
  return executeAutomation(dataRoot, item)
}
