import { randomUUID } from 'node:crypto'
import { getExpert, getSkill, loadCatalog } from './catalog.js'
import { loadConfig } from './config.js'
import { loadState, resolveConnectorPool, resolveExpertId, resolvePinnedSkillId, resolveSceneId, resolveSkillPool } from './store.js'
import { truncate } from './util.js'

const EXPERT_CTX = 'dsh-esc:expert'
const CATALOG_CTX = 'dsh-esc:skill-catalog'
const SKILL_PLUGIN = 'dsh-esc'

type TextBlock = { type: string; text?: string }
type MessageLike = {
  id: string
  role: string
  content: TextBlock[]
  source: { kind: string; plugin?: string; form?: string }
}
type AgentLike = { session?: { id?: string } }
type Assembly = {
  contexts: Array<{ name: string; text: string }>
  [key: string]: unknown
}

function userText(messages: MessageLike[]): string {
  const last = [...messages].reverse().find((m) => m.source?.kind === 'user' || m.role === 'user')
  if (!last) return ''
  return last.content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text || '')
    .join('\n')
    .trim()
}

export function matchSkill(userQuery: string, enabledIds: string[], pinnedId: string | null): string | null {
  const catalog = loadCatalog()
  if (pinnedId && enabledIds.includes(pinnedId) && getSkill(pinnedId)) return pinnedId
  const text = userQuery || ''
  if (!text) return null
  let best: { id: string; len: number } | null = null
  for (const skill of catalog.skills) {
    if (!enabledIds.includes(skill.id)) continue
    for (const trigger of skill.triggers) {
      if (!trigger || !text.includes(trigger)) continue
      if (!best || trigger.length > best.len) best = { id: skill.id, len: trigger.length }
    }
  }
  return best ? best.id : null
}

function enabledSkillIds(dataRoot: string, sessionId: string): string[] {
  return resolveSkillPool(loadState(dataRoot), sessionId)
}

export function expertContextText(sessionId: string, dataRoot: string): string {
  const state = loadState(dataRoot)
  const id = resolveExpertId(state, sessionId)
  if (!id) return ''
  const expert = getExpert(id)
  if (!expert) return ''
  const body = truncate(expert.body, 4000)
  const sceneId = resolveSceneId(state, sessionId)
  return [
    `【当前专家】${expert.title}（id=${expert.id}，岗位=${expert.role}）`,
    sceneId ? `【本会话场景卡】${sceneId}。本会话生命周期内只按这张卡的专家/技能/连接器工作，不要改用其它组合。` : '',
    '按该角色的方法论回答。现场工单/良率/OEE/库存等数据必须走已启用的 zr_esc_mes_query，禁止编造数字。',
    '简报表格优先；图表连接器已启用时一次分析出 3～5 张不同类型图，并用 Markdown 插图。结论落到 SMT/DIP/组装/测试。',
    'PCB 工艺闲聊若用户未开本插件专家、且现网有 mes_pcb，不要抢 mes_pcb。',
    '禁止调用写码、提交、部署、审码工具。',
    '',
    body,
  ]
    .filter(Boolean)
    .join('\n')
}

export function skillCatalogText(dataRoot: string, sessionId = ''): string {
  const state = loadState(dataRoot)
  const catalog = loadCatalog()
  const enabled = new Set(resolveSkillPool(state, sessionId))
  const lines = catalog.skills
    .filter((s) => enabled.has(s.id))
    .map((s) => `- ${s.name}（id=${s.id}）：${s.description} 触发：${s.triggers.join('、') || '无'}`)
  if (!lines.length && !resolveSceneId(state, sessionId)) return ''
  const pool = resolveConnectorPool(state, sessionId)
  const connectors = pool
    ? pool.map((id) => {
        const row = state.connectors[id]
        return `${id}(${row?.mode || 'off'})`
      })
    : Object.entries(state.connectors)
        .filter(([, v]) => v.enabled)
        .map(([id, v]) => `${id}(${v.mode})`)
  return truncate(
    [
      '【已启用技能摘要】命中触发短语后会加载全文 SOP。不要同时调用写码/审码工具。',
      ...lines,
      connectors.length
        ? `【已启用连接器】${connectors.join('、')}`
        : '【已启用连接器】无。未启用时不要调用 zr_esc_mes_query / zr_esc_dify_search / zr_esc_mcp_chart / zr_esc_wecom_send / zr_esc_feishu_wiki / zr_esc_web_read。',
    ].join('\n'),
    2000,
  )
}

export function registerPromptHooks(ctx: {
  on: (name: string, listener: (...args: never[]) => unknown) => unknown
}) {
  ctx.on(
    'system-prompt/assemble' as never,
    (async (_assembly: Assembly, context: { agent?: AgentLike }, next: () => Promise<Assembly>) => {
      const transformed = await next()
      const dataRoot = loadConfig().dataRoot
      const sessionId = String(context.agent?.session?.id || '')
      const expert = expertContextText(sessionId, dataRoot)
      const catalog = skillCatalogText(dataRoot, sessionId)
      const contexts = transformed.contexts.filter((item) => item.name !== EXPERT_CTX && item.name !== CATALOG_CTX)
      if (expert) contexts.push({ name: EXPERT_CTX, text: expert })
      if (catalog) contexts.push({ name: CATALOG_CTX, text: catalog })
      return { ...transformed, contexts }
    }) as never,
  )

  ctx.on(
    'agent/pre-step' as never,
    (async (
      payload: { agent?: AgentLike; step?: number; signal?: AbortSignal },
      next: () => Promise<{ kind: string; messages?: MessageLike[] }>,
    ) => {
      const decision = await next()
      if (decision.kind !== 'enter' || payload.step !== 1) return decision
      const messages = (decision.messages || []).filter(
        (m) => !(m.source?.kind === 'plugin' && m.source.plugin === SKILL_PLUGIN && m.source.form === 'skill'),
      )
      const dataRoot = loadConfig().dataRoot
      const sessionId = String(payload.agent?.session?.id || '')
      const enabled = enabledSkillIds(dataRoot, sessionId)
      if (!enabled.length) return { kind: 'enter', messages }
      const pinned = resolvePinnedSkillId(loadState(dataRoot), sessionId)
      const skillId = matchSkill(userText(messages), enabled, pinned)
      if (!skillId) return { kind: 'enter', messages }
      const skill = getSkill(skillId)
      if (!skill) return { kind: 'enter', messages }
      const body = truncate(skill.body, 10000)
      const notice: MessageLike = {
        id: randomUUID(),
        role: 'user',
        content: [
          {
            type: 'text',
            text: `【技能 SOP · ${skill.name}】\n${body}\n\n未配置的连接器返回 error.code 后禁止编造数据。严重质量问题可提示用户使用已安装的 pcb_8d_*，不要假装已写 8D。`,
          },
        ],
        source: { kind: 'plugin', plugin: SKILL_PLUGIN, form: 'skill' },
      }
      return { kind: 'enter', messages: [...messages, notice] }
    }) as never,
  )
}
