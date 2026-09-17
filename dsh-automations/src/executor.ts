import type { Automation, AutomationRun } from './types.js'
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
  runMesPipeline,
  runNewsPipeline,
  runWeeklyPipeline,
} from './pipelines.js'
import { deliverWecom } from './wecom.js'

export type ExecuteResult = {
  ok: boolean
  skipped?: boolean
  reason?: string
  run?: AutomationRun | null
}

async function produceSummary(automation: Automation, cwd: string | null): Promise<string> {
  const forbidden = detectForbiddenAction(automation.prompt)
  if (forbidden) {
    throw new AutomationError(forbidden, '自动化任务禁止写码、提交或部署')
  }
  if (!automation.prompt.trim()) {
    throw new AutomationError('empty_prompt', '任务缺少执行指令')
  }
  if (usesTemplatePipeline(automation)) {
    switch (automation.template_id) {
      case 'daily-ai-news':
        return runNewsPipeline()
      case 'weekly-work-report':
        return runWeeklyPipeline(cwd)
      case 'mes-daily-production-report':
        return runMesPipeline()
      case 'dir-watch-digest':
        return runDirWatchPipeline(automation, cwd)
      default:
        break
    }
  }
  return runCustomAgent(automation, cwd)
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
  let error: { code: string; message: string } | null = null
  try {
    summary = (await produceSummary(automation, cwd)).trim()
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
  })

  if (status === 'succeeded' && summary) {
    try {
      const delivery = await deliverWecom({
        pushToWecom: automation.push_to_wecom,
        name: automation.name,
        summary: truncate(summary, 4000),
      })
      await updateRun(dataRoot, rec.id, delivery)
    } catch (e) {
      await updateRun(dataRoot, rec.id, {
        delivery_status: 'failed',
        delivery_error: e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500),
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
