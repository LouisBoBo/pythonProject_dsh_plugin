/**
 * 语雀投递：任务成功后新建一篇文档，不覆盖旧文；与企微/飞书互不干涉。
 *
 * 鉴权：本机凭证文件 ~/.zhongruan/automations/credentials/yuque.cookie；
 * 不改 WorkBuddy 仓库配置。若运行时 yaml 已有 yuque_* 则顺带读取。
 * 官方 OpenAPI（X-Auth-Token）走 /api/v2；无 Token 时用浏览器 Cookie + CSRF
 * 走网页内部接口 /api/docs（与常见语雀 MCP Cookie 模式同一路）。
 * Cookie/Token 禁止写入 automations.json，禁止打进日志或工具返回。
 */
import type { Automation, DeliveryStatus, ReportChart } from './types.js'
import { readWorkbuddyCreds } from './workbuddy_config.js'
import { resolveYuqueDocSync } from './store.js'
import { formatChartsMarkdown, sanitizeCharts } from './mes_charts.js'
import { renderChartPngs } from './chart_png.js'
import { shanghaiYmd } from './mes_report.js'
import {
  cookieValue,
  DEFAULT_YUQUE_HOST,
  hostFromYuqueUrl,
  normalizeYuqueBook,
  normalizeYuqueHost,
  readYuqueCookieFile,
  yuqueCookiePath,
  yuqueCsrfToken,
  yuqueRequestHeaders,
} from './yuque_book.js'

export { normalizeYuqueBook, yuqueCookiePath } from './yuque_book.js'

export type YuqueAuthMode = 'token' | 'cookie' | 'none'
export type YuqueAuthSource = 'workbuddy' | 'file' | 'none'

export type YuqueAuth = {
  mode: YuqueAuthMode
  source: YuqueAuthSource
  host: string
  token: string
  cookie: string
}

export type YuqueAuthView = {
  configured: boolean
  mode: YuqueAuthMode
  source: YuqueAuthSource
  host: string
  cookieFilePath: string
}

type YuqueJson = {
  http: number
  data: Record<string, unknown>
  message: string
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}

function asList(v: unknown): Record<string, unknown>[] {
  if (Array.isArray(v)) return v.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]
  const o = asRecord(v)
  for (const key of ['books', 'items', 'list', 'data']) {
    if (Array.isArray(o[key])) return asList(o[key])
  }
  return []
}

function publicErr(http: number, message: string): string {
  if (http === 401 || http === 403) {
    return '语雀登录已失效或无权限。请更新 Token，或刷新浏览器 Cookie 写入凭证文件。'
  }
  const msg = String(message || '').replace(/cookie|_yuque_session|yuque_ctoken|X-Auth-Token/gi, '').trim()
  return `语雀接口失败 HTTP ${http}${msg ? `：${msg.slice(0, 180)}` : ''}`
}

export function resolveYuqueAuth(dataRoot: string): YuqueAuth {
  const wb = readWorkbuddyCreds()
  const file = readYuqueCookieFile(dataRoot)
  const host = normalizeYuqueHost(wb.yuqueHost || file.host || DEFAULT_YUQUE_HOST)
  const token = wb.yuqueToken.trim()
  if (token) {
    return { mode: 'token', source: 'workbuddy', host, token, cookie: '' }
  }
  const yamlCookie = wb.yuqueCookie.trim()
  if (yamlCookie && cookieValue(yamlCookie, '_yuque_session')) {
    return { mode: 'cookie', source: 'workbuddy', host, token: '', cookie: yamlCookie }
  }
  if (file.cookie && cookieValue(file.cookie, '_yuque_session')) {
    return {
      mode: 'cookie',
      source: 'file',
      host: normalizeYuqueHost(wb.yuqueHost || file.host || DEFAULT_YUQUE_HOST),
      token: '',
      cookie: file.cookie,
    }
  }
  return { mode: 'none', source: 'none', host, token: '', cookie: '' }
}

export function yuqueAuthView(dataRoot: string): YuqueAuthView {
  const auth = resolveYuqueAuth(dataRoot)
  return {
    configured: auth.mode !== 'none',
    mode: auth.mode,
    source: auth.source,
    host: auth.host,
    cookieFilePath: yuqueCookiePath(dataRoot),
  }
}

