/** 只读本机自建专家/技能目录，供 catalog 合并；无 store/scenes 依赖。 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ExpertMeta, SkillMeta } from './types.js'
import { USER_TRIGGER_MAX } from './types.js'
import { parseFrontMatter, strList } from './util.js'

export function userExpertsRoot(dataRoot: string): string {
  return join(dataRoot, 'user-experts')
}

export function userSkillsRoot(dataRoot: string): string {
  return join(dataRoot, 'user-skills')
}

function parseExpertFile(path: string): ExpertMeta | null {
  if (!existsSync(path)) return null
  const raw = readFileSync(path, 'utf8')
  const { meta, body } = parseFrontMatter(raw)
  const id = String(meta.id || '').trim()
  if (!id.startsWith('user-')) return null
  return {
    id,
    title: String(meta.title || id),
    role: String(meta.role || ''),
    author: String(meta.author || '本机自建'),
    avatar:
      String(meta.avatar || '').trim() ||
      `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(id)}&backgroundColor=e0e7ff`,
    tags: strList(meta.tags),
    preferredSkillIds: strList(meta.preferredSkillIds),
    preferredConnectorIds: strList(meta.preferredConnectorIds),
    body,
    source: 'user',
  }
}

function parseSkillFile(path: string): SkillMeta | null {
  if (!existsSync(path)) return null
  const raw = readFileSync(path, 'utf8')
  const { meta, body } = parseFrontMatter(raw)
  const id = String(meta.id || '').trim()
  if (!id.startsWith('user-')) return null
  return {
    id,
    name: String(meta.name || id),
    description: String(meta.description || ''),
    category: String(meta.category || '自建'),
    icon:
      String(meta.icon || '').trim() ||
      `https://api.dicebear.com/9.x/icons/svg?seed=${encodeURIComponent(id)}&backgroundColor=dbeafe`,
    triggers: strList(meta.triggers).slice(0, USER_TRIGGER_MAX),
    requiredConnectorIds: strList(meta.requiredConnectorIds),
    optionalConnectorIds: strList(meta.optionalConnectorIds),
    body,
    source: 'user',
  }
}

export function loadUserExperts(dataRoot: string): ExpertMeta[] {
  const root = userExpertsRoot(dataRoot)
  if (!existsSync(root)) return []
  const out: ExpertMeta[] = []
  for (const name of readdirSync(root, { withFileTypes: true })) {
    if (!name.isDirectory()) continue
    const expert = parseExpertFile(join(root, name.name, 'EXPERT.md'))
    if (expert) out.push(expert)
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

export function loadUserSkills(dataRoot: string): SkillMeta[] {
  const root = userSkillsRoot(dataRoot)
  if (!existsSync(root)) return []
  const out: SkillMeta[] = []
  for (const name of readdirSync(root, { withFileTypes: true })) {
    if (!name.isDirectory()) continue
    const skill = parseSkillFile(join(root, name.name, 'SKILL.md'))
    if (skill) out.push(skill)
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}
