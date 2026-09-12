import { createHash } from 'node:crypto'
import { loadConfig } from '../config.js'
import { clampAssistantText, mergeAssistantDelta } from '../assistantText.js'
import { buildPrompt, runCursorLocal, type CursorRunEvent } from '../cursor/runner.js'
import { buildLiveEditSnippet, shouldAttachEditSnippet } from '../editSnippet.js'
import { nudgeAfterSync } from '../viteNudge.js'
import { appendEvent, listJobs, loadJob, patchJob, setStatus } from '../jobs.js'
import { compactParentHandoff } from '../sessionMemory.js'
import {
  isSensitiveRel,
  normalizeRel,
  normalizeWriteScope,
  partitionChangedPaths,
  pathInScope,
} from '../pathScope.js'
import {
  criticalDeferredFiles,
  expandWriteScopeWithCompanions,
  isIdlePendingReview,
  selectCompanionPromotions,
} from '../scopeCompanions.js'
import {
  applyDeletesToTarget,
  diffSnapshots,
  inferSparseBeforeAfter,
  prepareSandboxForJob,
  snapshotSandbox,
  syncChangedToTarget,
  type PrepareResult,
} from '../sandbox.js'
import {
  clampText,
  newTranscriptId,
  relativizeToolPath,
  trimTranscript,
  type TranscriptItem,
} from '../transcript.js'

function scopeOf(jobWriteScope: string[], cfgScope: string[]): string[] {
  const fromJob = normalizeWriteScope(jobWriteScope)
  const base = fromJob.length ? fromJob : normalizeWriteScope(cfgScope)
  return expandWriteScopeWithCompanions(base)
}

export function hashAcceptList(paths: string[]): string {
  const norm = [...paths].map(normalizeRel).filter(Boolean).sort()
  return createHash('sha256').update(JSON.stringify(norm)).digest('hex').slice(0, 16)
}

const running = new Set<string>()

export function isJobRunning(jobId: string): boolean {
  return running.has(jobId)
}

export function runJobBackground(jobId: string): void {
  if (running.has(jobId)) return
  running.add(jobId)
  void executeJob(jobId).finally(() => {
    running.delete(jobId)
  })
}

/** 卡内追问：在 pending_review 上对同一沙箱 resume 再跑一轮 */
export function steerJobBackground(jobId: string, message: string): { ok: boolean; detail: string } {
  if (running.has(jobId)) return { ok: false, detail: '任务正在跑，请稍候' }
  const job = loadJob(jobId)
  if (!job) return { ok: false, detail: '任务不存在' }
  if (job.status !== 'pending_review') {
    return { ok: false, detail: `仅 pending_review 可追问（当前 ${job.status}）` }
  }
  if (!job.sandbox_path) return { ok: false, detail: '缺少沙箱' }
  const msg = String(message || '').trim()
  if (!msg) return { ok: false, detail: '追问内容为空' }
  running.add(jobId)
  void executeSteer(jobId, msg).finally(() => {
    running.delete(jobId)
  })
  return { ok: true, detail: '已接受追问，Cursor 续跑中' }
}

