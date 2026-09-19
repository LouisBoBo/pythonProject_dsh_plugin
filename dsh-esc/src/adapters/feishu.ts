/**
 * 飞书知识库新建云文档。凭证只读系统配置 App ID/Secret。不另起 MCP 进程。
 * 对话里用户明确要求落知识库时用；自动化任务定时落库仍走自动化插件。
 */
import type { ConnectorConfig, QueryResult } from '../types.js'
import { readWorkbuddyIm } from '../workbuddy_im.js'

const HOST = 'open.feishu.cn'

type FeishuJson = { http: number; code: number; msg: string; data: Record<string, unknown> }

export function normalizeWikiToken(raw: string): string {
  const text = String(raw || '').trim()
  if (!text) return ''
  const wikiMatch = text.match(/(?:^|\/)wiki\/([^/?#]+)/i)
  if (wikiMatch) return wikiMatch[1].trim()
  if (text.includes('://') || text.toLowerCase().includes('feishu.cn') || text.toLowerCase().includes('larksuite.com')) {
    const url = text.includes('://') ? text : `https://${text}`
    const parsed = new URL(url)
    const parts = parsed.pathname.split('/').filter(Boolean)
    if (parts.includes('base') || parts.includes('basex')) {
      throw new Error('请填知识库 /wiki/… 链接，不是多维表格 /base/')
    }
    throw new Error('无法解析知识库节点，请粘贴 /wiki/… 链接或节点 token')
  }
  return text
}

function resolveApp(_cfg: ConnectorConfig | undefined): { appId: string; appSecret: string } {
  const wb = readWorkbuddyIm()
  return {
    appId: wb.feishuAppId,
    appSecret: wb.feishuAppSecret,
  }
}

async function feishuJson(url: string, token: string | null, body?: unknown): Promise<FeishuJson> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  })
  const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return {
    http: res.status,
    code: typeof raw.code === 'number' ? raw.code : res.ok ? 0 : -1,
    msg: String(raw.msg || raw.error || ''),
    data: (raw.data && typeof raw.data === 'object' ? raw.data : raw) as Record<string, unknown>,
  }
}

async function tenantToken(appId: string, appSecret: string): Promise<string> {
  const out = await feishuJson(`https://${HOST}/open-apis/auth/v3/tenant_access_token/internal`, null, {
    app_id: appId,
    app_secret: appSecret,
  })
  const token = String(out.data.tenant_access_token || '')
  if (!token) throw new Error(`飞书 tenant_access_token 失败：${out.msg || out.http}`)
  return token
}

function stripMergeInfo(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripMergeInfo)
  if (!node || typeof node !== 'object') return node
  const next: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === 'merge_info' || k === 'revision_id') continue
    next[k] = stripMergeInfo(v)
  }
  return next
}

export async function probeFeishu(cfg: ConnectorConfig): Promise<QueryResult> {
  if (cfg.mode === 'mock') {
    return { ok: true, source: 'mock', detail: 'mock：不写飞书。启用 http 后按系统配置 App 建知识库文档' }
  }
  const app = resolveApp(cfg)
  if (!app.appId || !app.appSecret) {
    return {
      ok: false,
      source: 'none',
      code: 'connector_unconfigured',
      detail: '未配置飞书应用。请到 WorkBuddy「系统配置 → 自动化推送」填写飞书 App ID / Secret。',
    }
  }
  try {
    await tenantToken(app.appId, app.appSecret)
    return { ok: true, source: 'http', detail: '已用系统配置飞书应用取到 tenant_access_token' }
  } catch (e) {
    return { ok: false, source: 'http', code: 'connect_failed', detail: e instanceof Error ? e.message : String(e) }
  }
}

