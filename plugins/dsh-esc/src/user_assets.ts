/**
 * 本机自建专家 / 技能 CRUD：只写 ~/.zhongruan/esc 下手册，不进插件包、不跑脚本。
 */
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { loadCatalog } from './catalog.js'
import { loadUserScenes, persistUserScenes, listScenes } from './scenes.js'
import { loadUserExperts, loadUserSkills, userExpertsRoot, userSkillsRoot } from './user_catalog.js'
import type { ExpertMeta, SkillMeta } from './types.js'
import {
  USER_EXPERT_BODY_MAX,
  USER_EXPERT_MAX,
  USER_SKILL_BODY_MAX,
  USER_SKILL_MAX,
  USER_TRIGGER_MAX,
} from './types.js'
import { ensurePrivateDir, parseFrontMatter, strList } from './util.js'
import { extractSkillMarkdown } from './zip_skill.js'
import { loadState, saveState } from './store.js'

export type UserExpertInput = {
  title: string
  role?: string
  tags?: string[]
  body: string
  preferredSkillIds?: string[]
  preferredConnectorIds?: string[]
  avatar?: string
}

export type UserSkillInput = {
  name: string
  description: string
  category?: string
  icon?: string
  triggers?: string[]
  requiredConnectorIds?: string[]
  optionalConnectorIds?: string[]
  body: string
}

export class UserAssetError extends Error {
  code: string
  sceneIds?: string[]
  constructor(code: string, message: string, sceneIds?: string[]) {
    super(message)
    this.code = code
    this.sceneIds = sceneIds
  }
}