function bindEmit(jobId: string) {
  let thinkingId: string | null = null
  /** 当前 Thinking 气泡只展示 thinking_text 从此偏移起的增量，避免工具后整段复读 */
  let thinkingSegmentStart = 0
  let assistantId: string | null = null
  const toolMap = new Map<string, string>()
  /** 同 job 内各文件最近一次已展示片断时的内容，用于连续 edit 出增量 diff */
  const editBaseline = new Map<string, string>()

  const sealThinkingSegment = () => {
    thinkingId = null
    const t = loadJob(jobId)?.thinking_text || ''
    thinkingSegmentStart = t.length
  }

  const upsertTranscript = (mutator: (items: TranscriptItem[]) => TranscriptItem[]) => {
    const j = loadJob(jobId)
    if (!j) return
    const next = trimTranscript(mutator([...(j.transcript || [])]))
    patchJob(jobId, { transcript: next })
  }

  const emit = (ev: CursorRunEvent) => {
    const j = loadJob(jobId)
    if (!j) return
    const at = new Date().toISOString()

    if (ev.type === 'user' && ev.message) {
      upsertTranscript((items) => [
        ...items,
        {
          id: newTranscriptId('user'),
          kind: 'user',
          at,
          text: clampText(ev.message!, 20_000),
        },
      ])
      appendEvent(loadJob(jobId)!, { type: 'user', message: ev.message, status: j.status })
      return
    }

    if (ev.type === 'thinking') {
      const merged = mergeAssistantDelta(j.thinking_text || '', ev.message || ev.full || '')
      if (!merged.delta && !(ev.full && ev.full !== j.thinking_text)) return
      const full = clampText(ev.full || merged.full)
      patchJob(jobId, { thinking_text: full })
      const segment = full.length > thinkingSegmentStart ? full.slice(thinkingSegmentStart) : merged.delta || full
      upsertTranscript((items) => {
        if (!thinkingId) {
          thinkingId = newTranscriptId('think')
          return [
            ...items,
            {
              id: thinkingId,
              kind: 'thinking',
              at,
              text: segment,
              streaming: true,
              thinking_duration_ms: ev.thinking_duration_ms,
            },
          ]
        }
        return items.map((it) =>
          it.id === thinkingId
            ? {
                ...it,
                text: segment,
                streaming: true,
                thinking_duration_ms: ev.thinking_duration_ms || it.thinking_duration_ms,
              }
            : it,
        )
      })
      appendEvent(loadJob(jobId)!, {
        type: 'thinking',
        message: (merged.delta || '').slice(0, 4000),
        status: loadJob(jobId)!.status,
        thinking_duration_ms: ev.thinking_duration_ms,
      })
      return
    }

    if (ev.type === 'assistant' && ev.message) {
      const merged = mergeAssistantDelta(j.assistant_text || '', ev.message)
      if (!merged.delta) return
      sealThinkingSegment()
      patchJob(jobId, { assistant_text: clampAssistantText(merged.full) })
      upsertTranscript((items) => {
        const sealed = items.map((it) =>
          it.kind === 'thinking' && it.streaming ? { ...it, streaming: false } : it,
        )
        if (!assistantId) {
          assistantId = newTranscriptId('asst')
          return [
            ...sealed,
            {
              id: assistantId,
              kind: 'assistant',
              at,
              text: clampAssistantText(merged.full),
              streaming: true,
            },
          ]
        }
        return sealed.map((it) =>
          it.id === assistantId
            ? { ...it, text: clampAssistantText(merged.full), streaming: true }
            : it,
        )
      })
      const stored =
        merged.delta.length > 8000
          ? merged.delta.slice(0, 8000) + `\n…[+${merged.delta.length - 8000} 字]`
          : merged.delta
      appendEvent(loadJob(jobId)!, {
        type: 'assistant',
        message: stored,
        status: loadJob(jobId)!.status,
      })
      return
    }

    if (ev.type === 'tool_event') {
      sealThinkingSegment()
      assistantId = null
      const displayPath = relativizeToolPath(ev.path, j.sandbox_path || undefined)
      const key = ev.call_id || `${ev.name || 'tool'}:${displayPath || ev.path || ''}`
      const st = String(ev.tool_status || '').toLowerCase()
      let snippet = ev.snippet
      if (
        !snippet &&
        shouldAttachEditSnippet(ev.name) &&
        displayPath &&
        j.sandbox_path &&
        j.workspace
      ) {
        if (st === 'running' || st === 'in_progress') {
          buildLiveEditSnippet({
            sandbox: j.sandbox_path,
            workspace: j.workspace,
            relPath: displayPath,
            baseline: editBaseline,
            phase: 'running',
          })
        } else if (st === 'completed' || st === 'done' || st === 'success' || !st) {
          snippet =
            buildLiveEditSnippet({
              sandbox: j.sandbox_path,
              workspace: j.workspace,
              relPath: displayPath,
              baseline: editBaseline,
              phase: 'completed',
            }) || undefined
        }
      }
      upsertTranscript((items) => {
        const sealed = items.map((it) =>
          it.streaming ? { ...it, streaming: false } : it,
        )
        const existing = toolMap.get(key)
        if (!existing) {
          const id = newTranscriptId('tool')
          toolMap.set(key, id)
          return [
            ...sealed,
            {
              id,
              kind: 'tool',
              at,
              name: ev.name || 'tool',
              path: displayPath,
              tool_status: ev.tool_status || 'running',
              call_id: ev.call_id,
              snippet,
            },
          ]
        }
        return sealed.map((it) =>
          it.id === existing
            ? {
                ...it,
                name: ev.name || it.name,
                path: displayPath || it.path,
                tool_status: ev.tool_status || it.tool_status,
                snippet: snippet || it.snippet,
                at,
              }
            : it,
        )
      })
      appendEvent(loadJob(jobId)!, {
        type: 'tool_event',
        message: ev.message,
        name: ev.name,
        path: displayPath || ev.path,
        tool_status: ev.tool_status,
        call_id: ev.call_id,
        snippet,
        status: loadJob(jobId)!.status,
      })
      return
    }

    if (ev.type === 'status' || ev.type === 'error') {
      if (ev.type === 'status' && ev.message) {
        upsertTranscript((items) => [
          ...items,
          { id: newTranscriptId('st'), kind: 'status', at, text: ev.message },
        ])
      }
      appendEvent(loadJob(jobId)!, {
        type: ev.type === 'error' ? 'error' : 'status',
        message: ev.message,
        status: loadJob(jobId)!.status,
      })
    }
  }

  return emit
}