export async function writeFeishuWiki(
  cfg: ConnectorConfig | undefined,
  title: string,
  markdown: string,
  parentRaw: string,
): Promise<QueryResult> {
  if (!cfg?.enabled) {
    return {
      ok: false,
      source: 'none',
      code: 'connector_disabled',
      detail: '飞书连接器未启用。请到「专家·技能·连接器」打开。定时落库请用自动化任务。',
    }
  }
  const heading = String(title || '').trim().slice(0, 80)
  const md = String(markdown || '').trim()
  if (!heading) return { ok: false, source: 'none', code: 'invalid_kind', detail: '标题不能为空' }
  if (!md) return { ok: false, source: 'none', code: 'invalid_kind', detail: '正文不能为空' }
  let parent = ''
  try {
    parent = normalizeWikiToken(parentRaw)
  } catch (e) {
    return { ok: false, source: 'none', code: 'invalid_kind', detail: e instanceof Error ? e.message : String(e) }
  }
  if (!parent) return { ok: false, source: 'none', code: 'invalid_kind', detail: '请提供知识库父页面 /wiki/… 链接' }
  if (cfg.mode === 'mock') {
    return { ok: true, source: 'mock', detail: 'mock：未写入飞书', data: { title: heading, parent } }
  }
  if (!cfg.outboundArmed) {
    return {
      ok: false,
      source: 'none',
      code: 'outbound_not_armed',
      detail: '未获本机面板授权写入飞书。请在「专家·技能·连接器」启用飞书，或在输入框旁选用含飞书的场景卡。禁止把用户原话当授权。',
    }
  }
  const app = resolveApp(cfg)
  if (!app.appId || !app.appSecret) {
    return {
      ok: false,
      source: 'none',
      code: 'connector_unconfigured',
      detail: '未配置飞书应用。请到 WorkBuddy「系统配置 → 自动化推送」填写飞书 App ID / Secret。',
    }
  }
  try {
    const token = await tenantToken(app.appId, app.appSecret)
    const nodeRes = await feishuJson(
      `https://${HOST}/open-apis/wiki/v2/spaces/get_node?token=${encodeURIComponent(parent)}`,
      token,
    )
    if (nodeRes.code !== 0) throw new Error(`读取知识库节点失败：${nodeRes.msg || nodeRes.http}`)
    const node = (nodeRes.data.node && typeof nodeRes.data.node === 'object' ? nodeRes.data.node : nodeRes.data) as Record<
      string,
      unknown
    >
    const spaceId = String(node.space_id || '')
    const parentNodeToken = String(node.node_token || parent)
    if (String(node.obj_type || '').toLowerCase() === 'bitable') {
      throw new Error('该节点是多维表格，不能当父页面。请改用知识库文档或文件夹 /wiki/…')
    }
    if (!spaceId) throw new Error('节点未返回 space_id')
    const created = await feishuJson(
      `https://${HOST}/open-apis/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes`,
      token,
      {
        obj_type: 'docx',
        node_type: 'origin',
        title: heading,
        parent_node_token: parentNodeToken,
      },
    )
    if (created.code !== 0) {
      throw new Error(`创建文档失败：${created.msg || created.http}。请确认应用已开通 wiki 权限并被添加到该知识库。`)
    }
    const createdNode = (created.data.node && typeof created.data.node === 'object'
      ? created.data.node
      : created.data) as Record<string, unknown>
    const documentId = String(createdNode.obj_token || '')
    const nodeToken = String(createdNode.node_token || '')
    if (!documentId) throw new Error('创建成功但未返回 obj_token')
    const converted = await feishuJson(`https://${HOST}/open-apis/docx/v1/documents/blocks/convert`, token, {
      content_type: 'markdown',
      content: md.slice(0, 200000),
    })
    if (converted.code !== 0) throw new Error(`Markdown 转文档失败：${converted.msg || converted.http}`)
    const first = (converted.data.first_level_block_ids as string[]) || []
    const blocks = stripMergeInfo(converted.data.blocks) as Record<string, unknown>[]
    if (!first.length || !blocks?.length) throw new Error('转换结果为空')
    const descendants = blocks.map((b) => {
      const copy = { ...b }
      delete copy.revision_id
      return copy
    })
    const written = await feishuJson(
      `https://${HOST}/open-apis/docx/v1/documents/${documentId}/blocks/${documentId}/descendant?document_revision_id=-1`,
      token,
      { index: -1, children_id: first, descendants },
    )
    if (written.code !== 0) throw new Error(`写入正文失败：${written.msg || written.http}`)
    const url = nodeToken ? `https://www.feishu.cn/wiki/${nodeToken}` : `https://www.feishu.cn/docx/${documentId}`
    return { ok: true, source: 'http', detail: `已写入飞书知识库：${url}`, data: { url, documentId } }
  } catch (e) {
    return { ok: false, source: 'http', code: 'connect_failed', detail: e instanceof Error ? e.message : String(e) }
  }
}