function unique(ids: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of ids) {
    const id = String(raw || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function newUserId(): string {
  return `user-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
}

function assertUserId(id: string, kind: 'expert' | 'skill'): string {
  const key = String(id || '').trim()
  if (!key.startsWith('user-')) {
    throw new UserAssetError(
      'builtin_readonly',
      kind === 'expert' ? '公司预制专家不能修改或删除' : '公司预制/SkillHub 技能不能在此修改或删除',
    )
  }
  if (!/^user-[a-z0-9]+-[a-f0-9]+$/i.test(key)) {
    throw new UserAssetError('invalid_id', '非法自建 id')
  }
  return key
}

function clampTitle(raw: string, label: string, max = 20): string {
  const title = String(raw || '')
    .replace(/[\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!title) throw new UserAssetError('empty_title', `请填写${label}`)
  if (title.length < 2) throw new UserAssetError('empty_title', `${label}至少 2 个字`)
  if (title.length > max) throw new UserAssetError('title_too_long', `${label}最多 ${max} 个字`)
  return title
}

function clampBody(raw: string, max: number, label: string): string {
  const body = String(raw || '').trim()
  if (!body) throw new UserAssetError('empty_body', `请填写${label}`)
  if (body.length > max) throw new UserAssetError('body_too_large', `${label}最多 ${max} 字，当前 ${body.length} 字`)
  return body
}

function yamlScalar(v: string): string {
  const s = String(v || '').replace(/\r?\n/g, ' ').trim()
  if (!s) return '""'
  if (/[:#{}[\],&*?|<>=!%@`'"\\]/.test(s) || /^\s|\s$/.test(s)) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return s
}

function writeFrontMatter(meta: Record<string, string | string[]>, body: string): string {
  const lines = ['---']
  for (const [k, v] of Object.entries(meta)) {
    if (Array.isArray(v)) {
      if (!v.length) lines.push(`${k}: []`)
      else {
        lines.push(`${k}:`)
        for (const item of v) lines.push(`  - ${yamlScalar(item)}`)
      }
    } else {
      lines.push(`${k}: ${yamlScalar(v)}`)
    }
  }
  lines.push('---', '', body.trim(), '')
  return lines.join('\n')
}

function filterKnownIds(ids: string[], allowed: Set<string>): string[] {
  return unique(ids).filter((id) => allowed.has(id))
}

function connectorIdSet(dataRoot: string): Set<string> {
  return new Set(loadCatalog(dataRoot).connectors.map((c) => c.id))
}

function skillIdSet(dataRoot: string): Set<string> {
  return new Set(loadCatalog(dataRoot).skills.map((s) => s.id))
}

function writeExpertDisk(dataRoot: string, expert: ExpertMeta): void {
  const dir = join(userExpertsRoot(dataRoot), expert.id)
  ensurePrivateDir(dir)
  const text = writeFrontMatter(
    {
      id: expert.id,
      title: expert.title,
      role: expert.role,
      author: expert.author,
      avatar: expert.avatar,
      tags: expert.tags,
      preferredSkillIds: expert.preferredSkillIds,
      preferredConnectorIds: expert.preferredConnectorIds,
    },
    expert.body,
  )
  writeFileSync(join(dir, 'EXPERT.md'), text, { encoding: 'utf8', mode: 0o600 })
}

function writeSkillDisk(dataRoot: string, skill: SkillMeta): void {
  const dir = join(userSkillsRoot(dataRoot), skill.id)
  ensurePrivateDir(dir)
  const text = writeFrontMatter(
    {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      category: skill.category,
      icon: skill.icon,
      triggers: skill.triggers,
      requiredConnectorIds: skill.requiredConnectorIds,
      optionalConnectorIds: skill.optionalConnectorIds,
    },
    skill.body,
  )
  writeFileSync(join(dir, 'SKILL.md'), text, { encoding: 'utf8', mode: 0o600 })
}

function normalizeExpertInput(dataRoot: string, input: UserExpertInput, id: string): ExpertMeta {
  const title = clampTitle(input.title, '专家名称')
  const body = clampBody(input.body, USER_EXPERT_BODY_MAX, '人设正文')
  const connectors = connectorIdSet(dataRoot)
  const skills = skillIdSet(dataRoot)
  const preferredSkillIds = filterKnownIds(input.preferredSkillIds || [], skills)
  const preferredConnectorIds = filterKnownIds(input.preferredConnectorIds || [], connectors)
  const unknownSkills = unique(input.preferredSkillIds || []).filter((x) => !skills.has(x))
  const unknownConns = unique(input.preferredConnectorIds || []).filter((x) => !connectors.has(x))
  if (unknownSkills.length) throw new UserAssetError('unknown_skill', `未知技能：${unknownSkills.join('、')}`)
  if (unknownConns.length) throw new UserAssetError('unknown_connector', `未知连接器：${unknownConns.join('、')}`)
  const avatar = String(input.avatar || '').trim()
  return {
    id,
    title,
    role: String(input.role || '')
      .replace(/[\r\n]/g, ' ')
      .trim()
      .slice(0, 40),
    author: '本机自建',
    avatar: avatar.startsWith('https://')
      ? avatar.slice(0, 300)
      : `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(id)}&backgroundColor=e0e7ff`,
    tags: unique(input.tags || [])
      .map((t) => t.slice(0, 20))
      .slice(0, 8),
    preferredSkillIds,
    preferredConnectorIds,
    body,
    source: 'user',
  }
}

function normalizeSkillInput(dataRoot: string, input: UserSkillInput, id: string): SkillMeta {
  const name = clampTitle(input.name, '技能名称')
  const description = String(input.description || '')
    .replace(/[\r\n]/g, ' ')
    .trim()
  if (!description) throw new UserAssetError('empty_description', '请填写技能说明')
  if (description.length > 200) throw new UserAssetError('description_too_long', '技能说明最多 200 字')
  const body = clampBody(input.body, USER_SKILL_BODY_MAX, '技能手册')
  const connectors = connectorIdSet(dataRoot)
  const requiredConnectorIds = filterKnownIds(input.requiredConnectorIds || [], connectors)
  const optionalConnectorIds = filterKnownIds(input.optionalConnectorIds || [], connectors).filter(
    (x) => !requiredConnectorIds.includes(x),
  )
  const unknown = unique([...(input.requiredConnectorIds || []), ...(input.optionalConnectorIds || [])]).filter(
    (x) => !connectors.has(x),
  )
  if (unknown.length) throw new UserAssetError('unknown_connector', `未知连接器：${unknown.join('、')}`)
  const triggers = unique(input.triggers || [])
    .map((t) => t.replace(/[\r\n]/g, ' ').trim())
    .filter((t) => t.length >= 2 && t.length <= 32)
    .slice(0, USER_TRIGGER_MAX)
  const icon = String(input.icon || '').trim()
  return {
    id,
    name,
    description,
    category:
      String(input.category || '自建')
        .replace(/[\r\n]/g, ' ')
        .trim()
        .slice(0, 40) || '自建',
    icon: icon.startsWith('https://')
      ? icon.slice(0, 300)
      : `https://api.dicebear.com/9.x/icons/svg?seed=${encodeURIComponent(id)}&backgroundColor=dbeafe`,
    triggers,
    requiredConnectorIds,
    optionalConnectorIds,
    body,
    source: 'user',
  }
}

async function purgeExpertState(dataRoot: string, expertId: string): Promise<void> {
  const state = loadState(dataRoot)
  state.summonedExpertIds = state.summonedExpertIds.filter((x) => x !== expertId)
  if (state.activeExpertId === expertId) {
    state.activeExpertId = null
    state.activeSceneId = null
    state.pinnedSkillId = null
  }
  for (const [sid, sess] of Object.entries(state.sessions)) {
    if (sess.expertId === expertId) {
      state.sessions[sid] = {
        expertId: null,
        sceneId: null,
        pinnedSkillId: null,
        skillIds: [],
        connectorIds: [],
      }
    }
  }
  await saveState(dataRoot, state)
}

async function purgeSkillState(dataRoot: string, skillId: string): Promise<void> {
  const state = loadState(dataRoot)
  if (state.skills[skillId]) delete state.skills[skillId]
  if (state.pinnedSkillId === skillId) state.pinnedSkillId = null
  for (const sess of Object.values(state.sessions)) {
    sess.skillIds = sess.skillIds.filter((x) => x !== skillId)
    if (sess.pinnedSkillId === skillId) sess.pinnedSkillId = sess.skillIds[0] || null
  }
  await saveState(dataRoot, state)
  const users = loadUserScenes(dataRoot)
  let changed = false
  for (const scene of users) {
    const next = scene.skillIds.filter((x) => x !== skillId)
    if (next.length !== scene.skillIds.length) {
      scene.skillIds = next
      changed = true
    }
  }
  if (changed) persistUserScenes(dataRoot, users)
}

export function createUserExpert(dataRoot: string, input: UserExpertInput): ExpertMeta {
  const existing = loadUserExperts(dataRoot)
  if (existing.length >= USER_EXPERT_MAX) {
    throw new UserAssetError('quota_exceeded', `自建专家最多 ${USER_EXPERT_MAX} 位，请先删除不用的再创建`)
  }
  const id = newUserId()
  const expert = normalizeExpertInput(dataRoot, input, id)
  writeExpertDisk(dataRoot, expert)
  return expert
}

export function updateUserExpert(dataRoot: string, id: string, input: UserExpertInput): ExpertMeta {
  const key = assertUserId(id, 'expert')
  const path = join(userExpertsRoot(dataRoot), key, 'EXPERT.md')
  if (!existsSync(path)) throw new UserAssetError('not_found', '未找到该自建专家')
  const expert = normalizeExpertInput(dataRoot, input, key)
  writeExpertDisk(dataRoot, expert)
  return expert
}

export async function deleteUserExpert(dataRoot: string, id: string): Promise<void> {
  const key = assertUserId(id, 'expert')
  const path = join(userExpertsRoot(dataRoot), key, 'EXPERT.md')
  if (!existsSync(path)) throw new UserAssetError('not_found', '未找到该自建专家')
  const used = listScenes(dataRoot).filter((s) => s.expertId === key)
  if (used.length) {
    throw new UserAssetError(
      'expert_in_use',
      `该专家仍被场景卡引用：${used.map((s) => s.title).join('、')}。请先改卡或删卡再删专家。`,
      used.map((s) => s.id),
    )
  }
  await purgeExpertState(dataRoot, key)
  rmSync(join(userExpertsRoot(dataRoot), key), { recursive: true, force: true })
}

export function createUserSkill(dataRoot: string, input: UserSkillInput): SkillMeta {
  const existing = loadUserSkills(dataRoot)
  if (existing.length >= USER_SKILL_MAX) {
    throw new UserAssetError('quota_exceeded', `自建技能最多 ${USER_SKILL_MAX} 个，请先删除不用的再创建`)
  }
  const id = newUserId()
  const skill = normalizeSkillInput(dataRoot, input, id)
  writeSkillDisk(dataRoot, skill)
  return skill
}

export function updateUserSkill(dataRoot: string, id: string, input: UserSkillInput): SkillMeta {
  const key = assertUserId(id, 'skill')
  const path = join(userSkillsRoot(dataRoot), key, 'SKILL.md')
  if (!existsSync(path)) throw new UserAssetError('not_found', '未找到该自建技能')
  const skill = normalizeSkillInput(dataRoot, input, key)
  writeSkillDisk(dataRoot, skill)
  return skill
}

export async function deleteUserSkill(dataRoot: string, id: string): Promise<void> {
  const key = assertUserId(id, 'skill')
  const path = join(userSkillsRoot(dataRoot), key, 'SKILL.md')
  if (!existsSync(path)) throw new UserAssetError('not_found', '未找到该自建技能')
  await purgeSkillState(dataRoot, key)
  rmSync(join(userSkillsRoot(dataRoot), key), { recursive: true, force: true })
}

/** 从 SKILL.md 正文或 zip(base64) 解析出创建入参；缺字段时抛明确 code。 */
export function parseSkillImport(payload: { markdown?: string; zipBase64?: string }): UserSkillInput {
  let text = String(payload.markdown || '').trim()
  if (!text && payload.zipBase64) {
    const buf = Buffer.from(String(payload.zipBase64), 'base64')
    text = extractSkillMarkdown(buf).text
  }
  if (!text) throw new UserAssetError('empty_import', '请提供 SKILL.md 正文或 zip')
  const { meta, body } = parseFrontMatter(text)
  const name = String(meta.name || meta.title || '').trim()
  const description = String(meta.description || '').trim()
  if (!name) throw new UserAssetError('empty_title', 'SKILL.md 缺少 name')
  if (!description) throw new UserAssetError('empty_description', 'SKILL.md 缺少 description')
  if (!body.trim()) throw new UserAssetError('empty_body', 'SKILL.md 正文为空')
  return {
    name,
    description,
    category: String(meta.category || '自建'),
    icon: String(meta.icon || ''),
    triggers: strList(meta.triggers),
    requiredConnectorIds: strList(meta.requiredConnectorIds),
    optionalConnectorIds: strList(meta.optionalConnectorIds),
    body,
  }
}

export function importUserSkill(dataRoot: string, payload: { markdown?: string; zipBase64?: string }): SkillMeta {
  return createUserSkill(dataRoot, parseSkillImport(payload))
}
