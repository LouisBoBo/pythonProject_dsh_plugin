import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SkillMeta } from './types.js'
import { parseFrontMatter, strList } from './util.js'
import { extractSkillMarkdown } from './zip_skill.js'

export const SKILLHUB_API = 'https://api.skillhub.cn'
export const HUB_ID_PREFIX = 'hub:'
export const MAX_ZIP_BYTES = 8 * 1024 * 1024

export const SKILLHUB_CATEGORIES: Array<{ key: string; label: string }> = [
  { key: 'office-efficiency', label: '办公协同' },
  { key: 'content-creation', label: '内容创作' },
  { key: 'dev-programming', label: '开发工具' },
  { key: 'data-analysis', label: '数据分析' },
  { key: 'design-media', label: '设计多媒体' },
  { key: 'ai-agent', label: 'AI Agent' },
  { key: 'knowledge-management', label: '知识管理' },
  { key: 'business-ops', label: '商业运营' },
  { key: 'education', label: '教育学习' },
  { key: 'professional', label: '行业专业' },
  { key: 'it-ops-security', label: 'IT 运维' },
  { key: 'life-service', label: '生活服务' },
]

const CATEGORY_LABEL = new Map(SKILLHUB_CATEGORIES.map((x) => [x.key, x.label]))

export type HubMarketItem = {
  id: string
  slug: string
  name: string
  description: string
  category: string
  categoryLabel: string
  icon: string
  version: string
  downloads: number
  homepage: string
  installed: boolean
  enabled: boolean
}

export type HubMarketPage = {
  items: HubMarketItem[]
  total: number
  page: number
  pageSize: number
  categories: Array<{ key: string; label: string }>
}

type HubMetaFile = {
  slug: string
  version?: string
  name?: string
  description?: string
  category?: string
  icon?: string
  homepage?: string
}

export function assertSlug(raw: string): string {
  const slug = String(raw || '').trim()
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/.test(slug)) throw new Error('SkillHub slug 非法')
  return slug
}

export function hubSkillId(slug: string): string {
  return `${HUB_ID_PREFIX}${assertSlug(slug)}`
}

export function slugFromSkillId(id: string): string | null {
  const raw = String(id || '')
  if (!raw.startsWith(HUB_ID_PREFIX)) return null
  try {
    return assertSlug(raw.slice(HUB_ID_PREFIX.length))
  } catch {
    return null
  }
}

export function hubRoot(dataRoot: string): string {
  return join(dataRoot, 'skillhub')
}

