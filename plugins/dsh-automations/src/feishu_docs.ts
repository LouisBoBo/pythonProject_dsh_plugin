/**
 * 飞书知识库云文档：对照 dsh-remote-review/src/feishu-docs.ts
 * tenant_access_token → wiki 建新节点 → Markdown convert → descendant 写入。
 * 每次投递新建一篇，不覆盖旧文档。凭证只读 WorkBuddy automations.feishu_app_*。
 */
import type { Automation } from './types.js'
import type { DeliveryStatus } from './types.js'
import { readWorkbuddyCreds } from './workbuddy_config.js'
import { resolveFeishuDocSync } from './store.js'
import { normalizeWikiToken } from './wiki_token.js'
import type { ReportChart } from './types.js'
import { formatChartsMarkdown, sanitizeCharts } from './mes_charts.js'
import { renderChartPngs, type ChartPng } from './chart_png.js'

export { normalizeWikiToken } from './wiki_token.js'

const HOST = 'open.feishu.cn'

type TokenCache = { token: string; exp: number; appId: string }
let tokenCache: TokenCache | null = null

export function _resetFeishuTokenCache(): void {
  tokenCache = null
}

type FeishuJson = {
  http: number
  code: number
  msg: string
  data: Record<string, unknown>
}

export function resolveFeishuApp(): { appId: string; appSecret: string; fromWorkbuddy: boolean } {
  const wb = readWorkbuddyCreds()
  return {
    appId: wb.feishuAppId.trim(),
    appSecret: wb.feishuAppSecret.trim(),
    fromWorkbuddy: Boolean(wb.feishuAppId.trim() && wb.feishuAppSecret.trim()),
  }
}

async function feishuJson(
  url: string,
  token: string | null,
  init?: { method?: string; body?: unknown },
): Promise<FeishuJson> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(url, {
    method: init?.method || 'GET',
    headers,
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(60_000),
  })
  const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return {
    http: res.status,
    code: typeof raw.code === 'number' ? raw.code : res.ok ? 0 : -1,
    msg: String(raw.msg || raw.error || ''),
    data: (raw.data && typeof raw.data === 'object' ? raw.data : raw) as Record<string, unknown>,
  }
}

export async function getTenantToken(appId: string, appSecret: string): Promise<string> {
  if (tokenCache && tokenCache.appId === appId && Date.now() < tokenCache.exp - 60_000) {
    return tokenCache.token
  }
  const out = await feishuJson(`https://${HOST}/open-apis/auth/v3/tenant_access_token/internal`, null, {
    method: 'POST',
    body: { app_id: appId, app_secret: appSecret },
  })
  const token = String(out.data.tenant_access_token || '')
  if (!token) {
    throw new Error(`飞书 tenant_access_token 失败：${out.msg || out.http}`)
  }
  const expireSec = typeof out.data.expire === 'number' ? out.data.expire : 7200
  tokenCache = { token, exp: Date.now() + expireSec * 1000, appId }
  return token
}

async function feishuForm(url: string, token: string, form: FormData): Promise<FeishuJson> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  })
  const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return {
    http: res.status,
    code: typeof raw.code === 'number' ? raw.code : res.ok ? 0 : -1,
    msg: String(raw.msg || raw.error || ''),
    data: (raw.data && typeof raw.data === 'object' ? raw.data : raw) as Record<string, unknown>,
  }
}

