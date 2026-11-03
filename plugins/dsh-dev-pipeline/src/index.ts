/**
 * @zhongruan/dsh-dev-pipeline — 需求到上线十步一体化流水线（独立 DSH 插件）。
 * 写码复用 @zhongruan/dsh-cursor-chat（:18791）；PRD/计划/验证/复核/提交/PR/部署在本插件内完成。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadConfig } from './config.js'
import { confirmStart, issueNonce, HITL_CONFIRM_ACTION } from './cursorChat.js'
import {
  cancelRun,
  createRun,
  isRunActive,
  startRunInBackground,
  stopRun,
} from './runner.js'
import { prepareImages } from './images.js'
import { snapshotScope } from './scope.js'
import {
  appendEvent,
  findLatestRunForSession,
  listRuns,
  loadEpic,
  loadRun,
  recoverOrphanedRuns,
  saveEpic,
  saveRun,
} from './store.js'
import type { Epic, PipelineConfig, PipelineCtx, Run, StepId } from './types.js'
import { STEP_IDS, STEP_SKILLS, STEP_TITLES } from './types.js'
import { normalizeWorkspace } from './workspace.js'

export const name = 'dev-pipeline'
export const inject = ['tools', 'llm'] as const

const TEXT_OUTPUT = {
  schema: { type: 'string' as const },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
}

function execSessionId(exec: unknown): string {
  if (!exec || typeof exec !== 'object') return ''
  const e = exec as {
    sessionId?: unknown
    session_id?: unknown
    session?: { id?: unknown }
    agent?: { session?: { id?: unknown }; sessionId?: unknown }
  }
  const direct = String(e.sessionId || e.session_id || e.session?.id || '').trim()
  if (direct) return direct
  try {
    return String(e.agent?.session?.id || e.agent?.sessionId || '').trim()
  } catch {
    return ''
  }
}

const OPEN_STATUS: ReadonlySet<string> = new Set(['queued', 'running', 'paused', 'waiting_hitl'])

/** 宿主若把用户附图挂在 exec 上，也一并收进来（本地路径或 data URL）。 */
function extractExecImages(exec: unknown): string[] {
  if (!exec || typeof exec !== 'object') return []
  const out: string[] = []
  const visit = (v: unknown, depth = 0): void => {
    if (!v || depth > 3) return
    if (typeof v === 'string') {
      if (v.trim()) out.push(v.trim())
      return
    }
    if (Array.isArray(v)) {
      for (const item of v) visit(item, depth + 1)
      return
    }
    if (typeof v !== 'object') return
    const obj = v as Record<string, unknown>
    const locator = obj.path || obj.filePath || obj.file_path || obj.url || obj.src
    if (typeof locator === 'string' && locator.trim()) {
      out.push(locator.trim())
      return
    }
    const data = obj.data
    if (typeof data === 'string' && data.startsWith('data:image/')) out.push(data)
  }
  const e = exec as Record<string, unknown>
  for (const key of ['images', 'attachments', 'files', 'media', 'image']) visit(e[key])
  return [...new Set(out)].slice(0, 8)
}

