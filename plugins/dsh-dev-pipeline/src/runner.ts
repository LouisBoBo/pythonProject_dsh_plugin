/** 十步编排运行时：后台执行、打回循环、暂停/确认/取消。 */

import { saveEpic, saveRun, appendEvent, markStep, newId, nowIso } from './store.js'
import { STEPS } from './steps/index.js'
import type {
  Epic,
  PipelineConfig,
  PipelineCtx,
  Run,
  StepContext,
  StepId,
  StepResult,
} from './types.js'
import { STEP_IDS, STEP_SKILLS, STEP_TITLES } from './types.js'

const FIXABLE: ReadonlySet<string> = new Set(['5', '6', '7', '8'])

interface ActiveEntry {
  controller: AbortController
  run: Run
  promise: Promise<void>
}

const active = new Map<string, ActiveEntry>()

export function isRunActive(runId: string): boolean {
  return active.has(runId)
}

export interface CreateRunInput {
  cfg: PipelineConfig
  workspace: string
  message: string
  sessionId: string
  mode?: 'auto' | 'manual'
  startStep?: StepId
  images?: string[]
}

export function createRun(input: CreateRunInput): { run: Run; epic: Epic } {
  const { cfg, workspace, message } = input
  const now = nowIso()
  const epic: Epic = {
    id: newId('epic'),
    workspace,
    raw_intake: {
      text: '',
      chars: 0,
      images: Array.isArray(input.images) ? input.images.slice(0, 8) : [],
      one_liner: '',
      source: 'text',
    },
    artifacts: {},
    created_at: now,
    updated_at: now,
  }
  const steps = STEP_IDS.map((id) => ({
    step_id: id,
    skill: STEP_SKILLS[id],
    title: STEP_TITLES[id],
    status: 'pending' as const,
    summary: '',
    detail: '',
    attempts: 0,
    started_at: '',
    ended_at: '',
    evidence: {},
  }))
  const startStep = input.startStep || '1'
  const run: Run = {
    id: newId('run'),
    epic_id: epic.id,
    session_id: input.sessionId,
    workspace,
    status: 'queued',
    current_step: startStep,
    steps,
    events: [],
    fix_round: 0,
    max_fix_rounds: Math.max(0, cfg.maxFixRounds),
    cancel_requested: false,
    mode: input.mode || 'auto',
    message: String(message || ''),
    created_at: now,
    updated_at: now,
    started_at: '',
    ended_at: '',
    error: '',
  }
  saveEpic(cfg, epic)
  saveRun(cfg, run)
  return { run, epic }
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((r) => setTimeout(r, ms))
}

function stepContext(
  ctx: PipelineCtx,
  cfg: PipelineConfig,
  epic: Epic,
  run: Run,
  signal: AbortSignal,
): StepContext {
  return {
    ctx,
    cfg,
    epic,
    run,
    signal,
    log: (message: string) => {
      appendEvent(run, 'log', message, run.current_step)
      saveRun(cfg, run)
    },
    save: () => saveEpic(cfg, epic),
  }
}