async function enterReviewFromDiff(
  jobId: string,
  meta: PrepareResult,
  before: ReturnType<typeof snapshotSandbox>,
  cre: { ok: boolean; text: string; thinking: string; mocked?: boolean; error?: string },
): Promise<void> {
  patchJob(jobId, {
    assistant_text: clampAssistantText(cre.text || loadJob(jobId)?.assistant_text || ''),
    thinking_text: clampText(cre.thinking || loadJob(jobId)?.thinking_text || ''),
  })

  // 封住仍 streaming 的片段；同步前补齐缺失的 edit 代码片断（进度卡必须可见）
  {
    const j0 = loadJob(jobId)
    if (j0?.transcript?.length) {
      const baseline = new Map<string, string>()
      const next = j0.transcript.map((it) => {
        const sealed = it.streaming ? { ...it, streaming: false } : it
        if (sealed.kind !== 'tool' || sealed.snippet) return sealed
        if (!shouldAttachEditSnippet(sealed.name) || !sealed.path) return sealed
        if (!j0.sandbox_path || !j0.workspace) return sealed
        const snip = buildLiveEditSnippet({
          sandbox: j0.sandbox_path,
          workspace: j0.workspace,
          relPath: sealed.path,
          baseline,
          phase: 'completed',
        })
        return snip ? { ...sealed, snippet: snip } : sealed
      })
      patchJob(jobId, { transcript: next })
    }
  }

  if (!cre.ok) {
    setStatus(loadJob(jobId)!, 'failed', cre.error || 'Cursor 执行失败')
    appendEvent(loadJob(jobId)!, { type: 'done', status: 'failed', message: cre.error })
    return
  }

  const after = snapshotSandbox(meta.sandbox)
  const diff = diffSnapshots(before, after)
  const job = loadJob(jobId)!
  // 配置连带 + 审后提升：改 routers 时 schemas/models 不得永久 defer
  const writeScope = expandWriteScopeWithCompanions(job.write_scope || [])
  const { inScope: inScope0, deferred: deferred0 } = partitionChangedPaths(diff.changed, writeScope)
  const deletedPart = partitionChangedPaths(diff.deleted, writeScope)
  const promoted = selectCompanionPromotions(inScope0, deferred0, writeScope)
  const promoteSet = new Set(promoted)
  const inScope = [...inScope0, ...promoted.filter((p) => !inScope0.includes(p))]
  const deferred = deferred0.filter((p) => !promoteSet.has(normalizeRel(p)))
  if (promoted.length || writeScope.join('\n') !== (job.write_scope || []).join('\n')) {
    patchJob(jobId, {
      write_scope: normalizeWriteScope([...writeScope, ...promoted]),
    })
  }

  patchJob(jobId, {
    changed_files: diff.changed,
    deleted_files: diff.deleted,
    deferred_files: deferred,
    review_in_scope: inScope,
    review_deleted: deletedPart.inScope,
    review_deferred: [...deferred, ...deletedPart.deferred],
  })

  if (
    !inScope.length &&
    !deletedPart.inScope.length &&
    !deferred.length &&
    !deletedPart.deferred.length
  ) {
    const detail = 'Cursor 未产生可同步文件变更' + (cre.mocked ? '（Mock）' : '')
    setStatus(loadJob(jobId)!, 'succeeded', detail)
    patchJob(jobId, { last_synced_files: [] })
    appendEvent(loadJob(jobId)!, { type: 'done', status: 'succeeded', message: detail })
    return
  }

  const accept = [...inScope, ...deletedPart.inScope]
  const deferredAll = [...deferred, ...deletedPart.deferred]

  // 企业体验：范围内变更自动同步，用户只确认页面效果（可用 CURSOR_CODING_AUTO_APPLY=0 回退人工审）
  const autoRaw = String(process.env.CURSOR_CODING_AUTO_APPLY || '1').trim().toLowerCase()
  const autoApply = !(autoRaw === '0' || autoRaw === 'false' || autoRaw === 'off' || autoRaw === 'no')

  // 自动模式但无可同步项：必须收口为终态，禁止永久「自动同步中」转圈（追问/续改同主流程）
  if (autoApply && !accept.length) {
    const crit = criticalDeferredFiles(deferredAll)
    const detail = crit.length
      ? `写码已结束；契约文件未同步：${crit.join(', ')}。请确认写范围含 schemas/models 后走续改。`
      : `写码已结束；变更均在写范围外未同步（${deferredAll.length}）。`
    setStatus(loadJob(jobId)!, 'succeeded', detail)
    patchJob(jobId, {
      last_synced_files: [],
      review_in_scope: [],
      review_deferred: deferredAll,
    })
    appendEvent(loadJob(jobId)!, { type: 'done', status: 'succeeded', message: detail })
    return
  }

  if (!autoApply) {
    const crit = criticalDeferredFiles(deferredAll)
    const detail =
      `待审：范围内 ${inScope.length} 改 / ${deletedPart.inScope.length} 删；范围外 ${deferredAll.length}` +
      (cre.mocked ? '（Mock）' : '') +
      (accept.length ? '。请勾选后同步。' : '。范围内无可同步项（均在范围外）。') +
      (crit.length
        ? ` ⚠ 契约文件未进范围：${crit.slice(0, 5).join(', ')}——扩大写范围或勾选同步，否则易「请求失败」。`
        : '')
    setStatus(loadJob(jobId)!, 'pending_review', detail)
    appendEvent(loadJob(jobId)!, {
      type: 'review',
      status: 'pending_review',
      message: JSON.stringify({
        in_scope: inScope,
        deleted: deletedPart.inScope,
        deferred: deferredAll,
        promoted_companions: promoted,
      }),
    })
    return
  }

  setStatus(loadJob(jobId)!, 'pending_review', '自动同步中…')
  appendEvent(loadJob(jobId)!, {
    type: 'review',
    status: 'pending_review',
    message: JSON.stringify({
      in_scope: inScope,
      deleted: deletedPart.inScope,
      deferred: deferredAll,
      promoted_companions: promoted,
      auto_apply: true,
    }),
  })

  const applied = applyJobReview({
    job_id: jobId,
    accept,
    expand_scope: promoted,
  })
  if (!applied.ok) {
    setStatus(loadJob(jobId)!, 'pending_review', applied.detail || '自动同步失败，请手动同步')
    return
  }

  let compileNote = ''
  try {
    compileNote = await nudgeAfterSync({
      workspace: loadJob(jobId)!.workspace,
      syncedFiles: applied.synced_files || [],
      deletedFiles: applied.deleted_files || [],
    })
  } catch (e) {
    compileNote = `编译刷新跳过：${String(e).slice(0, 120)}`
  }

  const j = loadJob(jobId)!
  const asst = (j.assistant_text || '').trim()
  const conclusion = asst
    ? asst.length > 1200
      ? asst.slice(0, 1200) + '…'
      : asst
    : ''
  const critLeft = criticalDeferredFiles(deferredAll)
  const detail =
    `${applied.detail || '已自动同步'}；${compileNote}` +
    (promoted.length ? `；已连带同步契约 ${promoted.length} 个` : '') +
    (deferredAll.length ? `；另有 ${deferredAll.length} 个范围外未同步` : '') +
    (critLeft.length
      ? `；⚠ 仍有契约文件未同步：${critLeft.slice(0, 5).join(', ')}`
      : '') +
    '。请自行打开页面确认效果；如需调整请在对话框继续说明。'
  setStatus(j, 'succeeded', detail)
  appendEvent(loadJob(jobId)!, {
    type: 'status',
    status: 'succeeded',
    message: conclusion ? `【本轮结论】\n${conclusion}` : detail,
  })
  appendEvent(loadJob(jobId)!, { type: 'done', status: 'succeeded', message: detail })
}

