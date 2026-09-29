/**
 * 智谱 Web Search：联网检索新闻与公开信息。
 * 对照 simplified-workbuddy `apps/agent/tools/web_search.py`（POST {ZHIPU_BASE_URL}web_search）。
 * API Key：插件覆盖 → 环境变量 → WorkBuddy 系统配置 vision.api_key（与 simplified VISION_* 同源）。
 */
import { randomUUID } from 'node:crypto'
import { loadConfig } from './config.js'
import { readWorkbuddyCreds } from './workbuddy_config.js'

export type SearchEngine = 'search_std' | 'search_pro' | 'search_pro_sogou' | 'search_pro_quark'
export type RecencyFilter = 'oneDay' | 'oneWeek' | 'oneMonth' | 'oneYear' | 'noLimit'

export type SearchHit = {
  title: string
  content: string
  link: string
  media: string
  publish_date: string
}

export type SearchWebResult = {
  ok: boolean
  query: string
  error?: string
  detail?: string
  count?: number
  results?: SearchHit[]
  markdown?: string
  hint?: string
  query_truncated?: boolean
}

const KEY_MISSING_HINT =
  '未配置智谱 API Key，无法联网搜索。请到 WorkBuddy「系统配置 → 视觉模型」填写智谱 Key（与 simplified VISION_API_KEY 相同）。'

const DEFAULT_BASE = 'https://open.bigmodel.cn/api/paas/v4'

function envFirst(...keys: string[]): string {
  for (const k of keys) {
    const v = (process.env[k] || '').trim()
    if (v) return v
  }
  return ''
}

function apiKey(): string {
  const cfg = loadConfig()
  const wb = readWorkbuddyCreds()
  return (
    cfg.zhipuApiKey.trim() ||
    envFirst('ZHIPU_API_KEY', 'BIGMODEL_API_KEY', 'VISION_API_KEY') ||
    wb.visionApiKey
  )
}

function baseUrl(): string {
  const cfg = loadConfig()
  const wb = readWorkbuddyCreds()
  const raw =
    cfg.zhipuBaseUrl.trim() ||
    envFirst('ZHIPU_BASE_URL', 'VISION_BASE_URL') ||
    wb.visionBaseUrl ||
    DEFAULT_BASE
  return raw.replace(/\/+$/, '') + '/'
}

export function webSearchEnabled(): boolean {
  const flag = (process.env.WEB_SEARCH_ENABLED || '').trim().toLowerCase()
  if (flag === '0' || flag === 'false' || flag === 'no' || flag === 'off') return false
  return Boolean(apiKey())
}

function timeoutMs(): number {
  const raw = (process.env.WEB_SEARCH_TIMEOUT_SEC || '30').trim()
  const n = Number(raw)
  const sec = Number.isFinite(n) ? n : 30
  return Math.max(5, sec) * 1000
}

async function callZhipuWebSearch(opts: {
  search_query: string
  search_engine: SearchEngine
  count: number
  search_recency_filter: RecencyFilter
  search_domain_filter?: string
}): Promise<Record<string, unknown>> {
  const key = apiKey()
  if (!key) return { error: KEY_MISSING_HINT }
  const endpoint = `${baseUrl()}web_search`
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return { error: '智谱 Base URL 不是合法 URL' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: '智谱 Base URL 只允许 http/https' }
  }
  const payload: Record<string, unknown> = {
    search_query: opts.search_query,
    search_engine: opts.search_engine,
    search_intent: false,
    count: opts.count,
    search_recency_filter: opts.search_recency_filter,
    request_id: randomUUID(),
  }
  if (opts.search_domain_filter) payload.search_domain_filter = opts.search_domain_filter.trim()

  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs())
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    const raw = await res.text()
    if (!res.ok) {
      const detail = raw.slice(0, 400)
      return { error: `智谱搜索 HTTP ${res.status}`, detail: detail || String(res.status) }
    }
    let data: unknown
    try {
      data = JSON.parse(raw)
    } catch {
      return { error: '智谱搜索返回非 JSON', raw: raw.slice(0, 300) }
    }
    if (!data || typeof data !== 'object') return { error: '智谱搜索返回格式异常' }
    const obj = data as Record<string, unknown>
    if (obj.error) {
      const err = obj.error
      if (err && typeof err === 'object') {
        const e = err as Record<string, unknown>
        return {
          error: String(e.message || e.code || '智谱搜索失败'),
          code: e.code,
        }
      }
      return { error: String(err) }
    }
    return obj
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const cause =
      e instanceof Error && e.cause instanceof Error
        ? `（${(e.cause as NodeJS.ErrnoException).code || e.cause.message}）`
        : ''
    return { error: `智谱搜索网络失败：${msg}${cause}` }
  } finally {
    clearTimeout(t)
  }
}

export function formatSearchResultsMarkdown(results: SearchHit[]): string {
  const lines: string[] = []
  results.forEach((row, idx) => {
    const title = (row.title || '（无标题）').trim()
    const content = (row.content || '').trim()
    const link = (row.link || '').trim()
    const media = (row.media || '').trim()
    const publishDate = (row.publish_date || '').trim()
    const block = [`${idx + 1}. **${title}**`]
    if (content) block.push(`   ${content}`)
    const meta: string[] = []
    if (media) meta.push(media)
    if (publishDate) meta.push(publishDate)
    if (link) meta.push(link)
    if (meta.length) block.push(`   来源：${meta.join(' · ')}`)
    lines.push(block.join('\n'))
  })
  return lines.join('\n\n')
}

export async function searchWeb(opts: {
  query: string
  count?: number
  search_recency_filter?: RecencyFilter
  search_engine?: SearchEngine
  search_domain_filter?: string
}): Promise<SearchWebResult> {
  let q = (opts.query || '').trim()
  if (!q) return { ok: false, query: '', error: '请提供搜索关键词 query' }
  let truncated = false
  if (q.length > 70) {
    q = q.slice(0, 70)
    truncated = true
  }
  const n = Math.max(1, Math.min(Math.floor(opts.count || 10), 50))
  const raw = await callZhipuWebSearch({
    search_query: q,
    search_engine: opts.search_engine || 'search_std',
    count: n,
    search_recency_filter: opts.search_recency_filter || 'noLimit',
    search_domain_filter: opts.search_domain_filter,
  })
  if (raw.error) {
    return { ok: false, query: q, error: String(raw.error), detail: raw.detail ? String(raw.detail) : undefined }
  }
  const resultsRaw = raw.search_result
  const list = Array.isArray(resultsRaw) ? resultsRaw : []
  const normalized: SearchHit[] = []
  for (const row of list.slice(0, n)) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    normalized.push({
      title: String(r.title || '').trim(),
      content: String(r.content || '').trim(),
      link: String(r.link || '').trim(),
      media: String(r.media || '').trim(),
      publish_date: String(r.publish_date || '').trim(),
    })
  }
  const out: SearchWebResult = {
    ok: true,
    query: q,
    count: normalized.length,
    results: normalized,
    markdown: normalized.length ? formatSearchResultsMarkdown(normalized) : '（无匹配结果）',
    hint: '整理给用户时保留标题、要点与来源链接；无结果时如实说明，勿编造。',
  }
  if (truncated) out.query_truncated = true
  return out
}
