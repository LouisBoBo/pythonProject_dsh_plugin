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
  buildImpactHintForChangedFiles,
} from '../scopeCompanions.js'
import {
  detectProject,
  describeProject,
  type ProjectStack,
} from '../detect.js'
import {
  verifyInSandbox,
  buildVerifyHints,
  shouldSkipVerify,
  type VerifyResult,
} from '../verify.js'
import { runQualityGate, type QualityReport } from '../qualityGate.js'
import {
  loadPreferences,
  rememberModel,
  rememberProjectStack,
  formatPrefsForPrompt,
  recordFailures,
} from '../preferences.js'
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
  normalizeStatusDisplay,
  refineAssistantSegmentText,
  relativizeToolPath,
  stripFinalPlanSection,
  trimTranscript,
  type TranscriptItem,
} from '../transcript.js'
import {
  auditDeleteTarget,
  deliveryIndicatesAlreadyDone,
} from '../deletePreflight.js'
import {
  buildEngineDeleteDelivery,
  parseDeletePlanFromText,
  reconcileDeleteArtifacts,
  validateDeletePlan,
} from '../deleteEnforce.js'
import {
  isDeleteIntent,
} from '../deleteIntent.js'
import {
  verifyDeleteOnTarget,
} from '../deleteVerify.js'

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
      // transcript 只存过程增量：相对上一段去复读前缀，并去掉终稿「说明方案」
      upsertTranscript((items) => {
        const sealed = items.map((it) =>
          it.kind === 'thinking' && it.streaming ? { ...it, streaming: false } : it,
        )
        if (!assistantId) {
          const prevAsst = sealed
            .filter((it) => it.kind === 'assistant')
            .map((it) => String(it.text || ''))
          const refined = refineAssistantSegmentText(merged.delta, prevAsst)
          if (!refined) return sealed
          assistantId = newTranscriptId('asst')
          return [
            ...sealed,
            {
              id: assistantId,
              kind: 'assistant',
              at,
              text: refined,
              streaming: true,
            },
          ]
        }
        const prevAsst = sealed
          .filter((it) => it.kind === 'assistant' && it.id !== assistantId)
          .map((it) => String(it.text || ''))
        return sealed.map((it) => {
          if (it.id !== assistantId) return it
          // 同段续写：追加增量后剥终稿（含粘连标题 / 结论体）；空则清掉，避免结论留在进度卡
          const next = stripFinalPlanSection(String(it.text || '') + merged.delta)
          if (!next) return { ...it, text: '', streaming: false }
          return { ...it, text: next, streaming: true }
        })
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
      const key =
        ev.call_id ||
        `${ev.name || 'tool'}:${displayPath || ev.path || ev.pattern || ev.command || ''}`
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
              pattern: ev.pattern,
              command: ev.command,
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
                pattern: ev.pattern || it.pattern,
                command: ev.command || it.command,
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
        pattern: ev.pattern,
        command: ev.command,
        tool_status: ev.tool_status,
        call_id: ev.call_id,
        snippet,
        status: loadJob(jobId)!.status,
      })
      return
    }

    if (ev.type === 'status' || ev.type === 'error') {
      if (ev.type === 'status' && ev.message) {
        const shown = normalizeStatusDisplay(ev.message)
        upsertTranscript((items) => [
          ...items,
          { id: newTranscriptId('st'), kind: 'status', at, text: shown || ev.message },
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

  // 企业体验：范围内变更自动同步，用户只确认页面效果（可用 CURSOR_CHAT_AUTO_APPLY=0 回退人工审）
  const autoRaw = String(process.env.CURSOR_CHAT_AUTO_APPLY || '1').trim().toLowerCase()
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
      review_gate: null,
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
    patchJob(jobId, { review_gate: 'await_user' })
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

  patchJob(jobId, { review_gate: 'auto_applying' })
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
    patchJob(jobId, { review_gate: 'auto_failed' })
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
  patchJob(jobId, { review_gate: null })
  setStatus(loadJob(jobId)!, 'succeeded', detail)
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

  // 跨 session 偏好：加载 + 记录 model 选择（如果用户改了）
  const prefs = loadPreferences(cfg.dataRoot)
  rememberModel(cfg.dataRoot, cfg.model)
  // 简易 cache：workspace → ProjectStack，detectProject 只跑一次
  let _psCache: ProjectStack | null = null
  const psForJob = (_ws: string) => {
    if (_psCache) return _psCache
    _psCache = detectProject(_ws)
    return _psCache
  }

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

    // ========== 删除分支 ①：预检跳过 Cursor ==========
    // 删除 intent → 本机工程读盘核验是否已达成。skip_cursor=True → 零成本成功返回。
    const deletePreflight = isDeleteIntent(job.requirement)
      ? auditDeleteTarget(job.workspace, job.requirement)
      : null
    if (deletePreflight?.skip_cursor) {
      const delivery = buildEngineDeleteDelivery(
        job.requirement,
        { forced_deletes: [], patched: [], detail: '' },
        { mode: 'already_done' },
      )
      setStatus(job, 'succeeded', delivery)
      patchJob(jobId, {
        assistant_text: delivery,
        synced_files: [] as string[],
        deleted_files: [] as string[],
        review_deleted: [] as string[],
        review_deferred: [] as string[],
      })
      appendEvent(loadJob(jobId)!, { type: 'done', status: 'succeeded', message: delivery })
      emit({ type: 'status', message: `预检发现「${deletePreflight.feature}」已清除，跳过 Cursor` })
      return
    }
    if (deletePreflight) {
      emit({ type: 'status', message: `删除预检发现残留 ${deletePreflight.checks.length} 处，将调用 Cursor 定位清单` })
    }

    const before = snapshotSandbox(meta.sandbox)
    const { copyImagesIntoSandbox, toSdkImages } = await import('../images.js')
    const imageRels = copyImagesIntoSandbox(job.images, meta.sandbox)
    const sdkImages = toSdkImages(job.images)
    if (sdkImages.length) {
      emit({ type: 'status', message: `已附带 ${sdkImages.length} 张图给 Cursor（多模态）` })
    }
    // 记录本次 workspace 的 stack + cmd 偏好（只追加不覆盖）
    const ps = psForJob(job.workspace)
    rememberProjectStack(cfg.dataRoot, job.workspace, ps)
    const prefsHint = formatPrefsForPrompt(prefs, job.workspace)

    const prompt = buildPrompt({
      requirement: job.requirement,
      workspaceHint: job.workspace,
      parentSummary: parentSummary || undefined,
      imageSandboxRels: imageRels,
      prefsHint,
    })

    setStatus(job, 'running', 'Cursor 正在改码…')
    const cre = await runCursorLocal({
      sandbox: meta.sandbox,
      apiKey: cfg.cursorApiKey,
      prompt,
      resumeAgentId,
      model: cfg.model,
      userPreface: job.requirement,
      images: sdkImages,
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

    // ========== 删除分支 ②：Cursor 结束 → 解析清单 → 引擎强制执行 ==========
    // 只有删除 intent 才走。普通写码任务不受影响。
    if (deletePreflight && cre.ok) {
      // Cursor 终稿表明"目标已达成/无需再改" → 验尸确认后 already_done 收工
      if (deliveryIndicatesAlreadyDone(cre.text || '')) {
        const verify = verifyDeleteOnTarget(job.workspace, job.requirement)
        if (verify.ok) {
          const delivery = buildEngineDeleteDelivery(
            job.requirement,
            { forced_deletes: [], patched: [], detail: '' },
            { mode: 'already_done' },
          )
          await enterReviewFromDiff(jobId, meta, before, { ...cre, text: delivery })
          return
        }
      }

      // 解析 Cursor 删除清单 + 校验 + 引擎强制执行
      const cursorPlan = parseDeletePlanFromText(cre.text || '')
      const { approved, rejected } = validateDeletePlan(
        cursorPlan, job.requirement, job.workspace,
        { write_scope: job.write_scope },
      )
      if (rejected.length) emit({
        type: 'status',
        message: `删除清单：批准 ${approved.length} 个，拒绝 ${rejected.length} 个`,
      })

      const rec = reconcileDeleteArtifacts({
        sandbox: meta.sandbox,
        target: job.workspace,
        requirement: job.requirement,
        assistant_text: cre.text || '',
        explicit_planned: approved.length ? approved : undefined,
        onStatus: (msg: string) => emit({ type: 'status', message: msg }),
      })

      // 引擎已删 sandbox 文件 → diffSnapshots 会自动记为 deleted
      if (rec.forced_deletes.length || rec.patched.length) {
        emit({
          type: 'status',
          message: `引擎删除 ${rec.forced_deletes.length} 个文件 + 修补 ${rec.patched.length} 个接线文件`,
        })
      }
      // 用引擎 delivery 替换 Cursor 假删文案
      if (rec.forced_deletes.length || rec.patched.length || deletePreflight.checks.length === 0) {
        const finalMode: 'engine_first' | 'cursor_plan' = cursorPlan.length > 0 ? 'cursor_plan' : 'engine_first'
        const delivery = buildEngineDeleteDelivery(job.requirement, rec, { mode: finalMode })
        cre.text = delivery
      }
    }

    // ========== 质量链（非删除任务才跑） ==========
    if (!deletePreflight && cre.ok) {
      // 先算一次 diff，拿到 changed 列表供质量链使用
      const afterSandbox = snapshotSandbox(meta.sandbox)
      let diff = diffSnapshots(before, afterSandbox)
      let changed = diff.changed
      const deleted = diff.deleted
      const ps = psForJob(job.workspace)
      const mockMode = process.env.CURSOR_CHAT_MOCK === '1'

      // ① 质量门控（静态扫描，10ms 级）
      if (!mockMode && !process.env.CURSOR_CHAT_SKIP_QUALITY) {
        emit({ type: 'status', message: '质量门控：扫描 diff…' })
        const qr = runQualityGate(meta.sandbox, changed, deleted)
        patchJob(jobId, { quality_report: qr })
        job = loadJob(jobId)!
        emit({
          type: 'status',
          message: `质量门控：${qr.status.toUpperCase()} 分=${qr.score} 问题=${qr.issues.length}`,
        })
      }

      // ② 编译验证闭环 + 失败续修一轮
      let verifyOk = false
      if (!mockMode && !shouldSkipVerify(ps) && cre.agent_id) {
        if (!process.env.CURSOR_CHAT_SKIP_VERIFY) {
          emit({ type: 'status', message: `编译验证：${describeProject(ps)}` })
          let vr = await verifyInSandbox(meta.sandbox, ps)
          verifyOk = vr.ok
          // 记录失败到偏好，下次自动规避
          if (!vr.ok) recordFailures(cfg.dataRoot, job.workspace, vr.parsedErrors, 'verify')
          // 续修一轮：失败则把结构化错误喂回 Cursor 续修
          if (!vr.ok && vr.firstFailureSummary && changed.length > 0) {
            emit({ type: 'status', message: '编译失败，Cursor 续修一轮…' })
            const impactHint = buildImpactHintForChangedFiles(changed)
            const retryPrompt =
              `编译验证失败，请修复后重新输出完整代码。\n\n` +
              buildVerifyHints(vr) +
              impactHint +
              `\n【原始诉求】\n${job.requirement}`
            const retryCre = await runCursorLocal({
              sandbox: meta.sandbox,
              apiKey: cfg.cursorApiKey,
              prompt: retryPrompt,
              resumeAgentId: cre.agent_id,
              model: cfg.model,
              userPreface: job.requirement,
              onEvent: emit,
              isCancel: () => Boolean(loadJob(jobId)?.cancelled),
            })
            if (retryCre.ok) {
              vr = await verifyInSandbox(meta.sandbox, ps)
              verifyOk = vr.ok
              if (!vr.ok) recordFailures(cfg.dataRoot, job.workspace, vr.parsedErrors, 'verify')
              cre.text = retryCre.text || cre.text
              emit({ type: 'status', message: vr.ok ? '续修后验证通过 ✅' : '续修后仍未通过，保持原状 ⚠️' })
            }
          } else if (vr.ok) {
            emit({ type: 'status', message: '编译验证通过 ✅' })
          }
          // 更新 diff（续修后 sandbox 可能变了）
          const afterRetry = snapshotSandbox(meta.sandbox)
          diff = diffSnapshots(before, afterRetry)
          changed = diff.changed
        }
      }

      // ③ 自动格式化（prettier/ruff/gofmt）
      if (!mockMode && !process.env.CURSOR_CHAT_SKIP_FMT) {
        try {
          const fmtCmd = ps.fmtCmds[0]
          if (fmtCmd) {
            emit({ type: 'status', message: `自动格式化：${fmtCmd}` })
            const sc = require('node:child_process').spawnSync(fmtCmd, [], {
              cwd: meta.sandbox, timeout: 60000,
            })
            if (sc.status === 0) emit({ type: 'status', message: '格式化完成 ✅' })
          }
        } catch { /* 格式化失败不致命 */ }
      }

      // ④ 自动写测试（仅验证通过 + ≤5 文件 + 有 test 命令）
      if (!mockMode && !process.env.CURSOR_CHAT_SKIP_AUTO_TEST) {
        if (verifyOk && ps.testCmds.length > 0 && changed.length > 0 && changed.length <= 5 && cre.agent_id) {
          emit({ type: 'status', message: '自动写测试：让 Cursor 补 2-3 个用例…' })
          const testPrompt =
            `请为本次改动补 2-3 个单元测试用例（放在仓库已有 test 目录，沿用现有测试框架风格）。\n` +
            `写完后请自己跑一次 ${ps.testCmds[0]} 确认通过。\n\n` +
            `【本次改动文件】\n${changed.join('\n')}\n\n` +
            `【原始诉求】\n${job.requirement}`
          const testCre = await runCursorLocal({
            sandbox: meta.sandbox,
            apiKey: cfg.cursorApiKey,
            prompt: testPrompt,
            resumeAgentId: cre.agent_id,
            model: cfg.model,
            userPreface: job.requirement,
            onEvent: emit,
            isCancel: () => Boolean(loadJob(jobId)?.cancelled),
          })
          if (testCre.ok) {
            emit({ type: 'status', message: '自动写测试完成 ✅' })
          }
        }
      }

      // ⑤ 自我评估（最多 2 轮，验证通过后让 Cursor 自检）
      if (!mockMode && !process.env.CURSOR_CHAT_SKIP_SELF_EVAL) {
        if (verifyOk && ps.testCmds.length > 0 && changed.length > 0 && changed.length <= 10 && cre.agent_id) {
          emit({ type: 'status', message: '自我评估：Cursor 自检边界/异常/测试…' })
          const impactHint = buildImpactHintForChangedFiles(changed)
          const evalPrompt =
            `请自检本次改动：\n` +
            `1. 有没有遗漏边界条件？（空值/错误分支/异常处理）\n` +
            `2. 有没有可以补的测试用例？\n` +
            `3. 有没有明显的代码坏味道？\n` +
            `如发现问题，直接修复；如无问题，输出"自检通过"。\n\n` +
            impactHint +
            `\n【本次改动文件】\n${changed.join('\n')}\n\n` +
            `【原始诉求】\n${job.requirement}`
          for (let round = 0; round < 2; round++) {
            const evalCre = await runCursorLocal({
              sandbox: meta.sandbox,
              apiKey: cfg.cursorApiKey,
              prompt: evalPrompt,
              resumeAgentId: cre.agent_id,
              model: cfg.model,
              userPreface: job.requirement,
              onEvent: emit,
              isCancel: () => Boolean(loadJob(jobId)?.cancelled),
            })
            if (!evalCre.ok) break
            // 跑一次验证确认没引入问题
            const vr = await verifyInSandbox(meta.sandbox, ps)
            if (!vr.ok) {
              emit({ type: 'status', message: `自评后验证失败，放弃本轮（${round + 1}/2）` })
              break
            }
            emit({ type: 'status', message: `自评第 ${round + 1} 轮通过 ✅` })
          }
        }
      }

      // ⑥ 质量报告追加到 assistant_text
      const finalJob = loadJob(jobId)!
      const finalQr = finalJob.quality_report
      if (finalQr) {
        const oldText = cre.text || ''
        const issueCount = finalQr.issues.length
        const qBlock =
          `\n\n---\n\n**质量门控**：${finalQr.status.toUpperCase()}（${finalQr.score}/100）\n` +
          `改动 ${finalQr.changedFileCount} 文件 / ${finalQr.totalLineCount} 行\n` +
          (issueCount > 0
            ? `\n**问题清单（${issueCount} 项）**：\n${finalQr.issues.slice(0, 10).map(
                (i) => `- ${i.severity === 'red' ? '🔴' : '🟡'} ${i.file}:${i.line} ${i.kind} — ${i.detail}`,
              ).join('\n')}\n`
            : '\n**无问题** ✅\n')
        cre.text = oldText + qBlock
      }
    }

    // ========== 质量 red 阻塞自动同步 ==========
    const preSync = loadJob(jobId)!
    const qr = preSync.quality_report
    if (qr?.status === 'red') {
      emit({
        type: 'status',
        message: `🚨 质量红色预警，已阻止自动同步，请人工审完再决定是否 apply`,
      })
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
    const steerPrefs = loadPreferences(cfg.dataRoot)
    const prompt = buildPrompt({
      requirement: message,
      workspaceHint: job.workspace,
      parentSummary: (job.last_synced_files || job.review_in_scope || []).slice(0, 40).join('\n'),
      prefsHint: formatPrefsForPrompt(steerPrefs, job.workspace),
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
  if (!isIdlePendingReview(job.detail || '', inScope.length, job.review_gate)) return job
  // 人工勾选待审 / 自动同步中或失败待手工：禁止改写成 succeeded
  if (job.review_gate === 'await_user' && inScope.length > 0) return job
  if (job.review_gate === 'auto_applying' || job.review_gate === 'auto_failed') return job

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
