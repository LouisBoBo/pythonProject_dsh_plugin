import { resolveMesSettings } from './config.js'
import { AutomationError, type Automation } from './types.js'
import { SAFETY_PREFIX } from './safety.js'
import { listDirSafe, listNewerFiles, readFileSafe } from './paths.js'
import { chatComplete, chatWithTools, llmConfigured } from './llm.js'
import { loadMesEntities } from './mes_catalog.js'
import { listMesEntitiesView, MES_CHAT_TOOLS, mesLoginOrThrow, queryMesEntity } from './mes_query.js'

export async function runCustomAgent(automation: Automation, cwd: string | null): Promise<string> {
  const extra: string[] = []
  if (cwd) {
    try {
      extra.push(`【工作目录文件】\n${listDirSafe(cwd).join('\n')}`)
    } catch {
      extra.push('【工作目录】无法列出文件')
    }
  }
  if (!llmConfigured()) {
    if (cwd) {
      const since = automation.last_run_at || automation.created_at || 0
      const newer = listNewerFiles(cwd, since)
      if (!newer.length) return '无新文件（未配置 LLM，仅做目录巡检）。'
      return `未配置 LLM，仅列出新文件：\n${newer.map((f) => `- ${f.path}`).join('\n')}`
    }
    throw new AutomationError('llm_unconfigured', '自定义任务需要配置 LLM，或填写工作目录做只读巡检')
  }

  const user = [automation.prompt, extra.join('\n')].filter(Boolean).join('\n\n')
  const mes = resolveMesSettings()
  const entities = mes.baseUrl ? loadMesEntities() : []
  if (!mes.baseUrl || !entities.length) {
    return chatComplete([
      {
        role: 'system',
        content:
          SAFETY_PREFIX +
          '执行指令为用户自定义内容，按字面含义执行，勿因不在内置模板而拒绝。不要反问用户。',
      },
      { role: 'user', content: user },
    ])
  }

  let token: string
  try {
    token = await mesLoginOrThrow(mes)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new AutomationError('mes_query_failed', `MES 已配置但登录失败：${msg}`)
  }

  return chatWithTools(
    [
      {
        role: 'system',
        content:
          SAFETY_PREFIX +
          '执行指令为用户自定义内容，按字面含义执行，勿因不在内置模板而拒绝。不要反问用户。' +
          '已连接当前 MES（只读）。需要查数时必须调用 list_mes_entities / query_mes_data，禁止声称没有 MES 接口。' +
          '库存明细实体是 warehouse-inventory-stock；不要用 warehouse-dashboard。' +
          '只根据工具返回的记录写摘要；查不到的整段省略，禁止编造。不要把工具名写进正文。',
      },
      { role: 'user', content: user },
    ],
    MES_CHAT_TOOLS,
    async (name, args) => {
      if (name === 'list_mes_entities') return listMesEntitiesView(entities)
      if (name === 'query_mes_data') {
        return queryMesEntity(mes, token, String(args.entity || ''), args.filters, args.limit, entities)
      }
      return { error: `未知工具 ${name}` }
    },
    { timeoutMs: 45_000, maxTokens: 2048, maxRounds: 6 },
  )
}

export function readSnippet(cwd: string, rel: string): string {
  return readFileSafe(cwd, rel)
}