/** 内联 base64 先落盘再记账，避免把整段 base64 写进 epic JSON。 */
function prepareInlineImages(inputs: string[]): { images: string[]; warnings: string[] } {
  const inline = inputs.filter((x) => /^data:image\//i.test(x))
  if (inline.length === 0) return { images: inputs, warnings: [] }
  const rest = inputs.filter((x) => !/^data:image\//i.test(x))
  const prepared = prepareImages(inline)
  return {
    images: [...rest, ...prepared.refs.map((r) => r.path)].slice(0, 8),
    warnings: prepared.warnings,
  }
}

const STATUS_ZH: Record<string, string> = {
  queued: '排队中',
  running: '执行中',
  paused: '已暂停',
  waiting_hitl: '等待确认',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

const STEP_ICON: Record<string, string> = {
  pending: '·',
  running: '▶',
  pass: '✓',
  fail: '✗',
  skipped: '↷',
  waiting_hitl: '⏸',
  cancelled: '×',
}

function oneLine(text: string, max = 100): string {
  const line = String(text || '').replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max)}…` : line
}

function parseImages(raw: unknown): string[] {
  const text = String(raw || '').trim()
  if (!text) return []
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) {
      return parsed
        .map((x) => {
          if (typeof x === 'string') return x
          if (x && typeof x === 'object') {
            const item = x as { path?: unknown; url?: unknown; data?: unknown }
            return String(item.path || item.url || '').trim()
          }
          return ''
        })
        .filter(Boolean)
        .slice(0, 8)
    }
    if (typeof parsed === 'string') return [parsed]
  } catch {
    /* 非 JSON，按单路径处理 */
  }
  return [text]
}

function formatRun(run: Run, epic: Epic | null): string {
  const lines: string[] = []
  lines.push(`任务：${run.id}`)
  lines.push(`状态：${run.status}（${STATUS_ZH[run.status] || run.status}）`)
  lines.push(`工程：${run.workspace}`)
  const current = run.steps.find((s) => s.step_id === run.current_step)
  lines.push(`当前：第 ${run.current_step} 步 ${current?.title || ''}`)
  lines.push(`打回轮次：${run.fix_round}/${run.max_fix_rounds}`)
  if (run.message) lines.push(`需求：${oneLine(run.message, 160)}`)
  if (run.error) lines.push(`错误：${run.error}`)
  lines.push('')
  lines.push('步骤：')
  for (const step of run.steps) {
    const icon = STEP_ICON[step.status] || '·'
    lines.push(`${step.step_id.padStart(2)}. ${icon} ${step.title} — ${oneLine(step.summary || '未开始', 120)}`)
  }

  if (run.status === 'failed' || run.status === 'cancelled') {
    const failedStep = run.steps.find((s) => s.step_id === run.current_step)
    if (failedStep?.detail) {
      const tail = failedStep.detail.slice(-1800)
      lines.push('')
      lines.push(`失败详情（第 ${failedStep.step_id} 步）：`)
      lines.push(tail)
    }
  }

  if (run.status === 'waiting_hitl') {
    const token = epic?.artifacts.implement?.confirm_token
    lines.push('')
    lines.push(
      token
        ? '下一步：调用 zr_pipeline_confirm 确认开工（或先修改配置再确认）。'
        : '下一步：调用 zr_pipeline_advance 继续。',
    )
  } else if (run.status === 'paused') {
    lines.push('')
    lines.push('下一步：调用 zr_pipeline_advance 继续。')
  } else if (run.status === 'running' || run.status === 'queued') {
    lines.push('')
    lines.push('任务在后台执行；稍后用 zr_pipeline_status 查看进度，zr_pipeline_cancel 可取消。')
  }

  if (run.status === 'succeeded') {
    const artifacts = epic?.artifacts
    lines.push('')
    lines.push('交付：')
    if (artifacts?.commit?.sha) lines.push(`- 提交：${artifacts.commit.sha.slice(0, 12)}${artifacts.commit.pushed ? '（已推送）' : ''}`)
    if (artifacts?.pr?.url) lines.push(`- PR：${artifacts.pr.url}`)
    if (artifacts?.deploy) lines.push(`- 部署：${artifacts.deploy.summary}`)
  }

  const recent = run.events.slice(-8)
  if (recent.length) {
    lines.push('')
    lines.push('最近事件：')
    for (const e of recent) {
      lines.push(`- [${e.ts.slice(11, 19)}] ${e.message}`)
    }
  }
  return lines.join('\n')
}

function resolveRun(
  cfg: PipelineConfig,
  runId: string,
  sessionId: string,
): Run | null {
  const id = String(runId || '').trim()
  if (id) {
    const direct = loadRun(cfg, id)
    if (direct) return direct
    const rows = listRuns(cfg)
    return rows.find((r) => r.id.startsWith(id)) || null
  }
  if (sessionId) return findLatestRunForSession(cfg, sessionId)
  return listRuns(cfg)[0] || null
}

interface SkillFrontmatter {
  body: string
  meta: Record<string, string>
}

function parseFrontmatter(raw: string): SkillFrontmatter {
  const text = String(raw || '').replace(/\r\n/g, '\n')
  if (!text.startsWith('---\n')) return { body: text, meta: {} }
  const end = text.indexOf('\n---', 4)
  if (end < 0) return { body: text, meta: {} }
  const head = text.slice(4, end)
  const body = text.slice(end + 4).replace(/^\n+/, '')
  const meta: Record<string, string> = {}
  for (const line of head.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!m) continue
    meta[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
  }
  return { body, meta }
}

function registerSkills(ctx: Context): void {
  const skills = ctx.get('skills') as
    | { register(skill: Record<string, unknown>): () => void }
    | undefined
  if (!skills?.register) return

  const root = fileURLToPath(new URL('../skills', import.meta.url))
  if (!existsSync(root)) return
  const disposers: Array<() => void> = []
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue
    const file = join(root, dir.name, 'SKILL.md')
    if (!existsSync(file)) continue
    try {
      const { body, meta } = parseFrontmatter(readFileSync(file, 'utf8'))
      const skillName = meta.name || dir.name
      if (!skillName) continue
      const description = meta.description || oneLine(body.split('\n').find(Boolean) || skillName, 160)
      const dispose = skills.register({
        name: skillName,
        description,
        whenToUse: meta.whenToUse || undefined,
        content: body,
        source: 'bundled',
      })
      if (typeof dispose === 'function') disposers.push(dispose)
    } catch (err) {
      console.warn(`[dev-pipeline] 技能 ${dir.name} 注册失败：${String(err)}`)
    }
  }
  if (disposers.length) {
    ctx.effect(() => () => {
      for (const dispose of disposers.reverse()) {
        try {
          dispose()
        } catch {
          /* ignore */
        }
      }
    })
  }
}

export function apply(ctx: Context): void {
  const bootCfg = loadConfig()
  try {
    const recovered = recoverOrphanedRuns(bootCfg)
    if (recovered > 0) console.log(`[dev-pipeline] 已把 ${recovered} 个遗留任务改为 paused`)
  } catch (err) {
    console.warn(`[dev-pipeline] 恢复遗留任务失败：${String(err)}`)
  }
  registerSkills(ctx)

  ctx.tools.register(
    defineTool({
      name: 'zr_pipeline_start',
      description:
        '【需求到上线·一体化流水线】一句话开跑十步：需求采集 → PRD → 读库 → 计划 → 写码（复用对话写码插件）→ 机器验证 → 复核 → 提交 → PR → 部署。' +
        'workspace 必须是当前工程绝对路径；任务在后台执行，本工具立即返回 run_id。' +
        '示例：「用一体化流水线把这个需求做完：登录页增加记住密码」；「在 /path/to/repo 跑十步：修复订单导出乱码」。' +
        '只想改代码、不要提交部署时，改用 zr_cchat_begin。',
      parameters: {
        workspace: {
          type: 'string',
          required: true,
          description: '当前工程绝对路径（支持 ~/…）',
        },
        message: {
          type: 'string',
          required: true,
          description: '用户本轮需求原文；不要自行扩写成行业模板',
        },
        mode: {
          type: 'string',
          enum: ['auto', 'manual'],
          description: 'auto=自动确认写码（默认）；manual=第 5 步等待 zr_pipeline_confirm',
        },
        restart: {
          type: 'boolean',
          description: '同一会话已有进行中的任务时，是否放弃它并新建（默认 false）',
        },
        images: {
          type: 'string',
          description:
            '可选附图：JSON 数组（本机绝对路径、data:image base64 或 {"path":"..."}），也可传单个路径；第 5 步会转交给写码服务，http(s) 链接不支持',
        },
      },
      timeoutMs: 60_000,
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        let workspace = ''
        try {
          workspace = normalizeWorkspace(args.workspace)
        } catch (err) {
          return `工程目录不可用：${String(err)}`
        }
        const cfg = loadConfig(workspace)
        const sessionId = execSessionId(exec)
        const mode = args.mode === 'manual' ? 'manual' : 'auto'

        const openRuns = listRuns(cfg).filter(
          (r) => r.workspace === workspace && OPEN_STATUS.has(r.status),
        )
        if (openRuns.length) {
          const blocking = openRuns[0]
          if (!args.restart) {
            const blockingEpic = loadEpic(cfg, blocking.epic_id)
            return [
              `该工程已有进行中的任务（${blocking.id}），为避免两个任务互相覆盖，未新建。`,
              '确认要放弃旧任务重跑，请传 restart: true。',
              '',
              formatRun(blocking, blockingEpic),
            ].join('\n')
          }
          const stopped = await stopRun(cfg, blocking)
          if (!stopped) {
            return `旧任务仍在退出（${blocking.id}），请稍后再试；不要并发重跑。`
          }
        }

        const inline = prepareInlineImages([
          ...parseImages(args.images),
          ...extractExecImages(exec),
        ])
        const { run, epic } = createRun({
          cfg,
          workspace,
          message: String(args.message || ''),
          sessionId,
          mode,
          images: [...new Set(inline.images)].slice(0, 8),
        })
        appendEvent(run, 'status', '十步流水线任务已创建', '1')
        saveRun(cfg, run)
        startRunInBackground(ctx as unknown as PipelineCtx, cfg, epic, run)

        const list = STEP_IDS.map((id) => `${id}. ${STEP_TITLES[id]}（${STEP_SKILLS[id]}）`).join('\n')
        return [
          `已启动：${run.id}`,
          `工程：${workspace}`,
          `模式：${mode}${cfg.autoRun ? '' : '（配置 autoRun=false，第 5 步会等待确认）'}`,
          '',
          '十步计划：',
          list,
          '',
          '任务在后台执行；用 zr_pipeline_status 查看进度。',
          ...(inline.warnings.length
            ? ['', '附图提醒：', ...inline.warnings.map((w) => `- ${w}`)]
            : []),
          ...(cfg.warnings.length ? ['', '配置提醒：', ...cfg.warnings.map((w) => `- ${w}`)] : []),
        ].join('\n')
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'zr_pipeline_status',
      description:
        '查看一体化流水线任务进度：十步状态、当前步、失败详情、PR/部署结果。' +
        '不传 run_id 时取当前会话最近一次任务。示例：「流水线跑到哪了」「看看刚才那个任务」。',
      parameters: {
        run_id: {
          type: 'string',
          description: '任务 id（可只传前缀）；不传则取当前会话最近任务',
        },
      },
      timeoutMs: 30_000,
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const sessionId = execSessionId(exec)
        const cfg = loadConfig()
        const run = resolveRun(cfg, String(args.run_id || ''), sessionId)
        if (!run) return '没有找到流水线任务。用 zr_pipeline_start 启动一个。'
        const epic = loadEpic(cfg, run.epic_id)
        return formatRun(run, epic)
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'zr_pipeline_advance',
      description:
        '继续一个暂停或等待中的流水线任务（后台执行）。' +
        '若第 5 步在等确认，请改用 zr_pipeline_confirm。示例：「继续那个流水线」「接着跑」。',
      parameters: {
        run_id: { type: 'string', description: '任务 id，可只传前缀；不传取当前会话最近任务' },
      },
      timeoutMs: 30_000,
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const sessionId = execSessionId(exec)
        const cfg = loadConfig()
        const run = resolveRun(cfg, String(args.run_id || ''), sessionId)
        if (!run) return '没有找到流水线任务。'
        if (isRunActive(run.id)) return `任务正在执行中：${run.id}\n\n${formatRun(run, loadEpic(cfg, run.epic_id))}`
        if (run.status === 'succeeded') return `任务已完成，无需继续。\n\n${formatRun(run, loadEpic(cfg, run.epic_id))}`
        if (run.status === 'cancelled') return `任务已取消；如需重跑请用 zr_pipeline_start。`
        if (run.status === 'failed') {
          return [
            `任务已失败：${run.error}`,
            '修复环境或配置后，请用 zr_pipeline_start 重新开跑（失败任务不自动续跑，避免半成品重复提交）。',
            '',
            formatRun(run, loadEpic(cfg, run.epic_id)),
          ].join('\n')
        }

        const epic = loadEpic(cfg, run.epic_id)
        if (!epic) return `任务账本缺失：${run.epic_id}`
        if (run.status === 'waiting_hitl' && epic.artifacts.implement?.confirm_token) {
          return '第 5 步正在等待确认；请调用 zr_pipeline_confirm，不要用 advance。'
        }

        run.status = 'running'
        run.error = ''
        run.ended_at = ''
        appendEvent(run, 'status', '人工继续任务', run.current_step)
        saveRun(cfg, run)
        startRunInBackground(ctx as unknown as PipelineCtx, cfg, epic, run)
        return `已继续：${run.id}\n\n${formatRun(run, epic)}`
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'zr_pipeline_confirm',
      description:
        '确认第 5 步的写码确认单并开工（autoRun=false 或 mode=manual 时需要）。' +
        '确认后在后台等待写码完成并继续后续步骤。示例：「确认开工」「同意这次写码」。',
      parameters: {
        run_id: { type: 'string', description: '任务 id，可只传前缀；不传取当前会话最近等待确认的任务' },
      },
      timeoutMs: 120_000,
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const sessionId = execSessionId(exec)
        const cfg = loadConfig()
        const run = resolveRun(cfg, String(args.run_id || ''), sessionId)
        if (!run) return '没有找到流水线任务。'
        if (isRunActive(run.id) || (run.status !== 'waiting_hitl' && run.status !== 'paused')) {
          if (run.status === 'succeeded') return '任务已完成，无需确认。'
          if (run.status === 'running' || run.status === 'queued') {
            return '任务正在执行中，无需确认。'
          }
          return `当前任务状态为 ${STATUS_ZH[run.status] || run.status}，没有可确认的写码单。`
        }
        const epic = loadEpic(cfg, run.epic_id)
        if (!epic) return `任务账本缺失：${run.epic_id}`
        const impl = epic.artifacts.implement
        if (!impl?.confirm_token) {
          if (impl?.job_id) {
            return `写码已经开工（Job ${impl.job_id}），无需重复确认。用 zr_pipeline_status 查看进度。`
          }
          return '当前任务没有待确认的写码确认单。'
        }

        const token = impl.confirm_token
        // 等待确认期间用户可能改过文件；首轮开工前重拍基线，避免把等待期改动算成本次写码。
        // 打回轮次不能重拍，否则上一轮写码成果会被当成基线，提交时漏掉。
        if (run.fix_round === 0) {
          try {
            epic.artifacts.scope_baseline = await snapshotScope(epic.workspace)
            saveEpic(cfg, epic)
          } catch (err) {
            return `无法记录写码前基线：${String(err)}`
          }
        }
        try {
          const nonce = await issueNonce(cfg.cursorChatBase, HITL_CONFIRM_ACTION, {
            confirm_token: token,
          })
          const started = await confirmStart(cfg.cursorChatBase, {
            confirmToken: token,
            nonce,
          })
          epic.artifacts.implement = {
            job_id: started.job_id,
            status: started.job?.status || 'running',
            detail: '',
            changed_files: [],
            deleted_files: [],
            gate: { class: 'running', reason: '写码进行中', summary: '写码进行中' },
            started_at: new Date().toISOString(),
            ended_at: '',
          }
          saveEpic(cfg, epic)
          run.status = 'running'
          run.error = ''
          run.ended_at = ''
          appendEvent(run, 'status', `已确认写码：${started.job_id}`, '5')
          saveRun(cfg, run)
          startRunInBackground(ctx as unknown as PipelineCtx, cfg, epic, run)
          return `已确认开工：${started.job_id}\n任务在后台继续，用 zr_pipeline_status 查看进度。`
        } catch (err) {
          return `确认失败：${String(err)}\n\n确认单可能已过期；可调用 zr_pipeline_advance 重新生成（会重新进入第 5 步）。`
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'zr_pipeline_cancel',
      description:
        '取消一体化流水线任务；若写码进行中会同时请求取消 Cursor Job。示例：「停止流水线」「取消这个任务」。',
      parameters: {
        run_id: { type: 'string', description: '任务 id，可只传前缀；不传取当前会话最近任务' },
      },
      timeoutMs: 30_000,
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const sessionId = execSessionId(exec)
        const cfg = loadConfig()
        const run = resolveRun(cfg, String(args.run_id || ''), sessionId)
        if (!run) return '没有找到流水线任务。'
        cancelRun(cfg, run)
        return `已取消：${run.id}`
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'zr_pipeline_list',
      description: '列出最近的流水线任务及状态。示例：「列出流水线任务」「最近跑了哪些需求」。',
      parameters: {
        limit: { type: 'integer', description: '返回条数，默认 8，最多 20' },
      },
      timeoutMs: 30_000,
      output: TEXT_OUTPUT,
      async execute(args) {
        const cfg = loadConfig()
        const limit = Math.max(1, Math.min(20, Number(args.limit) || 8))
        const rows = listRuns(cfg).slice(0, limit)
        if (!rows.length) return '还没有流水线任务。用 zr_pipeline_start 启动一个。'
        return rows
          .map((r) => {
            const step = r.steps.find((s) => s.step_id === r.current_step)
            return [
              `${r.id} · ${STATUS_ZH[r.status] || r.status} · 第 ${r.current_step} 步 ${step?.title || ''}`,
              `  ${oneLine(r.message || r.workspace, 120)}`,
              `  ${r.created_at}`,
            ].join('\n')
          })
          .join('\n\n')
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'zr_pipeline_config',
      description:
        '查看一体化流水线当前生效配置（写码地址、打回轮次、部署命令、验证命令、模型）与配置提醒。' +
        '示例：「流水线配置是什么」「部署命令配了吗」。',
      parameters: {
        workspace: { type: 'string', description: '可选：同时查看该工程的 .dsh/dev-pipeline.json 覆盖' },
      },
      timeoutMs: 30_000,
      output: TEXT_OUTPUT,
      async execute(args) {
        const workspace = String(args.workspace || '').trim()
        const cfg = loadConfig(workspace)
        const lines = [
          `数据目录：${cfg.dataRoot}`,
          `写码服务：${cfg.cursorChatBase}`,
          `自动开工：${cfg.autoRun ? '是' : '否（第 5 步等待确认）'}`,
          `自动推送：${cfg.push ? '是' : '否'}`,
          `打回上限：${cfg.maxFixRounds} 轮`,
          `部署重试：${cfg.maxDeployAttempts} 次`,
          `写码超时：${Math.round(cfg.cursorTimeoutMs / 60000)} 分钟`,
          `验证命令：${cfg.validateCommands.length ? cfg.validateCommands.join('；') : '未配置（自动探测）'}`,
          `部署命令：${cfg.deploy.command || '未配置（第 10 步跳过）'}`,
          `健康检查：${cfg.deploy.healthUrl || '未配置'}`,
          `模型：${cfg.llm.provider || '宿主默认'}/${cfg.llm.model || '宿主默认'}`,
        ]
        if (cfg.warnings.length) {
          lines.push('', '提醒：', ...cfg.warnings.map((w) => `- ${w}`))
        }
        lines.push(
          '',
          '配置文件：',
          `- 宿主级：${cfg.dataRoot}/config.json`,
          '- 工程级：<workspace>/.dsh/dev-pipeline.json',
          '- 环境变量：DEV_PIPELINE_AUTO_RUN / DEV_PIPELINE_PUSH / DEV_PIPELINE_MAX_FIX_ROUNDS 等',
        )
        return lines.join('\n')
      },
    }),
  )
}

/** 供自检脚本使用。 */
export { STEP_IDS, STEP_SKILLS, STEP_TITLES }
export type { Run, Epic, StepId }