function mandateFrom(result: StepResult, stepId: StepId): string[] {
  const items: string[] = [result.summary]
  for (const line of String(result.detail || '').split(/\r?\n/)) {
    const s = line.replace(/^#+\s*/, '').replace(/^\d+\.\s*/, '').trim()
    if (!s) continue
    if (s.length > 300) {
      items.push(s.slice(0, 300))
    } else {
      items.push(s)
    }
  }
  const blockers = result.evidence?.blockers
  if (Array.isArray(blockers)) {
    for (const b of blockers) items.push(String(b))
  }
  const failed = result.evidence?.failed
  if (Array.isArray(failed)) {
    for (const f of failed) items.push(`修复失败的验证：${String(f)}`)
  }
  return [...new Set(items.filter(Boolean))].slice(0, 12).map((s) => `（第 ${stepId} 步）${s}`)
}

function resetForFixRound(cfg: PipelineConfig, epic: Epic, run: Run, stepId: StepId, result: StepResult): void {
  run.fix_round += 1
  epic.artifacts.implement_fix_mandate = {
    round: run.fix_round,
    must_fix: mandateFrom(result, stepId),
    source: stepId,
  }
  delete epic.artifacts.implement
  delete epic.artifacts.validate
  delete epic.artifacts.review
  delete epic.artifacts.commit
  delete epic.artifacts.pr
  delete epic.artifacts.deploy

  for (const id of ['5', '6', '7', '8'] as StepId[]) {
    const step = run.steps.find((s) => s.step_id === id)
    if (!step) continue
    step.status = 'pending'
    step.summary = ''
    step.detail = ''
    step.evidence = {}
    step.started_at = ''
    step.ended_at = ''
  }
  run.current_step = '5'
  run.status = 'running'
  saveEpic(cfg, epic)
  saveRun(cfg, run)
}

async function executeRun(
  ctx: PipelineCtx,
  cfg: PipelineConfig,
  epic: Epic,
  run: Run,
  signal: AbortSignal,
): Promise<void> {
  run.status = 'running'
  if (!run.started_at) run.started_at = nowIso()
  run.error = ''
  saveRun(cfg, run)

  for (;;) {
    const startIndex = STEP_IDS.indexOf(run.current_step)
    for (let i = Math.max(0, startIndex); i < STEPS.length; i += 1) {
      if (signal.aborted || run.cancel_requested) {
        run.status = 'cancelled'
        run.error = '已取消'
        run.ended_at = nowIso()
        appendEvent(run, 'warn', '任务已取消', run.current_step)
        saveRun(cfg, run)
        throw new Error('已取消')
      }

      const def = STEPS[i]
      const stepId = def.id
      run.current_step = stepId
      run.status = 'running'
      const attempts = (run.steps.find((s) => s.step_id === stepId)?.attempts || 0) + 1
      markStep(run, stepId, {
        status: 'running',
        started_at: nowIso(),
        ended_at: '',
        attempts,
      })
      appendEvent(run, 'step', `▶ 第 ${stepId} 步 ${def.title}`, stepId)
      saveRun(cfg, run)

      let result: StepResult
      try {
        result = await def.run(stepContext(ctx, cfg, epic, run, signal))
      } catch (err) {
        if (signal.aborted || run.cancel_requested) {
          run.status = 'cancelled'
          run.error = '已取消'
          run.ended_at = nowIso()
          markStep(run, stepId, { status: 'cancelled', ended_at: nowIso() })
          appendEvent(run, 'warn', '任务已取消', stepId)
          saveRun(cfg, run)
          throw new Error('已取消')
        }
        result = {
          status: 'fail',
          summary: `步骤异常：${String(err).slice(0, 400)}`,
          detail: String((err as Error)?.stack || err).slice(0, 4000),
          fatal: false,
          evidence: {},
        }
      }

      markStep(run, stepId, {
        status: result.status,
        summary: result.summary,
        detail: result.detail || '',
        ended_at: nowIso(),
        evidence: result.evidence || {},
      })
      appendEvent(
        run,
        result.status === 'fail' ? 'error' : result.status === 'waiting_hitl' ? 'warn' : 'step',
        `${result.status === 'pass' ? '✓' : result.status === 'skipped' ? '↷' : result.status === 'waiting_hitl' ? '⏸' : '✗'} 第 ${stepId} 步 ${def.title}：${result.summary}`,
        stepId,
      )
      saveRun(cfg, run)

      if (result.status === 'pass' || result.status === 'skipped') {
        run.infra_retries = 0
        await sleep(cfg.stepPaceMs)
        continue
      }

      // 网络抖动/服务未就绪属于环境问题，重试同一步，不消耗打回轮次。
      if (result.retryable === 'infra' && !result.fatal) {
        const used = run.infra_retries || 0
        const cap = 2
        if (used < cap) {
          run.infra_retries = used + 1
          const stepState = run.steps.find((s) => s.step_id === stepId)
          if (stepState) {
            stepState.status = 'pending'
            stepState.summary = ''
            stepState.detail = ''
            stepState.evidence = {}
            stepState.started_at = ''
            stepState.ended_at = ''
          }
          run.status = 'running'
          appendEvent(
            run,
            'warn',
            `第 ${stepId} 步基础设施异常，重试 ${used + 1}/${cap}：${result.summary}`,
            stepId,
          )
          saveRun(cfg, run)
          await sleep(1500)
          i -= 1
          continue
        }
        appendEvent(run, 'warn', `第 ${stepId} 步基础设施重试已达上限`, stepId)
      }

      if (result.status === 'waiting_hitl') {
        run.status = 'waiting_hitl'
        saveRun(cfg, run)
        return
      }

      if (result.fatal || !FIXABLE.has(stepId)) {
        run.status = 'failed'
        run.error = result.summary
        run.ended_at = nowIso()
        appendEvent(run, 'error', `任务失败：${result.summary}`, stepId)
        saveRun(cfg, run)
        return
      }

      if (run.fix_round >= run.max_fix_rounds) {
        run.status = 'failed'
        run.error = `已打回 ${run.max_fix_rounds} 轮仍未通过：${result.summary}`
        run.ended_at = nowIso()
        appendEvent(run, 'error', run.error, stepId)
        saveRun(cfg, run)
        return
      }

      resetForFixRound(cfg, epic, run, stepId, result)
      appendEvent(
        run,
        'warn',
        `第 ${run.fix_round} 轮打回写码（来源第 ${stepId} 步）：${result.summary}`,
        stepId,
      )
      saveRun(cfg, run)
      break
    }

    if (run.current_step === '10' && run.status === 'running') {
      const last = run.steps.find((s) => s.step_id === '10')
      if (last && (last.status === 'pass' || last.status === 'skipped')) {
        run.status = 'succeeded'
        run.ended_at = nowIso()
        appendEvent(run, 'status', '十步流水线完成', '10')
        saveRun(cfg, run)
        return
      }
    }
    if (run.status !== 'running') return
  }
}

export function startRunInBackground(
  ctx: PipelineCtx,
  cfg: PipelineConfig,
  epic: Epic,
  run: Run,
): void {
  if (active.has(run.id)) return
  const controller = new AbortController()
  const entry: ActiveEntry = {
    controller,
    run,
    promise: Promise.resolve(),
  }
  entry.promise = executeRun(ctx, cfg, epic, run, controller.signal)
    .catch((err) => {
      if (run.status === 'running' || run.status === 'queued') {
        run.status = 'failed'
        run.error = String(err).slice(0, 400)
        run.ended_at = nowIso()
        appendEvent(run, 'error', run.error, run.current_step)
        saveRun(cfg, run)
      }
    })
    .finally(() => {
      active.delete(run.id)
    })
  active.set(run.id, entry)
}

/** 取消并等待后台协程真正退出；超时返回 false。 */
export async function stopRun(
  cfg: PipelineConfig,
  run: Run,
  timeoutMs = 8_000,
): Promise<boolean> {
  const entry = active.get(run.id)
  if (!entry) {
    cancelRun(cfg, run)
    return true
  }
  cancelRun(cfg, run)
  return Promise.race([
    entry.promise.then(() => true),
    sleep(Math.max(0, timeoutMs)).then(() => false),
  ])
}

export function cancelRun(cfg: PipelineConfig, run: Run): void {
  run.cancel_requested = true
  const entry = active.get(run.id)
  if (entry) {
    entry.run.cancel_requested = true
    entry.controller.abort()
  } else if (['queued', 'running', 'paused', 'waiting_hitl'].includes(run.status)) {
    run.status = 'cancelled'
    run.ended_at = nowIso()
    run.error = '已取消'
    appendEvent(run, 'warn', '任务已取消', run.current_step)
  }
  saveRun(cfg, run)
}
