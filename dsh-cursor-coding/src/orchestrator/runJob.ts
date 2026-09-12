/**
 * Job 编排：沙箱 → Cursor 对话流 → pending_review；apply 后同步；支持卡内追问 steer。
 */
import { createHash } from 'node:crypto'
import { loadConfig } from '../config.js'
import { clampAssistantText, mergeAssistantDelta } from '../assistantText.js'
import { buildPrompt, runCursorLocal, type CursorRunEvent } from '../cursor/runner.js'
import { nudgeAfterSync } from '../viteNudge.js'
import { appendEvent, loadJob, patchJob, setStatus } from '../jobs.js'
import {
  isSensitiveRel,
  normalizeRel,
  normalizeWriteScope,
  partitionChangedPaths,
  pathInScope,
} from '../pathScope.js'
import {
  applyDeletesToTarget,
  diffSnapshots,
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
  if (fromJob.length) return fromJob
  return normalizeWriteScope(cfgScope)
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
        // 封上一条 thinking streaming
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

  // 封住仍 streaming 的片段
  const j0 = loadJob(jobId)
  if (j0?.transcript?.length) {
    patchJob(jobId, {
      transcript: j0.transcript.map((it) => (it.streaming ? { ...it, streaming: false } : it)),
    })
  }

  if (!cre.ok) {
    setStatus(loadJob(jobId)!, 'failed', cre.error || 'Cursor 执行失败')
    appendEvent(loadJob(jobId)!, { type: 'done', status: 'failed', message: cre.error })
    return
  }

  const after = snapshotSandbox(meta.sandbox)
  const diff = diffSnapshots(before, after)
  const job = loadJob(jobId)!
  const writeScope = job.write_scope || []
  const { inScope, deferred } = partitionChangedPaths(diff.changed, writeScope)
  const deletedPart = partitionChangedPaths(diff.deleted, writeScope)

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

  if (!autoApply || !accept.length) {
    const detail =
      `待审：范围内 ${inScope.length} 改 / ${deletedPart.inScope.length} 删；范围外 ${deferredAll.length}` +
      (cre.mocked ? '（Mock）' : '') +
      (accept.length ? '。请勾选后同步。' : '。范围内无可同步项（均在范围外）。')
    setStatus(loadJob(jobId)!, 'pending_review', detail)
    appendEvent(loadJob(jobId)!, {
      type: 'review',
      status: 'pending_review',
      message: JSON.stringify({
        in_scope: inScope,
        deleted: deletedPart.inScope,
        deferred: deferredAll,
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
      auto_apply: true,
    }),
  })

  const applied = applyJobReview({ job_id: jobId, accept })
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
  const detail =
    `${applied.detail || '已自动同步'}；${compileNote}` +
    (deferredAll.length ? `；另有 ${deferredAll.length} 个范围外未同步` : '') +
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
      const files = parent.last_synced_files?.length
        ? parent.last_synced_files
        : parent.synced_files || []
      parentSummary =
        files
          .slice(0, 40)
          .map((f: string) => `- ${f}`)
          .join('\n') ||
        parent.detail ||
        ''
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