async function executeJob(jobId: string): Promise<void> {
  let job = loadJob(jobId)
  if (!job) return
  const cfg = loadConfig()
  const emit = bindEmit(jobId)

  try {
    if (job.cancelled) {
      setStatus(job, 'cancelled', '用户取消')
      return
    }

    setStatus(job, 'running', '准备沙箱…')
    const writeScope = scopeOf(job.write_scope, cfg.writeScope)
    patchJob(jobId, { write_scope: writeScope })

    const parent = job.parent_job_id ? loadJob(job.parent_job_id) : null
    let parentSummary = ''
    let resumeAgentId: string | null = null
    if (parent) {
      parentSummary = compactParentHandoff(parent)
      resumeAgentId = parent.agent_id || null
      patchJob(jobId, { continue_count: (parent.continue_count || 0) + 1 })
    }

    const meta = prepareSandboxForJob({
      dataRoot: cfg.dataRoot,
      jobId,
      targetWorkspace: job.workspace,
      writeScope,
      parentSandbox: parent?.sandbox_path || null,
      onProgress: (msg: string) => {
        const j = loadJob(jobId)
        if (j) setStatus(j, 'running', msg)
      },
    })
    patchJob(jobId, { sandbox_path: meta.sandbox })
    {
      let extra = ''
      if (meta.mode === 'reuse') {
        extra = ` · 父克隆 ${meta.parent_files ?? '?'} · 刷新 ${meta.refreshed_files ?? '?'}`
      } else if (meta.mode === 'sparse' && (meta.context_files || 0) > 0) {
        extra = ` · 写范围 ${meta.scope_files ?? '?'} + 只读上下文 ${meta.context_files}`
      }
      emit({ type: 'status', message: `沙箱就绪（${meta.mode} · ${meta.copied_files} 文件${extra}）` })
    }

    job = loadJob(jobId)!
    if (job.cancelled) {
      setStatus(job, 'cancelled', '用户取消')
      return
    }

    const before = snapshotSandbox(meta.sandbox)
    const prompt = buildPrompt({
      requirement: job.requirement,
      workspaceHint: job.workspace,
      parentSummary: parentSummary || undefined,
    })

    setStatus(job, 'running', 'Cursor 正在改码…')
    const cre = await runCursorLocal({
      sandbox: meta.sandbox,
      apiKey: cfg.cursorApiKey,
      prompt,
      resumeAgentId,
      model: cfg.model,
      userPreface: job.requirement,
      onEvent: emit,
      isCancel: () => Boolean(loadJob(jobId)?.cancelled),
    })

    patchJob(jobId, {
      agent_id: cre.agent_id || null,
      run_id: cre.run_id || null,
    })

    job = loadJob(jobId)!
    if (job.cancelled || (!cre.ok && cre.error === '已取消')) {
      setStatus(loadJob(jobId)!, 'cancelled', '用户取消')
      return
    }

    await enterReviewFromDiff(jobId, meta, before, cre)
  } catch (err) {
    const msg = String(err)
    const j = loadJob(jobId)
    if (j) {
      setStatus(j, 'failed', msg.slice(0, 500))
      appendEvent(loadJob(jobId)!, { type: 'done', status: 'failed', message: msg.slice(0, 300) })
    }
  }
}

