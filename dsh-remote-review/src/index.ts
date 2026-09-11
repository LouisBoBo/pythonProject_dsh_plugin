import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  applyConfigFromUi,
  editableConfigView,
  feishuReady,
  loadConfig,
  publicConfigView,
  saveConfig,
} from './config.js'
import { installCommitWebhookHook } from './hook-install.js'
import { jobSummary, listJobs, loadJob } from './jobs.js'
import { enqueueReview, sendJobToFeishu } from './pipeline.js'
import { engineStatus } from './review-client.js'
import { getListenAddr, isServerRunning, startServer, stopServer } from './server.js'

export const name = 'remote-review'
export const inject = ['tools'] as const

declare const harness: {
  handle: (method: string, fn: (args: Record<string, unknown>) => Promise<unknown>) => void
}

function textBlocks(text: string | undefined) {
  return [{ type: 'text' as const, text: text ?? '' }]
}

function registerHarnessHandlers(): void {
  try {
    // DSH 宿主注入的 Package 私有 RPC；设置页优先 host.call，失败再走本机 HTTP
    const h =
      typeof harness !== 'undefined'
        ? harness
        : (globalThis as unknown as { harness?: typeof harness }).harness
    if (!h || typeof h.handle !== 'function') return
    h.handle('getConfig', async () => {
      const cfg = loadConfig()
      return { ok: true, config: editableConfigView(cfg), view: publicConfigView(cfg) }
    })
    h.handle('saveConfig', async (args) => {
      const next = applyConfigFromUi(args || {})
      return {
        ok: true,
        detail: '已保存到本机 ~/.zhongruan/remote-review/config.json（未写入任何项目仓库）',
        config: editableConfigView(next),
        view: publicConfigView(next),
      }
    })
    h.handle('status', async () => {
      const cfg = loadConfig()
      const engine = await engineStatus(cfg.engine)
      return {
        ok: true,
        running: isServerRunning(),
        addr: getListenAddr(),
        view: publicConfigView(cfg),
        engine,
      }
    })
    h.handle('installHook', async (args) => {
      const repoPath = String((args && (args.repoPath || args.repo_path)) || '').trim()
      if (!repoPath) return { ok: false, detail: '请填写业务仓库绝对路径 repoPath' }
      return installCommitWebhookHook(repoPath)
    })
    console.log('[remote-review] harness 已注册 getConfig/saveConfig/status/installHook')
  } catch (err) {
    console.warn('[remote-review] harness 注册跳过：', String(err))
  }
}

