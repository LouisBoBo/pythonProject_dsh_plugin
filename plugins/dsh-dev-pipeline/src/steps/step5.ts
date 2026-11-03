/** 第 5 步：写代码 · 交给对话写码插件（:18791）。 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import {
  CursorHttpError,
  confirmStart,
  createPending,
  issueNonce,
  latestPending,
  probe,
  waitJob,
  HITL_CONFIRM_ACTION,
  type CursorJob,
} from '../cursorChat.js'
import { prepareImages } from '../images.js'
import { deltaSinceBaseline, filterScopePaths, snapshotScope } from '../scope.js'
import type { ImplementState, StepContext, StepResult } from '../types.js'
import { fail, getMustFix, pass, wait } from './helpers.js'

const REQUIREMENT_MAX = 12_000
const NETWORK_HINT =
  /connection refused|econnrefused|econnreset|socket hang up|fetch failed|network request failed|retryable\s*=\s*true|timed out|timeout|连接失败|连接中断|积极拒绝/i

function buildRequirement(sc: StepContext): string {
  const prd = sc.epic.prd
  const plan = sc.epic.plan
  const mustFix = getMustFix(sc.epic)
  const lines: string[] = []

  lines.push('【任务】按下面的需求与计划改动工程代码。只改工程目录内文件；不要提交、推送、开 PR 或部署。')
  lines.push('')
  if (prd) {
    lines.push(`【要做什么】${prd.what}`)
    lines.push(`【怎么干】${prd.how}`)
    lines.push(`【验收标准】${prd.done.join('；')}`)
    if (prd.non_goals.length) lines.push(`【非目标】${prd.non_goals.join('；')}`)
    if (prd.scope.length) lines.push(`【范围内】${prd.scope.join('、')}`)
    lines.push(`【改动上限】约 ${prd.change_limit} 个文件`)
  } else {
    lines.push(`【需求】${sc.run.message}`)
  }
  if (plan) {
    lines.push('')
    lines.push(`【实现计划 v${plan.rev}】`)
    plan.changes.forEach((c, i) => lines.push(`${i + 1}. ${c}`))
    if (plan.paths.length) lines.push(`【预计触及】${plan.paths.join('、')}`)
    if (plan.validations.length) lines.push(`【机器验证命令】${plan.validations.join('；')}`)
  }
  if (mustFix.length) {
    lines.push('')
    lines.push('【上一轮被打回，本轮必须修复】')
    mustFix.forEach((m, i) => lines.push(`${i + 1}. ${m}`))
  }
  return lines.join('\n').slice(0, REQUIREMENT_MAX)
}

function asList(value: unknown, max = 500): string[] {
  if (!Array.isArray(value)) return []
  return value.map((x) => String(x || '')).filter(Boolean).slice(0, max)
}

function saveImplement(sc: StepContext, impl: ImplementState): void {
  sc.epic.artifacts.implement = impl
  sc.save()
}

interface AppliedScope {
  changed: string[]
  deleted: string[]
  deferred: string[]
  source: 'git' | 'job'
  untouchedBaseline: number
}

/**
 * 实际落盘范围：
 * - Git 工程以写码前基线为准，只认相对基线的真实变化（原脏文件不算本次改动）；
 * - 非 Git 工程只认插件 synced_files，绝不把 changed_files 当成已落盘。
 */