async function executeSteer(jobId: string, message: string): Promise<void> {
  const cfg = loadConfig()
  const emit = bindEmit(jobId)
  let job = loadJob(jobId)
  if (!job || !job.sandbox_path) return

  try {
    setStatus(job, 'running', '追问续跑 Cursor…')
    const before = snapshotSandbox(job.sandbox_path)
    const prompt = buildPrompt({
      requirement: message,
      workspaceHint: job.workspace,
      parentSummary: (job.last_synced_files || job.review_in_scope || []).slice(0, 40).join('\n'),
    })
    const cre = await runCursorLocal({
      sandbox: job.sandbox_path,
      apiKey: cfg.cursorApiKey,
      prompt,
      resumeAgentId: job.agent_id,
      model: cfg.model,
      userPreface: message,
      onEvent: emit,
      isCancel: () => Boolean(loadJob(jobId)?.cancelled),
    })
    patchJob(jobId, {
      agent_id: cre.agent_id || job.agent_id,
      run_id: cre.run_id || job.run_id,
      continue_count: (job.continue_count || 0) + 1,
      requirement: `${job.requirement}\n\n【追问】${message}`,
    })
    job = loadJob(jobId)!
    if (job.cancelled || (!cre.ok && cre.error === '已取消')) {
      setStatus(loadJob(jobId)!, 'cancelled', '用户取消')
      return
    }
    await enterReviewFromDiff(
      jobId,
      { sandbox: job.sandbox_path!, mode: 'sparse', copied_files: 0, total_bytes: 0 },
      before,
      cre,
    )
  } catch (err) {
    const msg = String(err).slice(0, 500)
    setStatus(loadJob(jobId)!, 'failed', msg)
    appendEvent(loadJob(jobId)!, { type: 'done', status: 'failed', message: msg })
  }
}

