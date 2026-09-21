import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ConnectorMeta, ExpertMeta, SceneMeta, SkillMeta } from './types.js'
import { loadInstalledHubSkills } from './skillhub.js'
import { assetsRoot, parseFrontMatter, PLUGIN_VERSION, strList, truncate } from './util.js'

function readDirMarkdown(dir: string, fileName: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(dir, d.name, fileName))
    .filter((p) => existsSync(p))
}

function loadExperts(root: string): ExpertMeta[] {
  const out: ExpertMeta[] = []
  for (const path of readDirMarkdown(join(root, 'experts'), 'EXPERT.md')) {
    const raw = readFileSync(path, 'utf8')
    const { meta, body } = parseFrontMatter(raw)
    const id = String(meta.id || '').trim()
    if (!id) continue
    out.push({
      id,
      title: String(meta.title || id),
      role: String(meta.role || ''),
      author: String(meta.author || '公司预制'),
      avatar: String(meta.avatar || '') || `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(id)}&backgroundColor=f3f4f6`,
      tags: strList(meta.tags),
      preferredSkillIds: strList(meta.preferredSkillIds),
      preferredConnectorIds: strList(meta.preferredConnectorIds),
      body,
    })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

function loadSkills(root: string): SkillMeta[] {
  const out: SkillMeta[] = []
  for (const path of readDirMarkdown(join(root, 'skills'), 'SKILL.md')) {
    const raw = readFileSync(path, 'utf8')
    const { meta, body } = parseFrontMatter(raw)
    const id = String(meta.id || '').trim()
    if (!id) continue
    out.push({
      id,
      name: String(meta.name || id),
      description: String(meta.description || ''),
      category: String(meta.category || '全部'),
      icon: String(meta.icon || ''),
      triggers: strList(meta.triggers),
      requiredConnectorIds: strList(meta.requiredConnectorIds),
      optionalConnectorIds: strList(meta.optionalConnectorIds),
      body,
      source: 'builtin',
    })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

function loadConnectors(root: string): ConnectorMeta[] {
  const dir = join(root, 'connectors')
  if (!existsSync(dir)) return []
  const out: ConnectorMeta[] = []
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const raw = JSON.parse(readFileSync(join(dir, name), 'utf8')) as ConnectorMeta
    if (!raw?.id) continue
    const role: ConnectorMeta['role'] = raw.role === 'sink' || raw.role === 'tool' ? raw.role : 'source'
    out.push({ ...raw, role })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

function loadScenes(root: string): SceneMeta[] {
  const dir = join(root, 'scenes')
  if (!existsSync(dir)) return []
  const out: SceneMeta[] = []
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const raw = JSON.parse(readFileSync(join(dir, name), 'utf8')) as SceneMeta
    if (raw?.id) out.push(raw)
  }
  const order = ['pcb-ops-analysis', 'after-sales-ticket', 'test-case-gen', 'pcb-process-qa']
  return out.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id) || a.id.localeCompare(b.id))
}

export type Catalog = {
  experts: ExpertMeta[]
  skills: SkillMeta[]
  connectors: ConnectorMeta[]
  scenes: SceneMeta[]
}

let cache: Catalog | null = null

function loadBuiltinCatalog(root = assetsRoot()): Catalog {
  if (cache && root === assetsRoot()) return cache
  const catalog: Catalog = {
    experts: loadExperts(root),
    skills: loadSkills(root),
    connectors: loadConnectors(root),
    scenes: loadScenes(root),
  }
  if (root === assetsRoot()) cache = catalog
  return catalog
}

/** dataRoot 有值时合并本机已安装的 SkillHub 技能；自测不传则仍是公司预制 9 条。 */
export function loadCatalog(dataRoot?: string): Catalog {
  const builtin = loadBuiltinCatalog()
  if (!dataRoot) return builtin
  const hub = loadInstalledHubSkills(dataRoot)
  if (!hub.length) return builtin
  return { ...builtin, skills: [...builtin.skills, ...hub] }
}

export function getExpert(id: string): ExpertMeta | null {
  return loadBuiltinCatalog().experts.find((x) => x.id === id) || null
}

export function getSkill(id: string, dataRoot?: string): SkillMeta | null {
  return loadCatalog(dataRoot).skills.find((x) => x.id === id) || null
}

export function getScene(id: string): SceneMeta | null {
  return loadBuiltinCatalog().scenes.find((x) => x.id === id) || null
}

export function publicCatalog(scenes?: SceneMeta[], dataRoot?: string) {
  const c = loadCatalog(dataRoot)
  return {
    experts: c.experts.map((x) => ({
      id: x.id,
      title: x.title,
      role: x.role,
      author: x.author,
      avatar: x.avatar,
      tags: x.tags,
      preferredSkillIds: x.preferredSkillIds,
      preferredConnectorIds: x.preferredConnectorIds,
      preview: x.body.slice(0, 180),
    })),
    pluginVersion: PLUGIN_VERSION,
    skills: c.skills.map((x) => ({
      id: x.id,
      name: x.name,
      description: x.description,
      category: x.category,
      icon: x.icon,
      triggers: x.triggers,
      requiredConnectorIds: x.requiredConnectorIds,
      optionalConnectorIds: x.optionalConnectorIds,
      sop: truncate(x.body, 6000),
      source: x.source || 'builtin',
      slug: x.slug || '',
      version: x.version || '',
      homepage: x.homepage || '',
    })),
    connectors: c.connectors,
    scenes: (scenes || c.scenes.map((s) => ({ ...s, source: 'builtin' as const }))).map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      expertId: s.expertId,
      skillIds: s.skillIds,
      connectorIds: s.connectorIds,
      source: s.source || 'builtin',
    })),
    limits: { maxSkills: 3, maxConnectors: 3, maxUserScenes: 8 },
  }
}