function headersFor(auth: YuqueAuth, namespace?: string): Record<string, string> {
  return yuqueRequestHeaders({
    host: auth.host,
    mode: auth.mode === 'token' ? 'token' : 'cookie',
    token: auth.token,
    cookie: auth.cookie,
    referer: namespace ? `${auth.host}/${namespace}` : `${auth.host}/`,
  })
}

async function yuqueJson(
  auth: YuqueAuth,
  url: string,
  init?: { method?: string; body?: unknown; namespace?: string },
): Promise<YuqueJson> {
  const res = await fetch(url, {
    method: init?.method || 'GET',
    headers: headersFor(auth, init?.namespace),
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(60_000),
  })
  const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>
  const nested = asRecord(raw.data)
  return {
    http: res.status,
    data: Object.keys(nested).length ? nested : raw,
    message: String(raw.message || raw.msg || raw.error || nested.message || ''),
  }
}

function docUrl(host: string, namespace: string, data: Record<string, unknown>): string {
  const explicit = String(data.url || data.web_url || '').trim()
  if (/^https?:\/\//i.test(explicit)) return explicit
  const slug = String(data.slug || data.id || '').trim()
  if (namespace && slug) return `${host}/${namespace}/${slug}`
  return ''
}

function bookIdOf(row: Record<string, unknown>): number {
  const n = Number(row.id || row.book_id || 0)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function bookNamespace(row: Record<string, unknown>): string {
  const ns = String(row.namespace || '').trim()
  if (ns.includes('/')) return ns
  const user = asRecord(row.user)
  const login = String(user.login || row.login || '').trim()
  const slug = String(row.slug || row.book_slug || '').trim()
  return login && slug ? `${login}/${slug}` : ''
}

async function resolveBookId(auth: YuqueAuth, namespace: string): Promise<number> {
  if (auth.mode === 'token') {
    const out = await yuqueJson(auth, `${auth.host}/api/v2/repos/${namespace}`, { namespace })
    if (out.http >= 400) throw new Error(publicErr(out.http, out.message))
    const id = bookIdOf(out.data)
    if (!id) throw new Error(`找不到语雀知识库 ${namespace}`)
    return id
  }
  const mine = await yuqueJson(auth, `${auth.host}/api/mine/books`, { namespace })
  if (mine.http >= 400) throw new Error(publicErr(mine.http, mine.message))
  const hit = asList(mine.data).find((row) => bookNamespace(row) === namespace)
  if (hit) {
    const id = bookIdOf(hit)
    if (id) return id
  }
  const v2 = await yuqueJson(auth, `${auth.host}/api/v2/repos/${namespace}`, { namespace })
  if (v2.http < 400) {
    const id = bookIdOf(v2.data)
    if (id) return id
  }
  throw new Error(`当前登录账号看不到知识库 ${namespace}。请确认命名空间，或把该库加到「我的知识库」。`)
}

async function appendToc(auth: YuqueAuth, namespace: string, docId: number): Promise<void> {
  if (!docId) return
  const out = await yuqueJson(auth, `${auth.host}/api/v2/repos/${namespace}/toc`, {
    method: 'PUT',
    namespace,
    body: { action: 'append', action_mode: 'child', type: 'DOC', doc_ids: [docId] },
  })
  if (out.http >= 400) {
    throw new Error(publicErr(out.http, out.message))
  }
}

function catalogHasDoc(data: Record<string, unknown>, docId: number): boolean {
  return asList(data).some((row) => Number(row.doc_id || row.id || 0) === docId)
}

/** Cookie 建文不会进侧栏目录；必须 PUT /api/catalog_nodes，且用 doc_id（单数）。doc_ids 会插出「无标题」空节点。 */
async function ensureCookieCatalog(
  auth: YuqueAuth,
  bookId: number,
  docId: number,
  title: string,
  slug: string,
): Promise<void> {
  if (!bookId || !docId) return
  const listed = await yuqueJson(auth, `${auth.host}/api/catalog_nodes?book_id=${encodeURIComponent(String(bookId))}`)
  if (listed.http < 400 && catalogHasDoc(listed.data, docId)) return
  const out = await yuqueJson(auth, `${auth.host}/api/catalog_nodes`, {
    method: 'PUT',
    body: {
      book_id: bookId,
      action: 'append',
      action_mode: 'child',
      type: 'DOC',
      doc_id: docId,
      title,
      url: slug || undefined,
    },
  })
  if (out.http >= 400) throw new Error(publicErr(out.http, out.message))
  if (!catalogHasDoc(out.data, docId)) {
    throw new Error('语雀文档已创建，但未能写入知识库目录，侧栏不会显示')
  }
}

async function createByToken(
  auth: YuqueAuth,
  namespace: string,
  title: string,
  body: string,
): Promise<{ id: number; url: string }> {
  const slug = `daily-${shanghaiYmd().replace(/-/g, '')}-${Date.now().toString(36)}`
  const out = await yuqueJson(auth, `${auth.host}/api/v2/repos/${namespace}/docs`, {
    method: 'POST',
    namespace,
    body: { title, slug, format: 'markdown', body, public: 0 },
  })
  if (out.http >= 400) throw new Error(publicErr(out.http, out.message))
  const id = Number(out.data.id || 0)
  if (!id) throw new Error('语雀已响应但未返回文档 id')
  try {
    await appendToc(auth, namespace, id)
  } catch {
    /* 文档已建成；目录失败不回滚 */
  }
  return { id, url: docUrl(auth.host, namespace, out.data) }
}

async function createByCookie(
  auth: YuqueAuth,
  namespace: string,
  title: string,
  body: string,
): Promise<{ id: number; url: string }> {
  const ctoken = yuqueCsrfToken(auth.cookie)
  if (!ctoken) {
    throw new Error('Cookie 缺少 yuque_ctoken / _yuque_ctoken，写文档需要 CSRF。请从已登录语雀的浏览器复制完整 Cookie。')
  }
  const bookId = await resolveBookId(auth, namespace)
  const out = await yuqueJson(auth, `${auth.host}/api/docs`, {
    method: 'POST',
    namespace,
    body: {
      book_id: bookId,
      title,
      format: 'markdown',
      body,
      body_draft: body,
      public: 0,
      type: 'Doc',
    },
  })
  if (out.http >= 400) throw new Error(publicErr(out.http, out.message))
  const id = Number(out.data.id || 0)
  if (!id) throw new Error('语雀已响应但未返回文档 id')
  const slug = String(out.data.slug || id)
  await ensureCookieCatalog(auth, bookId, id, title, slug)
  return { id, url: docUrl(auth.host, namespace, { ...out.data, slug }) }
}

async function uploadPng(
  auth: YuqueAuth,
  namespace: string,
  docId: number,
  filename: string,
  buffer: Buffer,
): Promise<string> {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(buffer)], { type: 'image/png' }), filename)
  const headers = headersFor(auth, namespace)
  delete headers['Content-Type']
  const res = await fetch(
    `${auth.host}/api/upload/attach?attachable_type=Doc&attachable_id=${encodeURIComponent(String(docId))}`,
    {
      method: 'POST',
      headers,
      body: form,
      signal: AbortSignal.timeout(60_000),
    },
  )
  const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>
  const data = asRecord(raw.data)
  const url = String(data.url || data.fileurl || raw.url || '').trim()
  if (res.status >= 400 || !url) {
    throw new Error(publicErr(res.status, String(raw.message || raw.error || '')))
  }
  return url
}