export type ApplyResult =
  | { ok: true; job_id: string; synced_files: string[]; deleted_files: string[]; detail: string }
  | { ok: false; detail: string; code?: string }

/**
 * 审后同步。expand_scope 经前缀归一化 + 敏感路径拒绝后并入本次可选范围。
 */
export function applyJobReview(opts: {
  job_id: string
  accept: string[]
  reject?: string[]
  expand_scope?: string[]
}): ApplyResult {
  const job = loadJob(opts.job_id)
  if (!job) return { ok: false, detail: '任务不存在', code: 'job_missing' }
  if (job.status !== 'pending_review') {
    return { ok: false, detail: `任务状态不是 pending_review（当前 ${job.status}）`, code: 'bad_status' }
  }
  if (!job.sandbox_path) {
    return { ok: false, detail: '缺少 sandbox_path', code: 'no_sandbox' }
  }

  const expand = normalizeWriteScope(opts.expand_scope || [])
  for (const e of expand) {
    const rel = e.replace(/\/$/, '')
    if (isSensitiveRel(rel)) {
      return { ok: false, detail: `expand_scope 含敏感路径，已拒绝：${e}`, code: 'sensitive' }
    }
  }
  const effectiveScope = normalizeWriteScope([...(job.write_scope || []), ...expand])

  const acceptRaw = (opts.accept || []).map(normalizeRel).filter(Boolean)
  const rejectSet = new Set((opts.reject || []).map(normalizeRel).filter(Boolean))
  const accept = [...new Set(acceptRaw)].filter((p) => !rejectSet.has(p))

  const changedAllowed = new Set([
    ...(job.review_in_scope || job.changed_files || []),
    ...(job.review_deferred || job.deferred_files || []),
  ])
  const deletedAllowed = new Set([...(job.review_deleted || [])])
  for (const d of job.deleted_files || []) {
    if (pathInScope(d, effectiveScope)) deletedAllowed.add(normalizeRel(d))
  }
  for (const c of job.changed_files || []) {
    if (pathInScope(c, effectiveScope)) changedAllowed.add(normalizeRel(c))
  }

  const toSync: string[] = []
  const toDelete: string[] = []
  for (const p of accept) {
    if (isSensitiveRel(p)) {
      return { ok: false, detail: `拒绝同步敏感路径：${p}`, code: 'sensitive' }
    }
    if (!pathInScope(p, effectiveScope) && effectiveScope.length) {
      return {
        ok: false,
        detail: `路径不在允许范围（可 expand_scope）：${p}`,
        code: 'out_of_scope',
      }
    }
    if (deletedAllowed.has(p) || (job.deleted_files || []).map(normalizeRel).includes(p)) {
      toDelete.push(p)
      continue
    }
    if (!changedAllowed.has(p) && !(job.changed_files || []).map(normalizeRel).includes(p)) {
      return { ok: false, detail: `不在本次变更列表：${p}`, code: 'not_in_diff' }
    }
    toSync.push(p)
  }

  if (!toSync.length && !toDelete.length) {
    setStatus(job, 'succeeded', '未勾选任何文件，未同步')
    patchJob(job.id, { synced_files: [], last_synced_files: [] })
    appendEvent(loadJob(job.id)!, {
      type: 'done',
      status: 'succeeded',
      message: '未勾选同步',
    })
    return { ok: true, job_id: job.id, synced_files: [], deleted_files: [], detail: '未勾选任何文件' }
  }

  setStatus(loadJob(job.id)!, 'syncing', '正在按勾选同步…')
  try {
    let synced: string[] = []
    if (toSync.length) {
      synced = syncChangedToTarget(job.sandbox_path, job.workspace, toSync)
    }
    const deleted = toDelete.length ? applyDeletesToTarget(job.workspace, toDelete) : []
    const detail = `已同步 ${synced.length} 个文件` + (deleted.length ? `，删除 ${deleted.length}` : '')
    patchJob(job.id, {
      write_scope: effectiveScope,
      synced_files: synced,
      last_synced_files: synced,
      deferred_files: (job.changed_files || []).filter(
        (p) => !synced.includes(normalizeRel(p)) && !toDelete.includes(normalizeRel(p)),
      ),
    })
    setStatus(loadJob(job.id)!, 'succeeded', detail)
    appendEvent(loadJob(job.id)!, { type: 'done', status: 'succeeded', message: detail })
    return { ok: true, job_id: job.id, synced_files: synced, deleted_files: deleted, detail }
  } catch (err) {
    const msg = String(err).slice(0, 500)
    setStatus(loadJob(job.id)!, 'failed', msg)
    appendEvent(loadJob(job.id)!, { type: 'done', status: 'failed', message: msg })
    return { ok: false, detail: msg, code: 'sync_error' }
  }
}

