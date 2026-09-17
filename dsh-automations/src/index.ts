import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  applyConfigFromUi,
  editableConfigView,
  loadConfig,
  publicConfigView,
} from './config.js'
import {
  createAutomation,
  deleteAutomation,
  getAutomation,
  listAutomations,
  listRuns,
  updateAutomation,
} from './store.js'
import { executeById } from './executor.js'
import { scheduleSummary } from './schedule.js'
import { AUTOMATION_TEMPLATES } from './templates.js'
import { getListenAddr, isServerRunning, startServer } from './server.js'

export const name = 'automations'
export const inject = ['tools'] as const

declare const harness: {
  handle: (method: string, fn: (args: Record<string, unknown>) => Promise<unknown>) => void
}

function textBlocks(text: string | undefined) {
  return [{ type: 'text' as const, text: text ?? '' }]
}

function registerHarnessHandlers(): void {
  try {
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
        detail: '已保存到本机 ~/.zhongruan/automations/config.json',
        config: editableConfigView(next),
        view: publicConfigView(next),
      }
    })
    h.handle('status', async () => {
      const cfg = loadConfig()
      return {
        ok: true,
        running: isServerRunning(),
        addr: getListenAddr(),
        view: publicConfigView(cfg),
      }
    })
    h.handle('listAutomations', async () => {
      const cfg = loadConfig()
      return {
        ok: true,
        items: listAutomations(cfg.dataRoot).map((x) => ({ ...x, schedule_label: scheduleSummary(x) })),
      }
    })
    h.handle('createAutomation', async (args) => {
      const cfg = loadConfig()
      const item = await createAutomation(cfg.dataRoot, args || {})
      return { ok: true, item: { ...item, schedule_label: scheduleSummary(item) } }
    })
    h.handle('updateAutomation', async (args) => {
      const cfg = loadConfig()
      const id = String(args?.id || '')
      const item = await updateAutomation(cfg.dataRoot, id, args || {})
      if (!item) return { ok: false, detail: '任务不存在' }
      return { ok: true, item: { ...item, schedule_label: scheduleSummary(item) } }
    })
    h.handle('deleteAutomation', async (args) => {
      const cfg = loadConfig()
      const ok = await deleteAutomation(cfg.dataRoot, String(args?.id || ''))
      return { ok, detail: ok ? '已删除' : '任务不存在' }
    })
    h.handle('listRuns', async (args) => {
      const cfg = loadConfig()
      const page = Number(args?.page || 1)
      const pageSize = Number(args?.page_size || 10)
      return { ok: true, ...listRuns(cfg.dataRoot, page, pageSize) }
    })
    h.handle('runNow', async (args) => {
      const cfg = loadConfig()
      const result = await executeById(cfg.dataRoot, String(args?.id || ''))
      if (result.skipped && result.reason === 'already_running') {
        return { ok: false, code: 'already_running', detail: '已有任务在执行' }
      }
      return { ok: result.ok, run: result.run, detail: result.reason || result.run?.error?.message }
    })
    h.handle('templates', async () => ({ ok: true, items: AUTOMATION_TEMPLATES }))
    console.log('[automations] harness 已注册')
  } catch (err) {
    console.warn('[automations] harness 注册跳过：', String(err))
  }
}