function pngSize(buf: Buffer): { width: number; height: number } {
  if (buf.length < 24) return { width: 860, height: 280 }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

async function insertChartImages(token: string, documentId: string, pngs: ChartPng[]): Promise<void> {
  for (const png of pngs) {
    const size = pngSize(png.buffer)
    const created = await feishuJson(
      `https://${HOST}/open-apis/docx/v1/documents/${documentId}/blocks/${documentId}/children?document_revision_id=-1`,
      token,
      {
        method: 'POST',
        body: {
          index: -1,
          children: [{ block_type: 27, image: {} }],
        },
      },
    )
    if (created.code !== 0) {
      throw new Error(`创建图片块失败：${created.msg || created.http}`)
    }
    const children = created.data.children
    const ids = created.data.children_id
    const first = Array.isArray(children) ? (children[0] as Record<string, unknown> | undefined) : undefined
    const blockId = String(
      first?.block_id || (Array.isArray(ids) ? ids[0] : '') || created.data.block_id || '',
    )
    if (!blockId) throw new Error('创建图片块未返回 block_id')
    const form = new FormData()
    const name = `${png.id || 'chart'}.png`
    form.append('file_name', name)
    form.append('parent_type', 'docx_image')
    form.append('parent_node', blockId)
    form.append('size', String(png.buffer.length))
    form.append('extra', JSON.stringify({ drive_route_token: documentId }))
    form.append('file', new Blob([new Uint8Array(png.buffer)], { type: 'image/png' }), name)
    const uploaded = await feishuForm(`https://${HOST}/open-apis/drive/v1/medias/upload_all`, token, form)
    if (uploaded.code !== 0) {
      await feishuJson(
        `https://${HOST}/open-apis/docx/v1/documents/${documentId}/blocks/${blockId}`,
        token,
        { method: 'DELETE' },
      ).catch(() => undefined)
      throw new Error(
        `上传图表失败：${uploaded.msg || uploaded.http}。请到飞书开放平台给系统配置里的同一应用开通「上传图片和附件到云文档」(docs:document.media:upload) 或 docs:doc，发布后再跑一次。`,
      )
    }
    const fileToken = String(uploaded.data.file_token || uploaded.data.token || '')
    if (!fileToken) throw new Error('上传图表未返回 file_token')
    const patched = await feishuJson(
      `https://${HOST}/open-apis/docx/v1/documents/${documentId}/blocks/${blockId}?document_revision_id=-1`,
      token,
      {
        method: 'PATCH',
        body: {
          replace_image: {
            token: fileToken,
            width: Math.min(900, size.width),
            height: size.height,
            align: 2,
          },
        },
      },
    )
    if (patched.code !== 0) {
      throw new Error(`绑定图表失败：${patched.msg || patched.http}`)
    }
  }
}

function stripMergeInfo(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripMergeInfo)
  if (!node || typeof node !== 'object') return node
  const obj = node as Record<string, unknown>
  const next: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'merge_info' || k === 'revision_id') continue
    next[k] = stripMergeInfo(v)
  }
  return next
}

async function insertConvertedBlocks(token: string, documentId: string, markdown: string): Promise<void> {
  const converted = await feishuJson(`https://${HOST}/open-apis/docx/v1/documents/blocks/convert`, token, {
    method: 'POST',
    body: { content_type: 'markdown', content: markdown.slice(0, 1_000_000) },
  })
  if (converted.code !== 0) {
    throw new Error(
      `Markdown 转文档块失败：${converted.msg || converted.http}。请开通并发布权限 docx:document.block:convert`,
    )
  }
  const first = (converted.data.first_level_block_ids as string[]) || []
  const blocks = stripMergeInfo(converted.data.blocks) as Record<string, unknown>[]
  if (!first.length || !Array.isArray(blocks) || !blocks.length) {
    throw new Error('转换结果为空')
  }
  const descendants = blocks.map((b) => {
    const copy = { ...b }
    delete copy.revision_id
    return copy
  })
  const url = `https://${HOST}/open-apis/docx/v1/documents/${documentId}/blocks/${documentId}/descendant?document_revision_id=-1`
  const out = await feishuJson(url, token, {
    method: 'POST',
    body: { index: -1, children_id: first, descendants },
  })
  if (out.code !== 0) throw new Error(`嵌套块写入失败：${out.msg || out.http}`)
}

async function resolveWikiParent(
  token: string,
  parentToken: string,
): Promise<{ spaceId: string; parentNodeToken: string }> {
  const out = await feishuJson(
    `https://${HOST}/open-apis/wiki/v2/spaces/get_node?token=${encodeURIComponent(parentToken)}`,
    token,
  )
  if (out.code !== 0) {
    throw new Error(
      `无法解析知识库父页面：${out.msg || out.http}（请确认应用已加入该文档库，且填的是 /wiki/… 节点）`,
    )
  }
  const node = (out.data.node && typeof out.data.node === 'object' ? out.data.node : out.data) as Record<
    string,
    unknown
  >
  const spaceId = String(node.space_id || '')
  const parentNodeToken = String(node.node_token || parentToken)
  const objType = String(node.obj_type || '').toLowerCase()
  if (objType === 'bitable') {
    throw new Error(
      '该 wiki 节点是多维表格，不能作为日报文档的父页面。请改填知识库中的文档或文件夹链接（地址栏 /wiki/…），每天会在其下新建一篇云文档。',
    )
  }
  if (!spaceId) throw new Error('知识库节点未返回 space_id')
  return { spaceId, parentNodeToken }
}

