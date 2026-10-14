/** 按专家人设本地推荐技能；无人设不推荐。 */
import { loadCatalog } from './catalog.js'
import type { SkillMeta } from './types.js'
import { expertIdentityReady, type ExpertBriefInput } from './expert_framework.js'

export type { ExpertBriefInput } from './expert_framework.js'
export { expertIdentityReady } from './expert_framework.js'

export type SkillRec = {
  id: string
  name: string
  score: number
  reason: string
}

function tokensOf(text: string): string[] {
  const raw = String(text || '')
    .toLowerCase()
    .replace(/[^\u4e00-\u9fffa-z0-9]+/g, ' ')
  const parts = raw.split(/\s+/).filter(Boolean)
  const out: string[] = []
  for (const p of parts) {
    if (p.length >= 2) out.push(p)
    if (/[\u4e00-\u9fff]/.test(p) && p.length >= 4) {
      for (let i = 0; i + 2 <= p.length; i += 1) out.push(p.slice(i, i + 2))
    }
  }
  return [...new Set(out)]
}

export function scoreSkillAgainstBrief(input: ExpertBriefInput, skill: SkillMeta): SkillRec | null {
  if (skill.source === 'skillhub') return null
  const bag = tokensOf([input.title, input.role, ...(input.tags || []), input.body].filter(Boolean).join(' '))
  if (!bag.length) return null
  const hay = tokensOf([skill.name, skill.description, skill.category, ...(skill.triggers || [])].join(' '))
  if (!hay.length) return null
  const hit: string[] = []
  let score = 0
  for (const t of bag) {
    if (!hay.includes(t)) continue
    if (['专家', '助手', '分析', '技能', '手册', '公司', '自建'].includes(t)) {
      score += 0.5
      continue
    }
    score += t.length >= 3 ? 2 : 1
    if (hit.length < 4) hit.push(t)
  }
  const title = String(input.title || '').trim()
  if (title.length >= 2 && (skill.name.includes(title) || title.includes(skill.name))) score += 3
  if (score < 2) return null
  return {
    id: skill.id,
    name: skill.name,
    score,
    reason: hit.length ? `与人设关键词相近：${hit.join('、')}` : '与岗位描述相关',
  }
}

export function recommendSkillsForExpert(
  dataRoot: string,
  input: ExpertBriefInput,
  limit = 6,
): {
  ok: boolean
  detail: string
  items: SkillRec[]
} {
  const ready = expertIdentityReady(input)
  if (!ready.ok) return { ok: false, detail: ready.detail, items: [] }
  const catalog = loadCatalog(dataRoot)
  const scored: SkillRec[] = []
  for (const skill of catalog.skills) {
    const row = scoreSkillAgainstBrief(input, skill)
    if (row) scored.push(row)
  }
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  const items = scored.slice(0, Math.max(1, Math.min(limit, 12)))
  if (!items.length) {
    return {
      ok: true,
      detail: '暂无足够匹配的技能，可先不选；保存后也可在场景卡里再搭技能。',
      items: [],
    }
  }
  return { ok: true, detail: `按人设匹配到 ${items.length} 个建议技能（可不选）`, items }
}
