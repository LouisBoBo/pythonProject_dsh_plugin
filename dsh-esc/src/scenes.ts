import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { getExpert, getSkill, loadCatalog, type Catalog } from './catalog.js'
import type { EscState, SceneIssue, SceneMeta, SceneReview } from './types.js'
import { SCENE_MAX_CONNECTORS, SCENE_MAX_SKILLS, USER_SCENE_MAX } from './types.js'
import { writeJsonAtomic } from './util.js'

export { SCENE_MAX_CONNECTORS, SCENE_MAX_SKILLS, USER_SCENE_MAX }

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

export function comboKey(expertId: string, skillIds: string[], connectorIds: string[]): string {
  return [expertId.trim(), unique(skillIds).slice().sort().join(','), unique(connectorIds).slice().sort().join(',')].join('|')
}

function issue(level: SceneIssue['level'], code: string, message: string): SceneIssue {
  return { level, code, message }
}

export function userScenesPath(dataRoot: string): string {
  return join(dataRoot, 'user-scenes.json')
}

export function loadUserScenes(dataRoot: string): SceneMeta[] {
  const path = userScenesPath(dataRoot)
  if (!existsSync(path)) return []
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (!Array.isArray(raw)) return []
    const out: SceneMeta[] = []
    for (const row of raw) {
      if (!row || typeof row !== 'object') continue
      const r = row as Record<string, unknown>
      const id = String(r.id || '').trim()
      const expertId = String(r.expertId || '').trim()
      const title = String(r.title || '').trim()
      if (!id.startsWith('user-') || !expertId || !title) continue
      out.push({
        id,
        title,
        description: String(r.description || '').trim(),
        expertId,
        skillIds: unique(Array.isArray(r.skillIds) ? r.skillIds.map((x) => String(x)) : []),
        connectorIds: unique(Array.isArray(r.connectorIds) ? r.connectorIds.map((x) => String(x)) : []),
        source: 'user',
      })
    }
    return out
  } catch {
    return []
  }
}

function persistUserScenes(dataRoot: string, scenes: SceneMeta[]): SceneMeta[] {
  writeJsonAtomic(userScenesPath(dataRoot), scenes)
  return scenes
}

export function listScenes(dataRoot: string): SceneMeta[] {
  const builtin = loadCatalog().scenes.map((s) => ({ ...s, source: 'builtin' as const }))
  return [...builtin, ...loadUserScenes(dataRoot)]
}

export function getAnyScene(dataRoot: string, id: string): SceneMeta | null {
  const key = String(id || '').trim()
  if (!key) return null
  return listScenes(dataRoot).find((s) => s.id === key) || null
}

export function publicScenes(dataRoot: string): SceneMeta[] {
  return listScenes(dataRoot)
}

export function reviewSceneCombo(
  expertId: string,
  skillIds: string[],
  connectorIds: string[],
  opts?: { catalog?: Catalog; existing?: SceneMeta[]; ignoreSceneId?: string },
): SceneReview {
  const catalog = opts?.catalog || loadCatalog()
  const skills = unique(skillIds)
  const connectors = unique(connectorIds)
  const errors: SceneIssue[] = []
  const warnings: SceneIssue[] = []
  const expert = getExpert(expertId)

  if (!String(expertId || '').trim()) {
    errors.push(issue('error', 'missing_expert', '必须选 1 位专家。场景卡不能没有人设。'))
  } else if (!expert) {
    errors.push(issue('error', 'unknown_expert', `未知专家：${expertId}`))
  }

  if (skills.length > SCENE_MAX_SKILLS) {
    errors.push(issue('error', 'too_many_skills', `技能最多 ${SCENE_MAX_SKILLS} 个，当前 ${skills.length} 个。请删到 ${SCENE_MAX_SKILLS} 个以内。`))
  }
  if (connectors.length > SCENE_MAX_CONNECTORS) {
    errors.push(
      issue('error', 'too_many_connectors', `连接器最多 ${SCENE_MAX_CONNECTORS} 个，当前 ${connectors.length} 个。请删到 ${SCENE_MAX_CONNECTORS} 个以内。`),
    )
  }

  for (const id of skills) {
    if (!getSkill(id)) errors.push(issue('error', 'unknown_skill', `未知技能：${id}`))
  }
  for (const id of connectors) {
    if (!catalog.connectors.some((c) => c.id === id)) {
      errors.push(issue('error', 'unknown_connector', `未知连接器：${id}`))
    }
  }

  if (!skills.length) {
    warnings.push(issue('warning', 'no_skill', '没有技能。对话只会带专家口吻，没有 SOP 手册，复杂任务容易跑偏。'))
  }

  const connSet = new Set(connectors)
  for (const id of skills) {
    const skill = getSkill(id)
    if (!skill) continue
    const missing = skill.requiredConnectorIds.filter(
      (cid) => cid && catalog.connectors.some((c) => c.id === cid) && !connSet.has(cid),
    )
    if (missing.length) {
      errors.push(
        issue(
          'error',
          'missing_required_connector',
          `技能「${skill.name}」需要连接器 ${missing.join('、')}，否则取数步骤会失败、不能编造数据。请勾上后再保存。`,
        ),
      )
    }
    for (const cid of skill.optionalConnectorIds) {
      if (!connSet.has(cid)) {
        const title = catalog.connectors.find((c) => c.id === cid)?.title || cid
        warnings.push(issue('warning', 'missing_optional_connector', `技能「${skill.name}」建议加上「${title}」，没有也能用，只是能力变弱。`))
      }
    }
    if (expert && expert.preferredSkillIds.length && !expert.preferredSkillIds.includes(id)) {
      warnings.push(
        issue('warning', 'skill_not_preferred', `「${skill.name}」不太适合「${expert.title}」，建议去掉。`),
      )
    }
  }

  if (expert) {
    for (const cid of connectors) {
      const needed = skills.some((sid) => {
        const skill = getSkill(sid)
        return Boolean(skill && (skill.requiredConnectorIds.includes(cid) || skill.optionalConnectorIds.includes(cid)))
      })
      const preferred = expert.preferredConnectorIds.includes(cid)
      if (!needed && !preferred) {
        const title = catalog.connectors.find((c) => c.id === cid)?.title || cid
        warnings.push(issue('warning', 'connector_unused', `连接器「${title}」与当前专家/技能没有对应关系，加了也多半调不到，建议去掉。`))
      }
    }
  }

  const existing = opts?.existing || []
  const key = comboKey(expertId, skills, connectors)
  const dup = existing.find((s) => s.id !== opts?.ignoreSceneId && comboKey(s.expertId, s.skillIds, s.connectorIds) === key)
  if (dup) {
    errors.push(issue('error', 'duplicate_combo', `与已有场景卡「${dup.title}」组合相同，请直接召唤那张卡，不要再造一张。`))
  }

  return { ok: errors.length === 0, errors, warnings }
}

