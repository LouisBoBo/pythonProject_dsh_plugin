/**
 * 腾讯乐享知识库：搜索节点、在指定知识库下新建在线文档并写入 Markdown 块。
 * 只打 lxapi.lexiangla.com；凭证在本连接器卡片，不读系统配置、不另起 MCP。
 * 默认关闭。未启用或未授权时禁止写入。
 */
import type { ConnectorConfig, QueryResult } from '../types.js'

const HOST = 'lxapi.lexiangla.com'
const API = `https://${HOST}`
const HEX32 = /^[0-9a-f]{32}$/i
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_BLOCKS = 80

export type LexiangTarget = { spaceId: string; parentEntryId: string }

type LxJson = {
  http: number
  code: number
  message: string
  data: unknown
  raw: Record<string, unknown>
}

const HEADING_FIELD: Record<string, string> = {
  h1: 'heading1',
  h2: 'heading2',
  h3: 'heading3',
  h4: 'heading4',
  h5: 'heading5',
}

function isKbId(raw: string): boolean {
  const s = String(raw || '').trim()
  return HEX32.test(s) || UUID.test(s)
}

function credsOf(cfg: ConnectorConfig | undefined): { appKey: string; appSecret: string; staffId: string } {
  return {
    appKey: String(cfg?.apiKey || '').trim(),
    appSecret: String(cfg?.password || '').trim(),
    staffId: String(cfg?.token || '').trim(),
  }
}

export function parseLexiangTarget(raw: string): LexiangTarget {
  const text = String(raw || '').trim()
  if (!text) return { spaceId: '', parentEntryId: '' }
  const lower = text.toLowerCase()
  if (lower.includes('feishu.cn') || lower.includes('larksuite.com')) {
    throw new Error('请填乐享知识库空间 ID 或链接，不是飞书文档')
  }
  if (text.includes('://')) {
    let url: URL
    try {
      url = new URL(text)
    } catch {
      throw new Error('无法解析乐享链接')
    }
    const host = url.hostname.toLowerCase()
    if (
      host !== HOST &&
      !host.endsWith('.lexiangla.com') &&
      host !== 'lexiang.tencent.com' &&
      !host.endsWith('.lexiang.tencent.com')
    ) {
      throw new Error('请粘贴 lexiang.tencent.com / lexiangla.com 知识库链接，或直接填 32 位空间 ID')
    }
    const spaceQ = url.searchParams.get('space_id') || url.searchParams.get('spaceId') || ''
    const parentQ =
      url.searchParams.get('parent_id') || url.searchParams.get('entry_id') || url.searchParams.get('parentEntryId') || ''
    const ids = url.pathname.split('/').filter(isKbId)
    const spaceId = spaceQ || ids[0] || ''
    const parentEntryId = parentQ || ids[1] || ''
    if (!spaceId) throw new Error('链接里没有知识库空间 ID。也可直接粘贴 32 位 space_id。')
    return { spaceId, parentEntryId }
  }
  const segs = text.split(/[/,]/).map((s) => s.trim()).filter(Boolean)
  if (segs.length >= 2 && isKbId(segs[0])) return { spaceId: segs[0], parentEntryId: segs[1] }
  return { spaceId: text, parentEntryId: '' }
}

function textElements(content: string): { text_run: { content: string } }[] {
  return [{ text_run: { content: content.slice(0, 8000) } }]
}