/**
 * 治愈卡死的 pending_review（FINISHED 但 UI 永久「自动同步中」）。
 * 追问/续改与首轮同一套状态机，禁止另搞加载态。
 */
export function healStalePendingReview(jobId: string): ReturnType<typeof loadJob> {
  const job = loadJob(jobId)
  if (!job || job.status !== 'pending_review') return job
  const inScope = job.review_in_scope || []
  const deferred = job.review_deferred || job.deferred_files || []
  if (!isIdlePendingReview(job.detail || '', inScope.length)) return job
  // 人工勾选待审不治愈
  if (inScope.length > 0 && /请勾选后同步/.test(job.detail || '')) return job

  // 尝试把扩展写范围内的契约文件补同步
  const expanded = expandWriteScopeWithCompanions(job.write_scope || [])
  const promoted = selectCompanionPromotions(inScope, deferred, job.write_scope || [])
  const toSync = [
    ...new Set([
      ...promoted,
      ...deferred.filter((p) => pathInScope(p, expanded) && !/\.(db|sqlite3?)$/i.test(p)),
    ]),
  ]
  if (toSync.length && job.sandbox_path) {
    try {
      setStatus(job, 'pending_review', '自动同步中…')
      const applied = applyJobReview({
        job_id: jobId,
        accept: toSync,
        expand_scope: toSync,
      })
      if (applied.ok) return loadJob(jobId)
    } catch {
      /* fall through to close out */
    }
  }

  const crit = criticalDeferredFiles(deferred)
  const detail = crit.length
    ? `写码已结束；契约文件未同步：${crit.join(', ')}。请确认写范围后走续改。`
    : inScope.length
      ? `写码已结束；请在进度卡勾选后同步（或已超时收口）。`
      : `写码已结束；变更均在写范围外未同步（${deferred.length}）。`
  setStatus(loadJob(jobId)!, 'succeeded', detail)
  appendEvent(loadJob(jobId)!, { type: 'done', status: 'succeeded', message: detail })
  return loadJob(jobId)
}