async function patchBody(
  auth: YuqueAuth,
  namespace: string,
  docId: number,
  title: string,
  body: string,
): Promise<void> {
  if (auth.mode === 'token') {
    const out = await yuqueJson(auth, `${auth.host}/api/v2/repos/${namespace}/docs/${docId}`, {
      method: 'PUT',
      namespace,
      body: { title, body, format: 'markdown' },
    })
    if (out.http >= 400) throw new Error(publicErr(out.http, out.message))
    return
  }
  const content = await yuqueJson(auth, `${auth.host}/api/docs/${docId}/content`, {
    method: 'PUT',
    namespace,
    body: { body, format: 'markdown' },
  })
  if (content.http >= 400) throw new Error(publicErr(content.http, content.message))
  await yuqueJson(auth, `${auth.host}/api/docs/${docId}/publish`, {
    method: 'PUT',
    namespace,
    body: {},
  })
}

export function buildYuqueMarkdown(title: string, summary: string, charts: ReportChart[] = []): string {
  const body = String(summary || '').trim()
  const head = String(title || '').trim()
  if (!body) return ''
  const shown = head ? `# ${head}\n\n${body}` : body
  const extra = formatChartsMarkdown(sanitizeCharts(charts))
  return extra ? `${shown}\n\n${extra}` : shown
}