export function markdownToBlocks(markdown: string): Record<string, unknown>[] {
  const lines = String(markdown || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
  const out: Record<string, unknown>[] = []
  let fence = false
  let fenceLang = 'text'
  let fenceBuf: string[] = []
  const flushFence = () => {
    out.push({
      block_type: 'code',
      code: {
        elements: textElements(fenceBuf.join('\n').slice(0, 20000)),
        style: { language: fenceLang.slice(0, 32) || 'text', wrap: true },
      },
    })
    fenceBuf = []
    fenceLang = 'text'
  }
  for (const line of lines) {
    if (out.length >= MAX_BLOCKS) break
    if (line.startsWith('```')) {
      if (fence) {
        flushFence()
        fence = false
      } else {
        fence = true
        fenceLang = line.slice(3).trim() || 'text'
      }
      continue
    }
    if (fence) {
      fenceBuf.push(line)
      continue
    }
    if (!line.trim()) continue
    const heading = /^(#{1,5})\s+(.+)$/.exec(line)
    if (heading) {
      const type = `h${heading[1].length}`
      out.push({
        block_type: type,
        [HEADING_FIELD[type]]: { elements: textElements(heading[2]) },
      })
      continue
    }
    out.push({
      block_type: 'p',
      text: { elements: textElements(line.replace(/^[-*+]\s+/, '• ')) },
    })
  }
  if (fence) flushFence()
  if (!out.length) {
    const fallback = String(markdown || '').trim().slice(0, 8000)
    if (fallback) out.push({ block_type: 'p', text: { elements: textElements(fallback) } })
  }
  return out
}

let tokenCache: { key: string; token: string; exp: number } | null = null

function errorText(raw: Record<string, unknown>, http: number): string {
  const errors = raw.errors
  if (errors && typeof errors === 'object') {
    const rec = errors as Record<string, unknown>
    if (typeof rec.detail === 'string' && rec.detail.trim()) return rec.detail
    const first = Object.values(rec)[0]
    if (Array.isArray(first) && typeof first[0] === 'string') return first[0]
  }
  return String(raw.message || raw.msg || raw.error || `HTTP ${http}`)
}

async function lxFetch(
  path: string,
  token: string | null,
  staffId: string,
  init?: { method?: string; body?: unknown },
): Promise<LxJson> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (staffId) headers['x-staff-id'] = staffId
  const method = init?.method || (init?.body === undefined ? 'GET' : 'POST')
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(30000),
  })
  const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (res.status === 401) tokenCache = null
  const hasErrors = Boolean(raw.errors && typeof raw.errors === 'object')
  const code = typeof raw.code === 'number' ? raw.code : res.ok && !hasErrors ? 0 : -1
  return {
    http: res.status,
    code,
    message: errorText(raw, res.status),
    data: raw.data != null ? raw.data : raw,
    raw,
  }
}

function lxOk(out: LxJson): boolean {
  return out.http < 400 && out.code === 0
}

async function accessToken(appKey: string, appSecret: string): Promise<string> {
  const key = `${appKey}\n${appSecret}`
  const now = Date.now()
  if (tokenCache && tokenCache.key === key && tokenCache.exp > now + 30_000) return tokenCache.token
  const out = await lxFetch('/cgi-bin/token', null, '', {
    method: 'POST',
    body: { grant_type: 'client_credentials', app_key: appKey, app_secret: appSecret },
  })
  const rec = out.data && typeof out.data === 'object' && !Array.isArray(out.data) ? (out.data as Record<string, unknown>) : {}
  const token = String(rec.access_token || out.raw.access_token || '')
  if (!token) throw new Error(`乐享 access_token 失败：${out.message || out.http}`)
  const expires =
    typeof rec.expires_in === 'number'
      ? rec.expires_in
      : typeof out.raw.expires_in === 'number'
        ? out.raw.expires_in
        : 7200
  tokenCache = { key, token, exp: now + Math.max(60, expires - 120) * 1000 }
  return token
}

function asRecord(data: unknown): Record<string, unknown> {
  return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {}
}

function unconfigured(): QueryResult {
  return {
    ok: false,
    source: 'none',
    code: 'connector_unconfigured',
    detail: '未配置乐享。请在「专家·技能·连接器」乐享卡片填写 AppKey、AppSecret、成员帐号，以及知识库空间 ID。凭证在乐享后台【开发 → 接口凭证管理】，不是 WorkBuddy 系统配置。',
  }
}

