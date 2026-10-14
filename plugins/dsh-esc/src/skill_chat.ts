/**
 * 对话中创建自建技能：解析 Agent 工具入参 → 落盘（可选用）。
 * 与豆包 / WorkBuddy 一致：主入口在对话，不进侧栏表单。
 */
import { createUserSkill, UserAssetError, type UserSkillInput } from './user_assets.js'
import { setSkillEnabled } from './store.js'
import { loadCatalog } from './catalog.js'

function splitCsv(raw: string): string[] {
  return String(raw || '')
    .split(/[,，、;；\n]/)
    .map((x) => x.trim())
    .filter(Boolean)
}

/** 从「帮我创建一个来料异常分析技能」一类话术里抽出名称，避免超长/套话导致创建失败。 */
function normalizeChatSkillName(raw: string): string {
  let s = String(raw || '')
    .replace(/[\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  s = s
    .replace(/^请帮我创建\s*(一个)?\s*ESC\s*技能\s*[：:]\s*/i, '')
    .replace(/^请?帮我(?:创建|新建|做)(?:一个)?/, '')
    .replace(/^(?:创建|新建|做)(?:一个)?/, '')
    .replace(/^ESC\s*技能\s*[：:]?\s*/i, '')
    .replace(/技能$/u, '')
    .trim()
  if (s.length > 20) s = s.slice(0, 20).trim()
  return s
}

function truthyFlag(raw: string, defaultTrue = true): boolean {
  const s = String(raw || '').trim().toLowerCase()
  if (!s) return defaultTrue
  if (['0', 'false', 'no', 'off', '否', '不'].includes(s)) return false
  if (['1', 'true', 'yes', 'on', '是'].includes(s)) return true
  return defaultTrue
}

export type ChatCreateSkillArgs = {
  name?: string
  description?: string
  body?: string
  triggers?: string
  requiredConnectorIds?: string
  optionalConnectorIds?: string
  category?: string
  enable?: string
}

export type ChatCreateSkillResult = {
  ok: boolean
  code?: string
  summary: string
  skillId?: string
  enabled?: boolean
}

/** 供 zr_esc_create_skill 调用。 */
export async function createSkillFromChat(
  dataRoot: string,
  args: ChatCreateSkillArgs,
): Promise<ChatCreateSkillResult> {
  const input: UserSkillInput = {
    name: normalizeChatSkillName(String(args.name || '')),
    description: String(args.description || ''),
    body: String(args.body || ''),
    triggers: splitCsv(String(args.triggers || '')),
    requiredConnectorIds: splitCsv(String(args.requiredConnectorIds || '')),
    optionalConnectorIds: splitCsv(String(args.optionalConnectorIds || '')),
    category: String(args.category || '').trim() || '自建',
  }
  const enable = truthyFlag(String(args.enable || ''), true)
  try {
    const skill = createUserSkill(dataRoot, input)
    if (enable) await setSkillEnabled(dataRoot, skill.id, true)
    const connHint =
      skill.requiredConnectorIds.length || skill.optionalConnectorIds.length
        ? `连接器：必选 ${skill.requiredConnectorIds.join('、') || '无'}；可选 ${skill.optionalConnectorIds.join('、') || '无'}。`
        : '未绑定连接器（纯手册技能）。'
    return {
      ok: true,
      skillId: skill.id,
      enabled: enable,
      summary: [
        `已创建自建技能「${skill.name}」（id=${skill.id}）${enable ? '，并已启用' : '，未启用（可在侧栏「我创建的」点 +）'}。`,
        `说明：${skill.description}`,
        `触发词：${skill.triggers.join('、') || '无（可靠启用后手动点选 / 场景卡）'}`,
        connHint,
        '可在左侧栏「专家·技能·连接器 → 技能 → 我创建的」查看；要改手册可说「帮我改这个技能」或去详情里编辑。',
      ].join('\n'),
    }
  } catch (e) {
    if (e instanceof UserAssetError) {
      const catalog = loadCatalog(dataRoot)
      const connIds = catalog.connectors.map((c) => c.id).join('、')
      let tip = e.message
      if (e.code === 'unknown_connector') {
        tip += `。可用连接器 id：${connIds || '无'}`
      }
      return { ok: false, code: e.code, summary: `创建失败：${tip}` }
    }
    return { ok: false, code: 'create_failed', summary: `创建失败：${e instanceof Error ? e.message : String(e)}` }
  }
}