async function resolveAppliedScope(sc: StepContext, job: CursorJob): Promise<AppliedScope> {
  const ws = sc.epic.workspace
  const reported = filterScopePaths(ws, asList(job.changed_files))
  const reportedDeleted = filterScopePaths(ws, asList(job.deleted_files))

  const baseline = sc.epic.artifacts.scope_baseline
  if (baseline?.git) {
    const delta = await deltaSinceBaseline(ws, baseline, sc.signal)
    const applied = new Set([...delta.changed, ...delta.deleted])
    const deferred = [...new Set([...reported, ...reportedDeleted])]
      .filter((p) => !applied.has(p))
      .slice(0, 100)
    return {
      changed: delta.changed,
      deleted: delta.deleted,
      deferred,
      source: 'git',
      untouchedBaseline: delta.untouched_baseline.length,
    }
  }

  const synced = Array.isArray(job.synced_files) ? filterScopePaths(ws, asList(job.synced_files)) : null
  const candidate = synced ?? reported
  const changed: string[] = []
  const deleted: string[] = []
  for (const rel of candidate) {
    if (existsSync(join(ws, rel))) changed.push(rel)
    else deleted.push(rel)
  }
  for (const rel of reportedDeleted) {
    if (!existsSync(join(ws, rel)) && !deleted.includes(rel)) deleted.push(rel)
  }
  const applied = new Set([...changed, ...deleted])
  return {
    changed,
    deleted,
    deferred: [...new Set([...reported, ...reportedDeleted])].filter((p) => !applied.has(p)).slice(0, 100),
    source: 'job',
    untouchedBaseline: 0,
  }
}

async function finalizeJob(sc: StepContext, job: CursorJob): Promise<StepResult> {
  const status = String(job.status || '').trim() || 'unknown'
  const detail = String(job.detail || job.assistant_text || '').slice(0, 4000)
  const jobId = String(job.id || '')
  const startedAt = sc.epic.artifacts.implement?.started_at || new Date().toISOString()

  if (status === 'succeeded') {
    const scope = await resolveAppliedScope(sc, job)
    const count = scope.changed.length + scope.deleted.length
    const deferredNote = scope.deferred.length
      ? `；另有 ${scope.deferred.length} 个插件报告但未同步/未落盘的文件未计入交付`
      : ''

    if (count === 0) {
      const reason =
        scope.deferred.length > 0
          ? `写码任务显示成功，但工程目录没有实际变化：${scope.deferred.length} 个变更被写范围过滤或未同步。`
          : '写码任务显示成功，但工程目录没有任何实际文件变化。'
      const impl: ImplementState = {
        job_id: jobId,
        status,
        detail,
        changed_files: [],
        deleted_files: [],
        deferred_files: scope.deferred,
        gate: { class: 'blocked', reason: 'no_applied_changes', summary: '写码无实际落盘变更' },
        started_at: startedAt,
        ended_at: new Date().toISOString(),
      }
      saveImplement(sc, impl)
      return fail(reason, `${detail}${deferredNote}`, {
        evidence: {
          job_id: jobId,
          status,
          scope_source: scope.source,
          deferred_files: scope.deferred,
        },
      })
    }

    const impl: ImplementState = {
      job_id: jobId,
      status,
      detail,
      changed_files: scope.changed,
      deleted_files: scope.deleted,
      deferred_files: scope.deferred,
      gate: {
        class: 'ok',
        reason: 'applied',
        summary: `实际落盘改动 ${scope.changed.length} 个、删除 ${scope.deleted.length} 个`,
      },
      started_at: startedAt,
      ended_at: new Date().toISOString(),
    }
    saveImplement(sc, impl)
    sc.log(
      `实际落盘 ${scope.changed.length} 改 / ${scope.deleted.length} 删（来源：${
        scope.source === 'git' ? 'Git 基线对比' : '插件 synced_files'
      }）`,
    )
    if (scope.changed.length) sc.log(`改动：${scope.changed.slice(0, 12).join('、')}`)
    if (scope.deleted.length) sc.log(`删除：${scope.deleted.slice(0, 12).join('、')}`)
    if (scope.untouchedBaseline) {
      sc.log(`已忽略 ${scope.untouchedBaseline} 个写码前就存在的脏文件（不计入本次交付）`)
    }
    if (scope.deferred.length) sc.log(`未同步/范围外 ${scope.deferred.length} 个：${scope.deferred.slice(0, 12).join('、')}`)
    return pass(impl.gate.summary, deferredNote.replace(/^；/, ''), {
      job_id: jobId,
      changed_files: scope.changed,
      deleted_files: scope.deleted,
      deferred_files: scope.deferred,
    })
  }

  if (status === 'blocked_no_runner') {
    saveImplement(sc, {
      job_id: jobId,
      status,
      detail,
      changed_files: [],
      deleted_files: [],
      gate: { class: 'blocked', reason: status, summary: 'Cursor 无可执行器' },
      started_at: startedAt,
      ended_at: new Date().toISOString(),
    })
    return fail(
      '写码环境阻塞：Cursor 没有可用的执行器',
      detail || '请打开 Cursor 并确认已登录、Agent 可运行，然后重试',
      { fatal: true, evidence: { job_id: jobId, status } },
    )
  }

  if (status === 'cancelled') {
    saveImplement(sc, {
      job_id: jobId,
      status,
      detail,
      changed_files: [],
      deleted_files: [],
      gate: { class: 'blocked', reason: status, summary: '写码已取消' },
      started_at: startedAt,
      ended_at: new Date().toISOString(),
    })
    return fail('写码任务已取消', detail, { evidence: { job_id: jobId, status } })
  }

  const infra = NETWORK_HINT.test(detail) || NETWORK_HINT.test(status)
  saveImplement(sc, {
    job_id: jobId,
    status,
    detail,
    changed_files: [],
    deleted_files: [],
    gate: {
      class: infra ? 'infra' : 'blocked',
      reason: infra ? 'plugin_network' : status,
      summary: infra ? '写码插件网络中断' : `写码未成功：${status}`,
    },
    started_at: startedAt,
    ended_at: new Date().toISOString(),
  })
  return fail(`写码失败：${status}`, detail || '对话写码返回失败，请查看 Job 详情', {
    retryable: infra ? 'infra' : undefined,
    evidence: { job_id: jobId, status, infra },
  })
}