async function getPageRootId(token: string, staffId: string, entryId: string): Promise<string> {
  const out = await lxFetch(
    `/cgi-bin/v1/kb/page/entries/${encodeURIComponent(entryId)}/blocks/children`,
    token,
    staffId,
  )
  const rec = asRecord(out.data)
  const blocks = Array.isArray(rec.blocks) ? rec.blocks : Array.isArray(out.data) ? out.data : []
  const first = blocks[0]
  if (first && typeof first === 'object') {
    const parent = String((first as Record<string, unknown>).parent_id || '')
    if (parent) return parent
  }
  return ''
}

export async function probeLexiang(cfg: ConnectorConfig): Promise<QueryResult> {
  const creds = credsOf(cfg)
  let target: LexiangTarget
  try {
    target = parseLexiangTarget(cfg.docTarget || '')
  } catch (e) {
    return { ok: false, source: 'none', code: 'invalid_kind', detail: e instanceof Error ? e.message : String(e) }
  }
  if (!creds.appKey || !creds.appSecret) {
    if (cfg.mode === 'mock') {
      return { ok: true, source: 'mock', detail: 'mock：不访问乐享。填好 AppKey/AppSecret 后点测通，会验登录和知识库空间。' }
    }
    return unconfigured()
  }
  try {
    const token = await accessToken(creds.appKey, creds.appSecret)
    if (!target.spaceId) {
      return { ok: true, source: 'http', detail: '已登录乐享应用。未填知识库空间 ID 时，写入会失败。测通未写文档。' }
    }
    const staff = creds.staffId || 'system-bot'
    const qs = new URLSearchParams({ space_id: target.spaceId, limit: '1' })
    if (target.parentEntryId) qs.set('parent_id', target.parentEntryId)
    const listed = await lxFetch(`/cgi-bin/v1/kb/entries?${qs.toString()}`, token, staff)
    if (!lxOk(listed)) {
      throw new Error(`读不到该知识库：${listed.message || listed.http}。请确认空间 ID、成员帐号，以及 AppKey 已授权该知识库。`)
    }
    return {
      ok: true,
      source: 'http',
      detail: target.parentEntryId
        ? `已定位知识库 ${target.spaceId} 的父节点，测通成功。写入会在其下新建一篇，不会改父节点正文。`
        : `已定位知识库 ${target.spaceId}，测通成功。写入会在知识库根目录新建一篇。`,
    }
  } catch (e) {
    return { ok: false, source: 'http', code: 'connect_failed', detail: e instanceof Error ? e.message : String(e) }
  }
}

export async function searchLexiang(cfg: ConnectorConfig | undefined, query: string): Promise<QueryResult> {
  if (!cfg?.enabled) {
    return {
      ok: false,
      source: 'none',
      code: 'connector_disabled',
      detail: '乐享连接器未启用。请到「专家·技能·连接器」打开。禁止编造知识库条目。',
    }
  }
  const q = String(query || '').trim()
  if (!q) return { ok: false, source: 'none', code: 'invalid_query', detail: '检索词不能为空' }
  const creds = credsOf(cfg)
  let target: LexiangTarget
  try {
    target = parseLexiangTarget(cfg.docTarget || '')
  } catch (e) {
    return { ok: false, source: 'none', code: 'invalid_kind', detail: e instanceof Error ? e.message : String(e) }
  }
  if (!creds.appKey || !creds.appSecret || !target.spaceId) {
    if (cfg.mode === 'mock') {
      return { ok: true, source: 'mock', detail: 'mock：未检索乐享', data: { query: q, target } }
    }
    return unconfigured()
  }
  try {
    const token = await accessToken(creds.appKey, creds.appSecret)
    const staff = creds.staffId || 'system-bot'
    const body: Record<string, unknown> = { keyword: q.slice(0, 200), limit: 8, space_id: target.spaceId }
    const out = await lxFetch('/cgi-bin/v1/kb/entries/search', token, staff, { method: 'POST', body })
    if (!lxOk(out)) throw new Error(out.message || `搜索失败 HTTP ${out.http}`)
    const rows = Array.isArray(out.data) ? out.data : []
    const list = rows.slice(0, 8).map((row) => {
      const rec = asRecord(row)
      const attrs = asRecord(rec.attributes)
      return {
        id: String(rec.id || ''),
        name: String(attrs.name || rec.name || ''),
        entry_type: String(attrs.entry_type || ''),
      }
    })
    return { ok: true, source: 'http', detail: `乐享检索完成，${list.length} 条`, data: { list } }
  } catch (e) {
    return { ok: false, source: 'http', code: 'connect_failed', detail: e instanceof Error ? e.message : String(e) }
  }
}