export function apply(ctx: Context) {
  registerHarnessHandlers()
  void startServer()
    .then((out) => {
      console.log(`[remote-review] ${out.detail}`)
    })
    .catch((err) => {
      console.warn(`[remote-review] 启动失败：${String(err)}`)
    })

  ctx.tools.register(
    defineTool({
      name: 'remote_review_status',
      description:
        '【远端/本地 Webhook 审码状态】当用户问自动审码服务是否在跑、Webhook 地址、飞书是否配置、引擎是否就绪时必须调用。参数 ignore 传空字符串。优先提醒用户到「设置 → 远端审码」填写飞书，不要让用户手改配置文件。',
      parameters: {
        ignore: { type: 'string', required: true, description: '占位参数，传空字符串即可' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            summary: { type: 'string' },
          },
        },
        render: (_args, value) => textBlocks(value.summary),
      },
      async execute() {
        const cfg = loadConfig()
        const engine = await engineStatus(cfg.engine)
        const view = publicConfigView(cfg)
        const lines = [
          `请到 WorkBuddy「设置 → 远端审码」填写飞书（推荐），不要手改电脑上的配置文件。`,
          `Webhook 服务：${isServerRunning() ? '本进程已监听' : '未在本进程监听'} ${getListenAddr() || view.webhook}`,
          `审码引擎 ${cfg.engine}：${engine.ok ? '就绪（沿用现有 /api/code-review，未改引擎）' : engine.detail}`,
          `飞书文档：${view.feishuReady ? '已配置 App，审核完成后会自动建文档' : '未配置 App ID/Secret，请到设置页填写'}`,
          `飞书文件夹 token：${view.feishuFolderToken || '空（将写到应用根目录）'}`,
          `数据目录：${cfg.dataRoot}`,
        ]
        return { summary: lines.join('\n') }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'remote_review_start',
      description:
        '【启动本地 Webhook 审码服务】用户说启动自动审码、打开 Webhook 服务时调用。参数 ignore 传空字符串。',
      parameters: {
        ignore: { type: 'string', required: true, description: '占位参数，传空字符串即可' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { summary: { type: 'string' } },
        },
        render: (_args, value) => textBlocks(value.summary),
      },
      async execute() {
        const out = await startServer()
        return { summary: out.detail }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'remote_review_stop',
      description: '【停止本地 Webhook 审码服务】用户明确要求停止自动审码服务时调用。参数 ignore 传空字符串。',
      parameters: {
        ignore: { type: 'string', required: true, description: '占位参数，传空字符串即可' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { summary: { type: 'string' } },
        },
        render: (_args, value) => textBlocks(value.summary),
      },
      async execute() {
        const out = await stopServer()
        return { summary: out.detail }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'remote_review_config',
      description:
        '【配置远端审码】一般请引导用户打开 WorkBuddy「设置 → 远端审码」图形界面填写。仅当用户无法打开设置页时，才用本工具写入本机 config（密钥会出现在对话中）。未传的字段保持原值。',
      parameters: {
        engine: { type: 'string', required: true, description: 'WorkBuddy 引擎基址，如 http://127.0.0.1:8000；不改则传空' },
        port: { type: 'string', required: true, description: 'Webhook 端口，默认 18787；不改则传空' },
        feishuAppId: { type: 'string', required: true, description: '飞书自建应用 App ID；不改则传空' },
        feishuAppSecret: { type: 'string', required: true, description: '飞书 App Secret；不改则传空' },
        feishuFolderToken: { type: 'string', required: true, description: '飞书云空间文件夹 token，报告会建在该目录；不改则传空' },
        secret: { type: 'string', required: true, description: 'Webhook 校验密钥；不改则传空。本地测试可空' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { summary: { type: 'string' } },
        },
        render: (_args, value) => textBlocks(value.summary),
      },
      async execute(args) {
        const partial: {
          engine?: string
          port?: number
          secret?: string
          feishu: { appId?: string; appSecret?: string; folderToken?: string }
        } = { feishu: {} }
        if (String(args.engine || '').trim()) partial.engine = String(args.engine).trim()
        if (String(args.port || '').trim()) partial.port = Number(args.port)
        if (String(args.secret || '').trim()) partial.secret = String(args.secret).trim()
        if (String(args.feishuAppId || '').trim()) partial.feishu!.appId = String(args.feishuAppId).trim()
        if (String(args.feishuAppSecret || '').trim()) partial.feishu!.appSecret = String(args.feishuAppSecret).trim()
        if (String(args.feishuFolderToken || '').trim()) {
          partial.feishu!.folderToken = String(args.feishuFolderToken).trim()
        }
        const cfg = saveConfig(partial)
        const view = publicConfigView(cfg)
        return {
          summary:
            `已写入 ${cfg.dataRoot}/config.json\n` +
            `引擎 ${view.engine}  端口 ${view.port}\n` +
            `飞书 ${view.feishuReady ? '已配置' : '仍未配置'}  文件夹 ${view.feishuFolderToken || '空'}\n` +
            `改端口后请 remote_review_stop 再 remote_review_start。`,
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'remote_review_install_hook',
      description:
        '【给仓库安装 IDE 提交 Webhook Hook】在目标 git 仓安装 post-commit：提交后后台 POST 到本地 Webhook，不阻塞提交。若已有第一种本机审码 Hook，会改名为 post-commit.dsh-prev 并链式调用，不覆盖其行为。参数 repoPath 为仓库绝对路径。',
      parameters: {
        repoPath: { type: 'string', required: true, description: 'git 仓库根目录绝对路径' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { summary: { type: 'string' } },
        },
        render: (_args, value) => textBlocks(value.summary),
      },
      async execute(args) {
        const repoPath = resolve(String(args.repoPath || '').trim())
        const out = installCommitWebhookHook(repoPath)
        return { summary: out.detail + (out.ok ? `\nWebhook: ${out.webhook}` : '') }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'remote_review_simulate',
      description:
        '【立刻模拟一次提交审码】不经过 git，直接把本地仓库路径送进 Webhook 流水线：list→run 现有审码 API，完成后发飞书。用于本地没有远端仓库时的联调。参数 repoPath 为绝对路径。',
      parameters: {
        repoPath: { type: 'string', required: true, description: '要审核的本地仓库绝对路径' },
        focus: { type: 'string', required: true, description: '审码关注点，可空，默认「本地模拟提交」' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { summary: { type: 'string' } },
        },
        render: (_args, value) => textBlocks(value.summary),
      },
      async execute(args) {
        await startServer()
        const repoPath = resolve(String(args.repoPath || '').trim())
        if (!existsSync(repoPath)) {
          return { summary: `路径不存在：${repoPath}` }
        }
        const job = await enqueueReview({
          source: 'simulate',
          repo: repoPath.split(/[\\/]/).filter(Boolean).pop() || 'local',
          commit: 'simulate',
          branch: 'HEAD',
          localPath: repoPath,
          focus: String(args.focus || '').trim() || '本地模拟提交自动审码',
        })
        return { summary: `已入队 ${job.id}（${job.status}）。完成后可用 remote_review_jobs 查看飞书链接。` }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'remote_review_jobs',
      description: '【列出最近自动审码任务】查看状态、报告 ID、飞书文档链接。参数 ignore 传空字符串。',
      parameters: {
        ignore: { type: 'string', required: true, description: '占位参数，传空字符串即可' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { summary: { type: 'string' } },
        },
        render: (_args, value) => textBlocks(value.summary),
      },
      async execute() {
        const jobs = listJobs(15)
        if (!jobs.length) return { summary: '暂无任务。请先启动服务并 git commit，或 remote_review_simulate。' }
        return { summary: jobs.map(jobSummary).join('\n') }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'remote_review_retry_feishu',
      description: '【把已完成的审码报告补发到飞书文档】参数 jobId 为 rr- 开头的任务号。飞书配置好后可重试先前 feishu_pending / feishu_failed 的任务。',
      parameters: {
        jobId: { type: 'string', required: true, description: '任务 ID，如 rr-20260911-xxxx' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { summary: { type: 'string' } },
        },
        render: (_args, value) => textBlocks(value.summary),
      },
      async execute(args) {
        const id = String(args.jobId || '').trim()
        const existing = loadJob(id)
        if (!existing) return { summary: `任务不存在：${id}` }
        if (!feishuReady(loadConfig()) && !existing.reportMarkdown) {
          return { summary: '飞书未配置且任务无报告正文' }
        }
        const job = await sendJobToFeishu(id)
        return {
          summary: job.feishuUrl
            ? `${job.id} 已写入飞书：${job.feishuUrl}`
            : `${job.id} ${job.status}：${job.detail || ''}（本地副本 ${job.feishuLocalPath || '无'}）`,
        }
      },
    }),
  )

  console.log(
    '[remote-review] 插件已加载：status/start/stop/config/install_hook/simulate/jobs/retry_feishu',
  )
}