export function suggestCombo(
  state: EscState,
  dataRoot?: string,
): {
  expertId: string
  skillIds: string[]
  connectorIds: string[]
  truncated: boolean
  matchesSceneId: string | null
} | null {
  const expertId = state.activeExpertId
  if (!expertId || !getExpert(expertId)) return null
  if (state.activeSceneId && dataRoot) {
    const scene = getAnyScene(dataRoot, state.activeSceneId)
    if (scene && scene.expertId === expertId) {
      return {
        expertId,
        skillIds: [...scene.skillIds],
        connectorIds: [...scene.connectorIds],
        truncated: false,
        matchesSceneId: scene.id,
      }
    }
  }
  const expert = getExpert(expertId)
  const enabledSkills = Object.entries(state.skills)
    .filter(([, v]) => v.enabled)
    .map(([id]) => id)
    .filter((id) => getSkill(id))
  const preferred = (expert?.preferredSkillIds || []).filter((id) => enabledSkills.includes(id))
  const rest = enabledSkills.filter((id) => !preferred.includes(id))
  const pickedSkills = unique([...preferred, ...rest])
  const truncatedSkills = pickedSkills.length > SCENE_MAX_SKILLS
  const skillIds = pickedSkills.slice(0, SCENE_MAX_SKILLS)

  const enabledConns = Object.entries(state.connectors)
    .filter(([, v]) => v.enabled)
    .map(([id]) => id)
  const required: string[] = []
  const optional: string[] = []
  for (const sid of skillIds) {
    const skill = getSkill(sid)
    if (!skill) continue
    required.push(...skill.requiredConnectorIds)
    optional.push(...skill.optionalConnectorIds)
  }
  const preferredConn = expert?.preferredConnectorIds || []
  const pickedConn = unique([...required, ...preferredConn, ...optional, ...enabledConns]).filter((id) => enabledConns.includes(id))
  const truncatedConn = pickedConn.length > SCENE_MAX_CONNECTORS
  const connectorIds = pickedConn.slice(0, SCENE_MAX_CONNECTORS)
  return { expertId, skillIds, connectorIds, truncated: truncatedSkills || truncatedConn, matchesSceneId: null }
}

export function createUserScene(
  dataRoot: string,
  input: { title: string; description?: string; expertId: string; skillIds: string[]; connectorIds: string[] },
): { scene: SceneMeta; review: SceneReview } {
  const title = String(input.title || '').trim()
  const expertId = String(input.expertId || '').trim()
  const skillIds = unique(input.skillIds)
  const connectorIds = unique(input.connectorIds)
  const existing = listScenes(dataRoot)
  const review = reviewSceneCombo(expertId, skillIds, connectorIds, { existing })
  if (!title) {
    review.ok = false
    review.errors.unshift(issue('error', 'empty_title', '请填写场景卡名称。'))
  }
  const users = loadUserScenes(dataRoot)
  if (users.length >= USER_SCENE_MAX) {
    review.ok = false
    review.errors.push(issue('error', 'too_many_user_scenes', `自建场景卡最多 ${USER_SCENE_MAX} 张（精专不在多）。请先删掉不用的再创建。`))
  }
  if (!review.ok) {
    throw Object.assign(new Error(review.errors.map((e) => e.message).join('；')), { review })
  }
  const expert = getExpert(expertId)
  const description =
    String(input.description || '').trim() ||
    `召唤${expert?.title || expertId}，搭配 ${skillIds.map((id) => getSkill(id)?.name || id).join('、') || '无人手册'}，连接 ${connectorIds.join('、') || '无'}。`
  const scene: SceneMeta = {
    id: `user-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`,
    title,
    description,
    expertId,
    skillIds,
    connectorIds,
    source: 'user',
  }
  persistUserScenes(dataRoot, [...users, scene])
  return { scene, review }
}

export function deleteUserScene(dataRoot: string, id: string): boolean {
  const key = String(id || '').trim()
  if (!key.startsWith('user-')) throw new Error('公司预制场景卡不能删除')
  const users = loadUserScenes(dataRoot)
  const next = users.filter((s) => s.id !== key)
  if (next.length === users.length) throw new Error('未找到该自建场景卡')
  persistUserScenes(dataRoot, next)
  return true
}

export function sceneLabel(scene: SceneMeta): string {
  return scene.title
}