function infraFailure(sc: StepContext, err: unknown): StepResult {
  const detail = String((err as Error)?.message || err)
  const existing = sc.epic.artifacts.implement
  saveImplement(sc, {
    job_id: existing?.job_id || '',
    status: 'failed',
    detail,
    changed_files: [],
    deleted_files: [],
    gate: { class: 'infra', reason: 'plugin_network', summary: '写码插件连接中断' },
    started_at: existing?.started_at || new Date().toISOString(),
    ended_at: new Date().toISOString(),
  })
  return fail('写码插件连接中断，稍后自动重试', detail, {
    retryable: 'infra',
    evidence: { infra: true },
  })
}

export async function runStep5(sc: StepContext): Promise<StepResult> {
  const cfg = sc.cfg
  const base = cfg.cursorChatBase

  if (!sc.epic.artifacts.scope_baseline) {
    sc.epic.artifacts.scope_baseline = await snapshotScope(sc.epic.workspace, sc.signal)
    sc.save()
  }

  let existing = sc.epic.artifacts.implement
  if (existing?.job_id) {
    if (existing.gate?.class === 'infra') {
      // 基建失败只重试，不把上一次失败当成写码成果继续等。
      delete sc.epic.artifacts.implement
      sc.save()
      existing = undefined
    } else {
      sc.log(`继续等待写码 Job ${existing.job_id}`)
      try {
        const job = await waitJob(base, existing.job_id, {
          timeoutMs: cfg.cursorTimeoutMs,
          signal: sc.signal,
        })
        return await finalizeJob(sc, job)
      } catch (err) {
        if (err instanceof CursorHttpError && err.network) return infraFailure(sc, err)
        throw err
      }
    }
  }

  let health = await probe(base, sc.signal)
  if (!health.ok && !health.wrong_service) {
    await new Promise((r) => setTimeout(r, 1200))
    health = await probe(base, sc.signal)
  }
  if (!health.ok) {
    return fail(health.detail, '写码依赖 @zhongruan/dsh-cursor-chat；未装或未启动时第 5 步无法完成', {
      fatal: true,
      evidence: { base, wrong_service: Boolean(health.wrong_service) },
    })
  }
  if (!health.cursor_key_configured) {
    return fail(
      '对话写码插件可达，但未配置 Cursor API Key',
      '在对话写码插件面板里配置 Cursor API Key 后重试本步',
      { fatal: true, evidence: { base } },
    )
  }

  if (existing?.confirm_token) {
    return wait(
      '确认单已生成，等待人工确认开工',
      `调用 zr_pipeline_confirm 确认后继续；工程：${sc.epic.workspace}`,
      { confirm_token: existing.confirm_token },
    )
  }

  const requirement = buildRequirement(sc)
  const images = prepareImages(sc.epic.raw_intake.images || [])
  for (const w of images.warnings) sc.log(`附图：${w}`)

  sc.log(
    `提交写码需求（${requirement.length} 字${images.refs.length ? `，${images.refs.length} 张图` : ''}）到 ${base}`,
  )
  let pending: { confirm_token: string; image_count: number }
  try {
    pending = await createPending(
      base,
      {
        workspace: sc.epic.workspace,
        requirement,
        sessionId: sc.run.session_id,
        images: images.refs,
      },
      sc.signal,
    )
  } catch (err) {
    return infraFailure(sc, err)
  }
  if (images.refs.length && pending.image_count < images.refs.length) {
    sc.log(`附图仅 ${pending.image_count}/${images.refs.length} 张被写码插件接收；其余请检查会话目录权限`)
  }

  const needsConfirm = !cfg.autoRun || sc.run.mode === 'manual'
  if (needsConfirm) {
    saveImplement(sc, {
      job_id: '',
      status: 'pending_confirm',
      detail: '确认单已生成，等待人工确认开工',
      changed_files: [],
      deleted_files: [],
      gate: { class: 'hitl', reason: '等待人工确认', summary: '确认单已生成' },
      confirm_token: pending.confirm_token,
      started_at: new Date().toISOString(),
      ended_at: '',
    })
    sc.log('已生成确认单，等待人工确认（autoRun=false）')
    return wait('确认单已生成，等待人工确认开工', `工程：${sc.epic.workspace}`, {
      confirm_token: pending.confirm_token,
    })
  }

  let nonce: string
  try {
    nonce = await issueNonce(
      base,
      HITL_CONFIRM_ACTION,
      { confirm_token: pending.confirm_token },
      sc.signal,
    )
  } catch (err) {
    const message = String((err as Error)?.message || err)
    if (NETWORK_HINT.test(message)) return infraFailure(sc, err)
    throw err
  }
  let started: { job_id: string; job?: CursorJob }
  try {
    started = await confirmStart(
      base,
      { confirmToken: pending.confirm_token, nonce },
      sc.signal,
    )
  } catch (err) {
    // 响应丢失但 Job 已创建时，从 pending 表找回，避免重复开写码单。
    const recovered = await latestPending(
      base,
      {
        workspace: sc.epic.workspace,
        sessionId: sc.run.session_id,
        requirement,
      },
      sc.signal,
    ).catch(() => null)
    if (recovered?.job_id) {
      sc.log(`确认响应丢失，已找回写码 Job ${recovered.job_id}`)
      started = { job_id: recovered.job_id }
    } else {
      const message = String((err as Error)?.message || err)
      if (NETWORK_HINT.test(message)) return infraFailure(sc, err)
      throw err
    }
  }
  saveImplement(sc, {
    job_id: started.job_id,
    status: started.job?.status || 'running',
    detail: '',
    changed_files: [],
    deleted_files: [],
    gate: { class: 'running', reason: '写码进行中', summary: '写码进行中' },
    started_at: new Date().toISOString(),
    ended_at: '',
  })
  sc.log(`写码已开工：${started.job_id}`)

  let lastStatus = ''
  try {
    const job = await waitJob(base, started.job_id, {
      timeoutMs: cfg.cursorTimeoutMs,
      signal: sc.signal,
      onUpdate: (j) => {
        const s = String(j.status || '')
        if (s && s !== lastStatus) {
          lastStatus = s
          sc.log(`写码状态：${s}`)
        }
      },
    })
    return await finalizeJob(sc, job)
  } catch (err) {
    if (err instanceof CursorHttpError && err.network) {
      // 保留 job_id，下一轮可直接继续等待；仅 infra 失败不占打回轮次。
      return infraFailure(sc, err)
    }
    throw err
  }
}