async function attachChartImages(
  auth: YuqueAuth,
  namespace: string,
  docId: number,
  charts: ReportChart[],
): Promise<string[]> {
  const pngs = renderChartPngs(charts)
  const urls: string[] = []
  for (const png of pngs) {
    const url = await uploadPng(auth, namespace, docId, `${png.id}.png`, png.buffer)
    urls.push(`![${png.title}](${url})`)
  }
  return urls
}

export async function publishNewYuqueDoc(opts: {
  dataRoot: string
  book: string
  title: string
  markdown: string
  charts?: ReportChart[]
}): Promise<{ url: string; id: number; chartWarning?: string }> {
  const namespace = normalizeYuqueBook(opts.book)
  if (!namespace) throw new Error('未填写语雀知识库')
  const md = String(opts.markdown || '').trim()
  if (!md) throw new Error('报告正文为空，拒绝写入语雀')
  const auth = resolveYuqueAuth(opts.dataRoot)
  if (auth.mode === 'none') {
    throw new Error(
      `未配置语雀凭证。请把浏览器 Cookie 放到 ${yuqueCookiePath(opts.dataRoot)}（须含 _yuque_session 与 yuque_ctoken），不要改仓库配置文件`,
    )
  }
  const created =
    auth.mode === 'token'
      ? await createByToken(auth, namespace, opts.title, md)
      : await createByCookie(auth, namespace, opts.title, md)
  const charts = sanitizeCharts(opts.charts)
  let chartWarning: string | undefined
  if (charts.length && auth.mode === 'token') {
    try {
      const images = await attachChartImages(auth, namespace, created.id, charts)
      if (images.length) {
        const withImages = `${md.replace(/\n## 数据图示[\s\S]*$/, '').trim()}\n\n## 数据图示\n\n${images.join('\n\n')}`
        await patchBody(auth, namespace, created.id, opts.title, withImages)
      } else {
        chartWarning = '本机未能生成图表图片（需要 python3 + matplotlib），语雀文档已用表格代替。'
      }
    } catch (e) {
      chartWarning = e instanceof Error ? e.message : String(e)
    }
  }
  if (!created.url) {
    throw new Error(`语雀文档已创建（id=${created.id}），但未返回链接`)
  }
  return { ...created, chartWarning }
}

export async function deliverYuqueDoc(opts: {
  automation: Automation
  title: string
  summary: string
  charts?: ReportChart[]
  dataRoot: string
}): Promise<{
  yuque_status: DeliveryStatus
  yuque_error?: string
  yuque_url?: string
}> {
  const dest = resolveYuqueDocSync(opts.automation)
  if (!dest.enabled) return { yuque_status: 'skipped' }
  let book = ''
  try {
    book = normalizeYuqueBook(dest.book)
  } catch (e) {
    return { yuque_status: 'failed', yuque_error: e instanceof Error ? e.message : String(e) }
  }
  if (!book) {
    return { yuque_status: 'skipped', yuque_error: '未填写语雀知识库（请填 group/book 或语雀链接）' }
  }
  const auth = resolveYuqueAuth(opts.dataRoot)
  if (auth.mode === 'none') {
    return {
      yuque_status: 'skipped',
      yuque_error: `未配置语雀凭证。请把浏览器 Cookie 放到 ${yuqueCookiePath(opts.dataRoot)}（须含 _yuque_session 与 yuque_ctoken），不要改仓库配置文件`,
    }
  }
  const markdown = buildYuqueMarkdown(opts.title, opts.summary, opts.charts)
  if (!markdown) return { yuque_status: 'failed', yuque_error: '摘要为空，未写入语雀文档' }
  try {
    const created = await publishNewYuqueDoc({
      dataRoot: opts.dataRoot,
      book,
      title: opts.title,
      markdown,
      charts: opts.charts,
    })
    return { yuque_status: 'sent', yuque_url: created.url, yuque_error: created.chartWarning }
  } catch (e) {
    return {
      yuque_status: 'failed',
      yuque_error: e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500),
    }
  }
}

export function bookFromYuqueUrl(raw: string): { book: string; host: string } {
  const book = normalizeYuqueBook(raw)
  return { book, host: hostFromYuqueUrl(raw) }
}