/**
 * 宿主重启后：内存里的 Cursor run 已没了，磁盘上却仍是 running。
 * 按沙箱已改文件收口并自动同步，避免进度卡永远「正在等待 Vite」。
 */
export async function recoverOrphanRunningJobs(): Promise<number> {
  let n = 0
  for (const job of listJobs(40)) {
    if (job.status !== 'running' && job.status !== 'queued') continue
    if (isJobRunning(job.id)) continue
    if (!job.sandbox_path || !job.workspace) {
      setStatus(job, 'failed', '写码进程中断，沙箱不完整')
      appendEvent(loadJob(job.id)!, {
        type: 'done',
        status: 'failed',
        message: '写码进程中断',
      })
      n += 1
      continue
    }
    try {
      running.add(job.id)
      setStatus(loadJob(job.id)!, 'running', '写码中断后按已改文件收口…')
      const { before } = inferSparseBeforeAfter(
        job.workspace,
        job.sandbox_path,
        job.write_scope || [],
      )
      await enterReviewFromDiff(
        job.id,
        {
          sandbox: job.sandbox_path,
          mode: 'sparse',
          copied_files: 0,
          total_bytes: 0,
        },
        before,
        {
          ok: true,
          text: job.assistant_text || '',
          thinking: (job.thinking_text || '') + '\n（空等 Vite / 进程中断，已按沙箱改动收口）',
        },
      )
      n += 1
    } catch (err) {
      const j = loadJob(job.id)
      if (j && (j.status === 'running' || j.status === 'queued')) {
        setStatus(j, 'failed', `收口失败：${String(err).slice(0, 240)}`)
      }
    } finally {
      running.delete(job.id)
    }
  }
  return n
}