export async function writeLexiangDoc(
  cfg: ConnectorConfig | undefined,
  title: string,
  markdown: string,
  targetRaw = '',
): Promise<QueryResult> {
  if (!cfg?.enabled) {
    return {
      ok: false,
      source: 'none',
      code: 'connector_disabled',
      detail: '乐享连接器未启用。请到「专家·技能·连接器」打开。',
    }
  }
  const heading = String(title || '').trim().slice(0, 80)
  const md = String(markdown || '').trim()
  if (!heading) return { ok: false, source: 'none', code: 'invalid_kind', detail: '标题不能为空' }
  if (!md) return { ok: false, source: 'none', code: 'invalid_kind', detail: '正文不能为空' }
  let target: LexiangTarget
  try {
    target = parseLexiangTarget(targetRaw || cfg.docTarget || '')
  } catch (e) {
    return { ok: false, source: 'none', code: 'invalid_kind', detail: e instanceof Error ? e.message : String(e) }
  }
  if (cfg.mode === 'mock') {
    return { ok: true, source: 'mock', detail: 'mock：未写入乐享', data: { title: heading, target } }
  }
  if (!cfg.outboundArmed) {
    return {
      ok: false,
      source: 'none',
      code: 'outbound_not_armed',
      detail: '未获本机面板授权写入乐享。请在「专家·技能·连接器」启用乐享，或在输入框旁选用含乐享的场景卡。禁止把用户原话当授权。',
    }
  }
  const creds = credsOf(cfg)
  if (!creds.appKey || !creds.appSecret || !creds.staffId || !target.spaceId) return unconfigured()
  const blocks = markdownToBlocks(md)
  if (!blocks.length) return { ok: false, source: 'none', code: 'invalid_kind', detail: '正文转换结果为空' }
  try {
    const token = await accessToken(creds.appKey, creds.appSecret)
    const createBody: Record<string, unknown> = {
      data: {
        attributes: { name: heading, entry_type: 'page' },
      },
    }
    if (target.parentEntryId) {
      ;(createBody.data as Record<string, unknown>).relationships = {
        parent_entry: { data: { type: 'kb_entry', id: target.parentEntryId } },
      }
    }
    const created = await lxFetch(
      `/cgi-bin/v1/kb/entries?space_id=${encodeURIComponent(target.spaceId)}`,
      token,
      creds.staffId,
      { method: 'POST', body: createBody },
    )
    const rec = asRecord(created.data)
    const entryId = String(rec.id || asRecord(rec.data).id || '')
    if (!lxOk(created) || !entryId) {
      throw new Error(`创建乐享文档失败：${created.message || created.http}`)
    }
    const rootId = await getPageRootId(token, creds.staffId, entryId)
    const insertBody: Record<string, unknown> = { index: 0, descendant: blocks }
    if (rootId) insertBody.parent_block_id = rootId
    const written = await lxFetch(
      `/cgi-bin/v1/kb/page/entries/${encodeURIComponent(entryId)}/blocks/descendant`,
      token,
      creds.staffId,
      { method: 'POST', body: insertBody },
    )
    if (!lxOk(written)) {
      throw new Error(
        `已建文档 ${entryId}，但写入正文失败：${written.message || written.http}。请给 AppKey 开通「在线文档块」。`,
      )
    }
    return {
      ok: true,
      source: 'http',
      detail: `已在乐享知识库新建文档「${heading}」，entry_id=${entryId}`,
      data: { entryId, spaceId: target.spaceId, action: '新建' },
    }
  } catch (e) {
    return { ok: false, source: 'http', code: 'connect_failed', detail: e instanceof Error ? e.message : String(e) }
  }
}