export function apply(ctx: Context) {
  registerHarnessHandlers()
  void startServer()
    .then((out) => {
      console.log(`[automations] ${out.detail}`)
    })
    .catch((err) => {
      console.warn(`[automations] 启动失败：${String(err)}`)
    })

  ctx.tools.register(
    defineTool({
      name: 'zr_auto_status',
      description:
        '【自动化任务状态】仅当用户问定时任务/自动化任务服务是否在跑、下次执行时间、企微是否配置时调用。' +
        '问天气、写码、审码、部署不要用本工具。参数 ignore 传空字符串。',
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
        const cfg = loadConfig()
        const view = publicConfigView(cfg)
        const items = listAutomations(cfg.dataRoot)
        const active = items.filter((x) => x.status === 'active')
        const lines = [
          `请到左侧栏「自动化」（与设置并列）管理模板/自定义任务与企微推送。`,
          `本机服务：${isServerRunning() ? '已监听' : '未监听'} ${getListenAddr() || view.addr}`,
          `调度：${view.schedulerEnabled ? '开启' : '关闭'}；任务 ${items.length} 个（启用 ${active.length}）`,
          `LLM：${view.llmConfigured ? '已配置' : '未配置（自定义润色/部分模板需要）'}`,
          `企微：${view.wecomPushEnabled ? (view.wecomConfigured ? '已开' : '已开但未填 Webhook') : '关闭'}${view.wecomDryRun ? '（干跑）' : ''}`,
        ]
        return { summary: lines.join('\n') }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'zr_auto_list',
      description:
        '【列出自动化任务】仅当用户要查看已保存的定时任务、自动化任务列表时调用。不要用于普通待办或写码 Job。参数 ignore 传空字符串。',
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
        const cfg = loadConfig()
        const items = listAutomations(cfg.dataRoot)
        if (!items.length) return { summary: '还没有自动化任务。请到左侧栏「自动化」用模板创建，或说明要定时做什么。' }
        const lines = items.map((x) => {
          const next = x.next_run_at
            ? new Date(x.next_run_at * 1000).toLocaleString('zh-CN')
            : '—'
          return `- ${x.name}（${x.id}）状态=${x.status} 日程=${scheduleSummary(x)} 下次=${next}`
        })
        return { summary: `共 ${items.length} 个任务：\n${lines.join('\n')}` }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'zr_auto_run',
      description:
        '【立即执行自动化任务】仅当用户要求马上跑某个已存在的定时/自动化任务时调用。参数 id 为任务 id（auto- 开头）。不要用它启动写码或审码。',
      parameters: {
        id: { type: 'string', required: true, description: '任务 id，例如 auto- 开头的标识' },
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
        const id = String(args.id || '').trim()
        const cfg = loadConfig()
        const item = getAutomation(cfg.dataRoot, id)
        if (!item) return { summary: `找不到任务 ${id}。请先 zr_auto_list。` }
        const result = await executeById(cfg.dataRoot, id)
        if (result.skipped && result.reason === 'already_running') {
          return { summary: '已有自动化任务在执行，请稍后再试。当前对话不受影响。' }
        }
        const run = result.run
        const err = run?.error ? `${run.error.code}: ${run.error.message}` : ''
        const sum = (run?.summary || '').slice(0, 1200)
        return {
          summary: result.ok
            ? `任务「${item.name}」执行成功。\n${sum}`
            : `任务「${item.name}」未成功。${err}\n${sum}`,
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'zr_auto_update',
      description:
        '【创建或修改自动化任务】仅当用户明确要新建/修改/暂停/删除「定时任务、自动化任务」时调用。可提示用户到左侧栏「自动化」管理。' +
        '例如「每天早上 9 点整理新闻推企微」。问天气、写码、审码、部署不要用本工具。' +
        'prompt 只写任务内容，不要把时间写进 prompt；时间用 rrule 或 scheduled_at。',
      parameters: {
        mode: {
          type: 'string',
          required: true,
          description: 'create / update / pause / resume / delete',
        },
        id: { type: 'string', required: true, description: '已有任务 id；create 时传空字符串' },
        name: { type: 'string', required: true, description: '任务名称；不改时传空字符串' },
        prompt: { type: 'string', required: true, description: '执行指令（不含时间）；不改时传空字符串' },
        schedule_type: { type: 'string', required: true, description: 'recurring 或 once；不改时传空字符串' },
        rrule: { type: 'string', required: true, description: '如 FREQ=DAILY;BYHOUR=9;BYMINUTE=0；不改时传空字符串' },
        scheduled_at: { type: 'string', required: true, description: '单次时间 YYYY-MM-DDTHH:mm；不用则空字符串' },
        cwds: { type: 'string', required: true, description: '工作目录绝对路径，多个用逗号；不用则空字符串' },
        push_to_wecom: { type: 'string', required: true, description: 'true / false / 空（空表示不改）' },
        template_id: { type: 'string', required: true, description: '模板 id，如 daily-ai-news；不用则空字符串' },
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
        const cfg = loadConfig()
        const mode = String(args.mode || '').trim().toLowerCase()
        const id = String(args.id || '').trim()
        const cwds = String(args.cwds || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        const pushRaw = String(args.push_to_wecom || '').trim().toLowerCase()
        const push = pushRaw === '' ? undefined : pushRaw === 'true' || pushRaw === '1'
        if (mode === 'create') {
          const tpl = String(args.template_id || '').trim()
          const item = await createAutomation(cfg.dataRoot, {
            name: String(args.name || '').trim() || undefined,
            prompt: String(args.prompt || '').trim() || undefined,
            template_id: tpl || null,
            source: tpl ? 'template' : 'custom',
            schedule_type: String(args.schedule_type || '').trim() || undefined,
            rrule: String(args.rrule || '').trim() || undefined,
            scheduled_at: String(args.scheduled_at || '').trim() || null,
            cwds,
            push_to_wecom: push,
          })
          return {
            summary: `已创建自动化任务「${item.name}」（${item.id}），${scheduleSummary(item)}。可到左侧栏「自动化」点「立即测试」验收。禁止用本任务写码/提交/部署。`,
          }
        }
        if (!id) return { summary: '修改/删除需要任务 id，请先 zr_auto_list。' }
        if (mode === 'delete') {
          const ok = await deleteAutomation(cfg.dataRoot, id)
          return { summary: ok ? `已删除任务 ${id}（运行记录保留）` : '任务不存在' }
        }
        if (mode === 'pause' || mode === 'resume') {
          const item = await updateAutomation(cfg.dataRoot, id, { status: mode === 'pause' ? 'paused' : 'active' })
          return { summary: item ? `任务「${item.name}」已${mode === 'pause' ? '暂停' : '恢复'}` : '任务不存在' }
        }
        if (mode === 'update') {
          const item = await updateAutomation(cfg.dataRoot, id, {
            name: String(args.name || '').trim() || undefined,
            prompt: String(args.prompt || '').trim() || undefined,
            schedule_type: String(args.schedule_type || '').trim() || undefined,
            rrule: String(args.rrule || '').trim() || undefined,
            scheduled_at: String(args.scheduled_at || '').trim() || undefined,
            cwds: cwds.length ? cwds : undefined,
            push_to_wecom: push,
          })
          return { summary: item ? `已更新「${item.name}」，${scheduleSummary(item)}` : '任务不存在' }
        }
        return { summary: 'mode 只支持 create / update / pause / resume / delete' }
      },
    }),
  )

  console.log('[automations] 插件已加载，工具 zr_auto_status / zr_auto_list / zr_auto_run / zr_auto_update')
}
