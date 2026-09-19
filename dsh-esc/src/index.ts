import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { getExpert, loadCatalog, publicCatalog } from './catalog.js'
import { loadConfig, publicConfigView } from './config.js'
import { registerPromptHooks } from './prompt.js'
import { getListenAddr, isServerRunning, setOnStateChange, startServer } from './server.js'
import {
  applyScene,
  clearSessionScene,
  loadState,
  publicState,
  resolveConnectorPool,
  resolveExpertId,
  setActiveExpert,
  setSessionOverride,
  summonScene,
} from './store.js'
import { getAnyScene, publicScenes } from './scenes.js'
import { queryMes, MES_KIND_HELP } from './adapters/mes.js'
import { searchDify } from './adapters/dify.js'
import { renderChart } from './adapters/mcp_chart.js'
import { sendWecom } from './adapters/wecom.js'
import { writeFeishuWiki } from './adapters/feishu.js'
import { readPublicUrl } from './adapters/web_read.js'
import { PLUGIN_VERSION, sanitizeMdCaption } from './util.js'

export const name = 'esc'
export const inject = ['tools'] as const

declare const harness: {
  handle: (method: string, fn: (args: Record<string, unknown>) => Promise<unknown>) => void
}

type ExecCtx = { agent?: { session?: { id?: string } } }

function sessionIdOf(exec?: ExecCtx): string {
  return String(exec?.agent?.session?.id || '').trim()
}

function sceneBlocksConnector(exec: ExecCtx | undefined, connectorId: string): string | null {
  const sid = sessionIdOf(exec)
  if (!sid) return null
  const pool = resolveConnectorPool(loadState(loadConfig().dataRoot), sid)
  if (pool === null) return null
  if (pool.includes(connectorId)) return null
  return `失败 · none · connector_not_in_scene\n本会话场景卡未包含连接器「${connectorId}」，不能调用。请换一张含该连接器的场景卡，或在输入框旁添加场景。`
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
    h.handle('getSnapshot', async () => {
      const cfg = loadConfig()
      return {
        ok: true,
        version: PLUGIN_VERSION,
        running: isServerRunning(),
        addr: getListenAddr(),
        view: publicConfigView(cfg),
        catalog: publicCatalog(publicScenes(cfg.dataRoot)),
        state: publicState(loadState(cfg.dataRoot)),
      }
    })
    console.log('[esc] harness 已注册')
  } catch (err) {
    console.warn('[esc] harness 注册跳过：', String(err))
  }
}

let disposeMes: (() => void) | undefined
let disposeDify: (() => void) | undefined
let disposeChart: (() => void) | undefined
let disposeWecom: (() => void) | undefined
let disposeFeishu: (() => void) | undefined
let disposeWebRead: (() => void) | undefined

function summaryOfQuery(result: { ok: boolean; code?: string; detail: string; source: string; data?: unknown }): string {
  const head = `${result.ok ? '成功' : '失败'} · ${result.source}${result.code ? ` · ${result.code}` : ''}\n${result.detail}`
  if (!result.data) return head
  return `${head}\n${JSON.stringify(result.data, null, 2).slice(0, 6000)}`
}

function summaryOfChart(
  title: string,
  result: { ok: boolean; code?: string; detail: string; source: string; data?: unknown },
): string {
  if (!result.ok) return summaryOfQuery(result)
  const rec = result.data && typeof result.data === 'object' ? (result.data as Record<string, unknown>) : {}
  const url = String(rec.imageUrl || '').trim()
  if (!url) return summaryOfQuery(result)
  const caption = sanitizeMdCaption(String(title || '图表'))
  return (
    `${result.ok ? '成功' : '失败'} · ${result.source}\n${result.detail}\n` +
    `正文必须紧贴对应表格插入 Markdown 图片（禁止只贴裸链接）：\n![${caption}](${url})`
  )
}