async function createWikiDoc(
  token: string,
  spaceId: string,
  parentNodeToken: string,
  title: string,
): Promise<{ documentId: string; url: string }> {
  const created = await feishuJson(
    `https://${HOST}/open-apis/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes`,
    token,
    {
      method: 'POST',
      body: {
        obj_type: 'docx',
        node_type: 'origin',
        title: title.slice(0, 800),
        parent_node_token: parentNodeToken,
      },
    },
  )
  if (created.code !== 0) {
    const raw = created.msg || String(created.http)
    const hint =
      raw.includes('wiki:node:create') || raw.includes('wiki:wiki')
        ? '当前飞书应用未开通知识库建文档权限。请到开放平台给 WorkBuddy 系统配置里的同一个 App 开通 wiki:wiki 或 wiki:node:create，以及 docx:document.block:convert，发布版本后把该应用添加到知识库。'
        : '请确认：1) 开放平台已开通 wiki 权限 2) 文档库成员里已添加本应用并可编辑'
    throw new Error(`在文档库创建失败：${raw}（${hint}）`)
  }
  const node = (created.data.node && typeof created.data.node === 'object'
    ? created.data.node
    : created.data) as Record<string, unknown>
  const documentId = String(node.obj_token || '')
  const nodeToken = String(node.node_token || '')
  if (!documentId) throw new Error('文档库创建成功但未返回 obj_token')
  const url = nodeToken ? `https://www.feishu.cn/wiki/${nodeToken}` : `https://www.feishu.cn/docx/${documentId}`
  return { documentId, url }
}

export function buildFeishuMarkdown(title: string, summary: string, charts: ReportChart[] = []): string {
  const body = String(summary || '').trim()
  const head = String(title || '').trim()
  if (!body) return ''
  const shown = head ? `# ${head}\n\n${body}` : body
  const extra = formatChartsMarkdown(sanitizeCharts(charts))
  return extra ? `${shown}\n\n${extra}` : shown
}

export function buildFeishuBodyMarkdown(title: string, summary: string): string {
  return buildFeishuMarkdown(title, summary, [])
}

export async function publishNewFeishuDoc(opts: {
  appId: string
  appSecret: string
  parentToken: string
  title: string
  markdown: string
  charts?: ReportChart[]
}): Promise<{ url: string; documentId: string; chartWarning?: string }> {
  const parent = normalizeWikiToken(opts.parentToken)
  if (!parent) throw new Error('未填写飞书知识库父页面')
  const md = String(opts.markdown || '').trim()
  if (!md) throw new Error('报告正文为空，拒绝写入飞书')
  const token = await getTenantToken(opts.appId, opts.appSecret)
  const { spaceId, parentNodeToken } = await resolveWikiParent(token, parent)
  const created = await createWikiDoc(token, spaceId, parentNodeToken, opts.title)
  const charts = sanitizeCharts(opts.charts)
  const pngs = charts.length ? renderChartPngs(charts) : []
  await insertConvertedBlocks(token, created.documentId, md)
  let chartWarning: string | undefined
  if (pngs.length) {
    try {
      await insertConvertedBlocks(token, created.documentId, '## 数据图示')
      await insertChartImages(token, created.documentId, pngs)
    } catch (e) {
      chartWarning = e instanceof Error ? e.message : String(e)
      await insertConvertedBlocks(token, created.documentId, formatChartsMarkdown(charts))
    }
  } else if (charts.length) {
    await insertConvertedBlocks(token, created.documentId, formatChartsMarkdown(charts))
    chartWarning = '本机未能生成图表图片（需要 python3 + matplotlib），飞书文档已用表格代替。'
  }
  return { ...created, chartWarning }
}

export async function deliverFeishuDoc(opts: {
  automation: Automation
  title: string
  summary: string
  charts?: ReportChart[]
}): Promise<{
  feishu_status: DeliveryStatus
  feishu_error?: string
  feishu_url?: string
}> {
  const dest = resolveFeishuDocSync(opts.automation)
  if (!dest.enabled) return { feishu_status: 'skipped' }
  let parent = ''
  try {
    parent = normalizeWikiToken(dest.parent_token)
  } catch (e) {
    return { feishu_status: 'failed', feishu_error: e instanceof Error ? e.message : String(e) }
  }
  if (!parent) {
    return { feishu_status: 'skipped', feishu_error: '未填写知识库父页面（请填 /wiki/… 链接或节点 token）' }
  }
  const app = resolveFeishuApp()
  if (!app.appId || !app.appSecret) {
    return {
      feishu_status: 'skipped',
      feishu_error: '未配置飞书应用。请到 WorkBuddy「系统配置 → 自动化推送」填写飞书 App ID / Secret',
    }
  }
  const markdown = buildFeishuBodyMarkdown(opts.title, opts.summary)
  if (!markdown) return { feishu_status: 'failed', feishu_error: '摘要为空，未写入飞书文档' }
  try {
    const created = await publishNewFeishuDoc({
      appId: app.appId,
      appSecret: app.appSecret,
      parentToken: parent,
      title: opts.title,
      markdown,
      charts: opts.charts,
    })
    return { feishu_status: 'sent', feishu_url: created.url, feishu_error: created.chartWarning }
  } catch (e) {
    return {
      feishu_status: 'failed',
      feishu_error: e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500),
    }
  }
}
