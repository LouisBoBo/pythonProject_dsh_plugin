/**
 * 只读加载 WorkBuddy MES 资料包 entities.json（不写回、不发明实体）。
 * 对照 simplified-workbuddy mes_profile.resolve_entities_path。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type MesEntity = {
  id: string
  label: string
  aliases: string[]
  path: string
  ops: string[]
  listKeys: string[]
}

function dataRoots(): string[] {
  const home = homedir()
  const dsh = (process.env.DSH_HOME || '').trim() || join(home, '.dsh')
  const extra = (process.env.WORKBUDDY_DATA_DIR || process.env.DATA_DIR || '').trim()
  const out: string[] = []
  if (extra) out.push(extra)
  out.push(
    join(home, 'Library', 'Application Support', 'zr-workbuddy-desktop', 'data'),
    join(home, 'ai_projects', 'DSH-ZR-WorkBuddy', 'apps', 'zr-workbuddy', 'engine', 'data'),
    join(dsh, 'link', 'DSH-ZR-WorkBuddy', 'apps', 'zr-workbuddy', 'engine', 'data'),
  )
  return out
}

function asStringList(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => String(x || '').trim()).filter(Boolean)
}

function parseEntity(raw: unknown): MesEntity | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const rec = raw as Record<string, unknown>
  const id = String(rec.id || '').trim()
  const path = String(rec.path || '').trim()
  if (!id || !path.startsWith('/api/')) return null
  if (path.includes('..') || path.includes('://') || path.includes('\\') || /[\s?]/.test(path) || path.includes('//', 1)) {
    return null
  }
  const ops = asStringList(rec.ops).map((s) => s.toLowerCase())
  if (ops.length && !ops.includes('query') && !ops.includes('export')) return null
  return {
    id,
    label: String(rec.label || id).trim() || id,
    aliases: asStringList(rec.aliases),
    path,
    ops: ops.length ? ops : ['query'],
    listKeys: asStringList(rec.list_keys),
  }
}

function readEntitiesFile(file: string): MesEntity[] {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as { entities?: unknown }
    const rows = Array.isArray(data.entities) ? data.entities : []
    return rows.map(parseEntity).filter((x): x is MesEntity => Boolean(x))
  } catch {
    return []
  }
}

function profileFiles(root: string): string[] {
  const dir = join(root, 'mes_profiles')
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return []
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const file = join(dir, name, 'entities.json')
    if (existsSync(file) && statSync(file).isFile() && statSync(file).size > 0) out.push(file)
  }
  return out
}

/** 优先含库存明细的资料包；测试可设 WORKBUDDY_DATA_DIR。 */
export function loadMesEntities(): MesEntity[] {
  const files: string[] = []
  for (const root of dataRoots()) files.push(...profileFiles(root))
  let best: MesEntity[] = []
  let bestScore = -1
  for (const file of files) {
    const ents = readEntitiesFile(file)
    if (!ents.length) continue
    const score = ents.some((e) => e.id === 'warehouse-inventory-stock' || e.path.includes('inventory-stock'))
      ? 2
      : 1
    if (score > bestScore) {
      best = ents
      bestScore = score
    }
  }
  return best
}

function norm(s: string): string {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
}

export function resolveMesEntity(query: string, entities = loadMesEntities()): MesEntity | null {
  const q = String(query || '').trim()
  if (!q) return null
  const nq = norm(q)
  let best: MesEntity | null = null
  let bestScore = 0
  for (const ent of entities) {
    const aliases = [ent.id, ent.label, ...ent.aliases].map(norm).filter(Boolean)
    let score = 0
    if (norm(ent.id) === nq) score = 1000
    else if (norm(ent.label) === nq) score = 900
    else if (aliases.includes(nq)) score = 500
    else if (
      nq.length >= 4 &&
      aliases.some((a) => a.length >= 4 && (a.includes(nq) || nq.includes(a)))
    )
      score = 80
    if (!score) continue
    if (ent.id.includes('inventory-stock') || ent.path.includes('inventory-stock')) score += 80
    if (ent.id.includes('dashboard') || ent.path.includes('dashboard')) score -= 60
    if (score > bestScore) {
      best = ent
      bestScore = score
    }
  }
  return best
}