function syncConnectorTools(ctx: Context): void {
  const cfg = loadConfig()
  const state = loadState(cfg.dataRoot)
  const mesOn = Boolean(state.connectors.mes?.enabled)
  const difyOn = Boolean(state.connectors.dify?.enabled)

  if (mesOn && !disposeMes) {
    disposeMes = ctx.tools.register(
      defineTool({
        name: 'zr_esc_mes_query',
        description:
          '【ESC·MES 结构化取数】仅在「专家·技能·连接器」面板已启用公司 MES 连接器时调用。' +
          `kind 必须是 ${MES_KIND_HELP}，禁止用用户原话当 kind。` +
          '自然语言产量分析若未启用本连接器，继续用现网 mes_ask。',
        parameters: {
          kind: {
            type: 'string',
            required: true,
            description:
              'work_order=工单；wip=在制；output=日产出；capacity=稼动/利用率；oee=OEE；yield=良率；scrap=报废；inventory=物料库存',
          },
          keyword: {
            type: 'string',
            required: true,
            description: '工单号或料号；不需要时传空字符串',
          },
          date_from: {
            type: 'string',
            required: true,
            description: '开始日期 YYYY-MM-DD；不用则空字符串',
          },
          date_to: {
            type: 'string',
            required: true,
            description: '结束日期 YYYY-MM-DD；不用则空字符串',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: { summary: { type: 'string' } },
          },
          render: (_args, value) => textBlocks(value.summary),
        },
        async execute(args, exec?: ExecCtx) {
          const blocked = sceneBlocksConnector(exec, 'mes')
          if (blocked) return { summary: blocked }
          const row = loadState(loadConfig().dataRoot).connectors.mes
          const result = await queryMes(
            row,
            String(args.kind || ''),
            String(args.keyword || ''),
            String(args.date_from || ''),
            String(args.date_to || ''),
          )
          return { summary: summaryOfQuery(result) }
        },
      }),
    )
  }
  if (!mesOn && disposeMes) {
    disposeMes()
    disposeMes = undefined
  }

  if (difyOn && !disposeDify) {
    disposeDify = ctx.tools.register(
      defineTool({
        name: 'zr_esc_dify_search',
        description:
          '【ESC·Dify 知识检索】仅在面板已启用 Dify 连接器且已填写 datasetId 时调用。' +
          '未配置 datasetId 时不要调用；收到 connector_unconfigured 后只根据用户原文分析，禁止编造知识库条目。',
        parameters: {
          query: { type: 'string', required: true, description: '检索问句' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: { summary: { type: 'string' } },
          },
          render: (_args, value) => textBlocks(value.summary),
        },
        async execute(args, exec?: ExecCtx) {
          const blocked = sceneBlocksConnector(exec, 'dify')
          if (blocked) return { summary: blocked }
          const row = loadState(loadConfig().dataRoot).connectors.dify
          const result = await searchDify(row, String(args.query || ''))
          return { summary: summaryOfQuery(result) }
        },
      }),
    )
  }
  if (!difyOn && disposeDify) {
    disposeDify()
    disposeDify = undefined
  }

  const chartOn = Boolean(state.connectors['mcp-chart']?.enabled)
  if (chartOn && !disposeChart) {
    disposeChart = ctx.tools.register(
      defineTool({
        name: 'zr_esc_mcp_chart',
        description:
          '【ESC·AntV 图表 MCP】仅在面板已启用「AntV 图表 MCP」时调用。' +
          '对应 ModelScope @antvis/mcp-server-chart。labels 与 values 必须来自 MES 工具返回，数量一致。' +
          'chart_type：bar | column | line | pie | area | funnel | radar | dual-axes。' +
          '一次 PCB 运营分析必须调用 3～5 次、类型尽量不重复；dual-axes 时 values=实际、values2=计划。',
        parameters: {
          chart_type: {
            type: 'string',
            required: true,
            description: 'bar | column | line | pie | area | funnel | radar | dual-axes',
          },
          title: { type: 'string', required: true, description: '图表标题，不超过 80 字' },
          labels: {
            type: 'string',
            required: true,
            description: '分类，英文逗号分隔，例如 贴片,焊接,AOI',
          },
          values: {
            type: 'string',
            required: true,
            description: '数值，英文逗号分隔，与 labels 等长',
          },
          values2: {
            type: 'string',
            required: true,
            description: '仅 dual-axes 第二轴数值，与 labels 等长；其它类型传空字符串',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: { summary: { type: 'string' } },
          },
          render: (_args, value) => textBlocks(value.summary),
        },
        async execute(args, exec?: ExecCtx) {
          const blocked = sceneBlocksConnector(exec, 'mcp-chart')
          if (blocked) return { summary: blocked }
          const row = loadState(loadConfig().dataRoot).connectors['mcp-chart']
          const title = String(args.title || '')
          const result = await renderChart(
            row,
            String(args.chart_type || ''),
            title,
            String(args.labels || ''),
            String(args.values || ''),
            String(args.values2 || ''),
          )
          return { summary: summaryOfChart(title, result) }
        },
      }),
    )
  }
  if (!chartOn && disposeChart) {
    disposeChart()
    disposeChart = undefined
  }

  const wecomOn = Boolean(state.connectors['mcp-wecom']?.enabled)
  if (wecomOn && !disposeWecom) {
    disposeWecom = ctx.tools.register(
      defineTool({
        name: 'zr_esc_wecom_send',
        description:
          '【ESC·企微群】仅在面板已启用「企微群机器人」后调用。' +
          '是否允许外发只认面板启用/选用场景卡，禁止把用户原话或「发送」二字当授权。' +
          '正文用 Markdown。定时推送仍走自动化插件。',
        parameters: {
          markdown: { type: 'string', required: true, description: '要发送的 Markdown 正文，不超过 4000 字' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: { summary: { type: 'string' } },
          },
          render: (_args, value) => textBlocks(value.summary),
        },
        async execute(args, exec?: ExecCtx) {
          const blocked = sceneBlocksConnector(exec, 'mcp-wecom')
          if (blocked) return { summary: blocked }
          const row = loadState(loadConfig().dataRoot).connectors['mcp-wecom']
          return { summary: summaryOfQuery(await sendWecom(row, String(args.markdown || ''))) }
        },
      }),
    )
  }
  if (!wecomOn && disposeWecom) {
    disposeWecom()
    disposeWecom = undefined
  }

  const feishuOn = Boolean(state.connectors['mcp-feishu']?.enabled)
  if (feishuOn && !disposeFeishu) {
    disposeFeishu = ctx.tools.register(
      defineTool({
        name: 'zr_esc_feishu_wiki',
        description:
          '【ESC·飞书知识库】仅在面板已启用「飞书知识库」后调用。' +
          '是否允许写入只认面板启用/选用场景卡，禁止把用户原话当授权。' +
          'parent 必须是 /wiki/ 链接或节点 token。自动化任务定时落库不要用本工具。',
        parameters: {
          title: { type: 'string', required: true, description: '文档标题' },
          markdown: { type: 'string', required: true, description: 'Markdown 正文' },
          parent: { type: 'string', required: true, description: '知识库父页面 /wiki/… 链接或节点 token' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: { summary: { type: 'string' } },
          },
          render: (_args, value) => textBlocks(value.summary),
        },
        async execute(args, exec?: ExecCtx) {
          const blocked = sceneBlocksConnector(exec, 'mcp-feishu')
          if (blocked) return { summary: blocked }
          const row = loadState(loadConfig().dataRoot).connectors['mcp-feishu']
          return {
            summary: summaryOfQuery(
              await writeFeishuWiki(row, String(args.title || ''), String(args.markdown || ''), String(args.parent || '')),
            ),
          }
        },
      }),
    )
  }
  if (!feishuOn && disposeFeishu) {
    disposeFeishu()
    disposeFeishu = undefined
  }

  const webOn = Boolean(state.connectors['mcp-web-read']?.enabled)
  if (webOn && !disposeWebRead) {
    disposeWebRead = ctx.tools.register(
      defineTool({
        name: 'zr_esc_web_read',
        description:
          '【ESC·网页阅读】仅在面板已启用「网页与规范阅读」时调用。把公开 URL（IPC 规范、规格书、客诉 PDF）转成 Markdown。' +
          '禁止内网/本机地址。不要用来代替 MES 取数。',
        parameters: {
          url: { type: 'string', required: true, description: 'https 公开链接' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: { summary: { type: 'string' } },
          },
          render: (_args, value) => textBlocks(value.summary),
        },
        async execute(args, exec?: ExecCtx) {
          const blocked = sceneBlocksConnector(exec, 'mcp-web-read')
          if (blocked) return { summary: blocked }
          const row = loadState(loadConfig().dataRoot).connectors['mcp-web-read']
          return { summary: summaryOfQuery(await readPublicUrl(row, String(args.url || ''))) }
        },
      }),
    )
  }
  if (!webOn && disposeWebRead) {
    disposeWebRead()
    disposeWebRead = undefined
  }
}