export function categoryLabel(key: string): string {
  return CATEGORY_LABEL.get(key) || key || 'SkillHub'
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function asNum(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

/** 技能图标/主页只认 https，禁止 javascript:/data: 进 img src。 */
export function publicHttpsUrl(raw: string): string {
  const s = String(raw || '').trim()
  if (!s) return ''
  try {
    const u = new URL(s)
    if (u.protocol !== 'https:') return ''
    return u.href
  } catch {
    return ''
  }
}

async function skillhubGet(pathAndQuery: string, maxBytes: number, timeoutMs: number, follow = false): Promise<Response> {
  const url = new URL(pathAndQuery, `${SKILLHUB_API}/`)
  if (url.protocol !== 'https:' || url.hostname !== 'api.skillhub.cn') {
    throw new Error('只允许请求 api.skillhub.cn')
  }
  const res = await fetch(url, {
    method: 'GET',
    redirect: follow ? 'follow' : 'manual',
    headers: { Accept: 'application/json, application/zip, */*', 'User-Agent': 'dsh-esc-skillhub/0.1.38' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!follow && res.status >= 300 && res.status < 400) throw new Error('SkillHub 返回了重定向，已拒绝')
  if (!res.ok) throw new Error(`SkillHub HTTP ${res.status}`)
  const finalHost = new URL(res.url || url.href).hostname
  const hostOk =
    finalHost === 'api.skillhub.cn' ||
    finalHost.endsWith('.myqcloud.com') ||
    finalHost.endsWith('.tencent-cloud.com') ||
    finalHost.endsWith('.qcloud.com')
  if (!hostOk) throw new Error('SkillHub 下载跳到了未允许的主机')
  const len = Number(res.headers.get('content-length') || 0)
  if (len > maxBytes) throw new Error('SkillHub 响应过大')
  return res
}

async function readLimited(res: Response, maxBytes: number): Promise<Buffer> {
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > maxBytes) throw new Error('SkillHub 响应过大')
  return buf
}

function parseMarketRow(raw: unknown): Omit<HubMarketItem, 'installed' | 'enabled'> | null {
  const row = asRecord(raw)
  if (!row) return null
  let slug = ''
  try {
    slug = assertSlug(String(row.slug || ''))
  } catch {
    return null
  }
  const ns = asRecord(row.namespace)
  const desc = String(row.description_zh || row.description || '').trim()
  return {
    id: hubSkillId(slug),
    slug,
    name: String(row.name || slug).trim() || slug,
    description: desc.slice(0, 400),
    category: String(row.category || '').trim(),
    categoryLabel: categoryLabel(String(row.category || '').trim()),
    icon: publicHttpsUrl(String(row.iconUrl || '')),
    version: String(row.version || '').trim(),
    downloads: asNum(row.downloads),
    homepage: publicHttpsUrl(
      String(row.homepage || (ns && ns.publicSlug ? `${SKILLHUB_API}/${String(ns.handle || '')}/${String(ns.publicSlug)}` : '')),
    ),
  }
}

export function parseSkillsListPayload(payload: unknown): { items: Array<Omit<HubMarketItem, 'installed' | 'enabled'>>; total: number } {
  const root = asRecord(payload)
  const data = asRecord(root?.data) || root
  const list = data && Array.isArray(data.skills) ? data.skills : Array.isArray(root?.skills) ? root.skills : []
  const items: Array<Omit<HubMarketItem, 'installed' | 'enabled'>> = []
  const seen = new Set<string>()
  for (const row of list) {
    const item = parseMarketRow(row)
    if (!item || seen.has(item.slug)) continue
    seen.add(item.slug)
    items.push(item)
  }
  const total = asNum(data?.total ?? root?.total)
  return { items, total: total || items.length }
}

function skillFromMarkdown(slug: string, raw: string, meta: HubMetaFile): SkillMeta {
  const { meta: fm, body } = parseFrontMatter(raw)
  const name = String(fm.name || meta.name || slug)
  const description = String(fm.description || meta.description || '').trim()
  const triggers = strList(fm.triggers)
  if (!triggers.includes(name)) triggers.push(name)
  if (!triggers.includes(slug)) triggers.push(slug)
  return {
    id: hubSkillId(slug),
    name,
    description,
    category: String(fm.category || meta.category || 'SkillHub'),
    icon: publicHttpsUrl(String(fm.icon || meta.icon || '')),
    triggers,
    requiredConnectorIds: [],
    optionalConnectorIds: [],
    body,
    source: 'skillhub',
    slug,
    version: String(meta.version || fm.version || ''),
    homepage: publicHttpsUrl(String(meta.homepage || '')),
  }
}

export function loadInstalledHubSkills(dataRoot: string): SkillMeta[] {
  const root = hubRoot(dataRoot)
  if (!existsSync(root)) return []
  const out: SkillMeta[] = []
  for (const dirent of readdirSync(root, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue
    let slug = ''
    try {
      slug = assertSlug(dirent.name)
    } catch {
      continue
    }
    const mdPath = join(root, slug, 'SKILL.md')
    if (!existsSync(mdPath)) continue
    let disk: HubMetaFile = { slug }
    const metaPath = join(root, slug, 'meta.json')
    if (existsSync(metaPath)) {
      try {
        disk = { ...disk, ...(JSON.parse(readFileSync(metaPath, 'utf8')) as HubMetaFile) }
      } catch {
        /* 手册仍可用 */
      }
    }
    try {
      out.push(skillFromMarkdown(slug, readFileSync(mdPath, 'utf8'), disk))
    } catch {
      /* 跳过坏包 */
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
}

export async function fetchHubMarket(opts: {
  keyword?: string
  category?: string
  page?: number
  pageSize?: number
  installed: SkillMeta[]
  enabledIds: Set<string>
}): Promise<HubMarketPage> {
  const page = Math.max(1, Math.floor(opts.page || 1))
  const pageSize = Math.min(24, Math.max(6, Math.floor(opts.pageSize || 12)))
  const u = new URL('/api/skills', SKILLHUB_API)
  u.searchParams.set('page', String(page))
  u.searchParams.set('pageSize', String(pageSize))
  u.searchParams.set('page_size', String(pageSize))
  u.searchParams.set('sortBy', 'score')
  const keyword = String(opts.keyword || '').trim()
  if (keyword) {
    u.searchParams.set('keyword', keyword)
    u.searchParams.set('q', keyword)
  }
  const category = String(opts.category || '').trim()
  if (category && CATEGORY_LABEL.has(category)) u.searchParams.set('category', category)
  const res = await skillhubGet(`${u.pathname}${u.search}`, 2 * 1024 * 1024, 20000)
  const text = (await readLimited(res, 2 * 1024 * 1024)).toString('utf8')
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error('SkillHub 列表不是 JSON')
  }
  const parsed = parseSkillsListPayload(payload)
  const installed = new Map(opts.installed.map((s) => [s.slug || slugFromSkillId(s.id) || '', s]))
  return {
    items: parsed.items.map((item) => ({
      ...item,
      installed: installed.has(item.slug),
      enabled: opts.enabledIds.has(item.id),
    })),
    total: parsed.total,
    page,
    pageSize,
    categories: SKILLHUB_CATEGORIES,
  }
}

export async function fetchHubDetail(slugRaw: string): Promise<Omit<HubMarketItem, 'installed' | 'enabled'>> {
  const slug = assertSlug(slugRaw)
  const res = await skillhubGet(`/api/v1/skills/${encodeURIComponent(slug)}`, 512 * 1024, 15000)
  const text = (await readLimited(res, 512 * 1024)).toString('utf8')
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error('SkillHub 详情不是 JSON')
  }
  const root = asRecord(payload)
  const skill = asRecord(root?.skill) || root
  const row = parseMarketRow({
    ...(skill || {}),
    slug,
    name: skill?.displayName || skill?.name || slug,
    description: skill?.summary_zh || skill?.summary || skill?.description_zh || skill?.description,
    iconUrl: skill?.iconUrl,
    version: asRecord(root?.latestVersion)?.version,
    homepage: `${SKILLHUB_API}/skills/${slug}`,
  })
  if (!row) throw new Error('SkillHub 详情无效')
  return row
}

export async function installHubSkill(dataRoot: string, slugRaw: string): Promise<SkillMeta> {
  const slug = assertSlug(slugRaw)
  const detail = await fetchHubDetail(slug).catch(() => null)
  const dl = new URL('/api/v1/download', SKILLHUB_API)
  dl.searchParams.set('slug', slug)
  dl.searchParams.set('source', 'dsh')
  if (detail?.version) dl.searchParams.set('version', detail.version)
  const res = await skillhubGet(`${dl.pathname}${dl.search}`, MAX_ZIP_BYTES, 45000, true)
  const zip = await readLimited(res, MAX_ZIP_BYTES)
  const md = extractSkillMarkdown(zip)
  const dir = join(hubRoot(dataRoot), slug)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const meta: HubMetaFile = {
    slug,
    version: detail?.version || '',
    name: detail?.name || '',
    description: detail?.description || '',
    category: detail?.category || '',
    icon: publicHttpsUrl(detail?.icon || ''),
    homepage: publicHttpsUrl(detail?.homepage || ''),
  }
  writeFileSync(join(dir, 'SKILL.md'), md.text, { encoding: 'utf8', mode: 0o600 })
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  return skillFromMarkdown(slug, md.text, meta)
}

export function uninstallHubSkill(dataRoot: string, slugRaw: string): string {
  const slug = assertSlug(slugRaw)
  const dir = join(hubRoot(dataRoot), slug)
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  return hubSkillId(slug)
}