export function apply(ctx: Context) {
  registerHarnessHandlers()
  registerPromptHooks(ctx as unknown as { on: (name: string, listener: (...args: never[]) => unknown) => unknown })
  setOnStateChange(() => syncConnectorTools(ctx))
  void startServer()
    .then((out) => {
      console.log(`[esc] ${out.detail}`)
      syncConnectorTools(ctx)
    })
    .catch((err) => {
      console.warn(`[esc] 启动失败：${String(err)}`)
    })
  syncConnectorTools(ctx)

  ctx.tools.register(
    defineTool({
      name: 'zr_esc_list',
      description:
        '【列出 ESC 专家/技能/连接器】仅当用户问当前专家、已启用技能、连接器是否打开、或要看精选场景时调用。' +
        '不要用于 MES 查数或写码。参数 ignore 传空字符串。',
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
      async execute(_args, exec?: ExecCtx) {
        const cfg = loadConfig()
        const catalog = loadCatalog()
        const state = loadState(cfg.dataRoot)
        const sid = sessionIdOf(exec)
        const expertId = resolveExpertId(state, sid)
        const expert = expertId ? getExpert(expertId) : null
        const sess = sid ? state.sessions[sid] : undefined
        const skills = catalog.skills
          .map((s) => `${s.name}${state.skills[s.id]?.enabled ? '（开）' : '（关）'}`)
          .join('、')
        const conns = Object.entries(state.connectors)
          .map(([id, row]) => `${id}:${row.enabled ? '开' : '关'}/${row.mode}`)
          .join('、')
        const scenes = publicScenes(cfg.dataRoot)
          .map((s) => `${s.title}（${s.id}${s.source === 'user' ? '·自建' : ''}）`)
          .join('、')
        return {
          summary: [
            `请到左侧栏「专家·技能·连接器」管理，或在对话输入框旁添加场景卡。本机服务：${isServerRunning() ? '已监听' : '未监听'} ${getListenAddr() || publicConfigView(cfg).addr}`,
            `当前专家：${expert ? `${expert.title}（${expert.id}）` : '未选择（与 mes_pcb 并存，工艺闲聊可走现网 mes_pcb）'}`,
            `本会话场景卡：${sess?.sceneId || '未绑定（用面板默认）'}`,
            `技能：${skills || '无'}`,
            `连接器：${conns || '无'}`,
            `场景卡：${scenes}`,
          ].join('\n'),
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'zr_esc_select_expert',
      description:
        '【选择或清除当前会话专家】仅当用户明确要切换/指定/清除 ESC 专家角色时调用。' +
        'expertId 必须是目录中的 id，如 pcb-data-analyst、after-sales-expert、test-expert、pcb-process-advisor、req-analyst、pm-assistant。' +
        '清除时 expertId 传空字符串。禁止根据用户正文里的「取消」二字自行清除。',
      parameters: {
        expertId: {
          type: 'string',
          required: true,
          description: '专家 id；传空字符串表示清除本会话专家',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { summary: { type: 'string' } },
        },
        render: (_args, value) => textBlocks(value.summary),
      },
      async execute(args, exec?: ExecCtx) {
        const id = String(args.expertId || '').trim()
        const cfg = loadConfig()
        const sid = sessionIdOf(exec)
        if (!id) {
          if (sid) await clearSessionScene(cfg.dataRoot, sid)
          else await setActiveExpert(cfg.dataRoot, null)
          return { summary: '已清除当前专家与本会话场景卡。下一轮不再注入该人设。' }
        }
        const expert = getExpert(id)
        if (!expert) return { summary: `未知专家 id「${id}」。请先 zr_esc_list。` }
        if (sid) {
          const prev = loadState(cfg.dataRoot).sessions[sid]
          const keep = prev?.sceneId && getAnyScene(cfg.dataRoot, prev.sceneId)?.expertId === id
          await setSessionOverride(cfg.dataRoot, sid, {
            expertId: id,
            sceneId: keep ? prev.sceneId : null,
            skillIds: keep ? prev.skillIds : [],
            connectorIds: keep ? prev.connectorIds : [],
            pinnedSkillId: keep ? prev.pinnedSkillId : null,
          })
        } else await setActiveExpert(cfg.dataRoot, id)
        return { summary: `本会话专家已设为「${expert.title}」（${expert.id}）。` }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'zr_esc_apply_scene',
      description:
        '【把场景卡绑到本会话】仅当用户明确要使用/切换/添加某张 ESC 场景卡时调用。' +
        'sceneId 必须是目录中的 id。传空字符串表示清除本会话场景卡。禁止根据用户正文里的「取消」自行清除。',
      parameters: {
        sceneId: {
          type: 'string',
          required: true,
          description: '场景卡 id；传空字符串表示清除本会话绑定',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { summary: { type: 'string' } },
        },
        render: (_args, value) => textBlocks(value.summary),
      },
      async execute(args, exec?: ExecCtx) {
        const id = String(args.sceneId || '').trim()
        const cfg = loadConfig()
        const sid = sessionIdOf(exec)
        if (!id) {
          if (sid) await clearSessionScene(cfg.dataRoot, sid)
          else await setActiveExpert(cfg.dataRoot, null)
          return { summary: '已清除本会话场景卡。' }
        }
        const scene = getAnyScene(cfg.dataRoot, id)
        if (!scene) return { summary: `未知场景卡「${id}」。请先 zr_esc_list。` }
        try {
          if (!sid) {
            await summonScene(cfg.dataRoot, id)
            return { summary: `已召唤场景卡「${scene.title}」。请在对话输入框旁点「选用场景卡」绑到本会话。` }
          }
          await applyScene(cfg.dataRoot, id, sid)
        } catch (e) {
          return { summary: e instanceof Error ? e.message : String(e) }
        }
        return {
          summary: `本会话已绑定场景卡「${scene.title}」。整段对话按 1 专家 / 最多 3 技能 / 最多 3 连接器 生效。`,
        }
      },
    }),
  )

  console.log('[esc] 插件已加载：zr_esc_list / zr_esc_select_expert / zr_esc_apply_scene；连接器工具按启用态注册')
}
