/**
 * 飞书云文档：知识库 /wiki/ 链接当父节点，在其下新建一篇（不往父文档正文追加）。
 * 凭证只读系统配置 App ID/Secret。不另起 MCP 进程。
 * 对话里用户明确要求落文档时用；自动化任务定时落库仍走自动化插件。
 */
import type { ConnectorConfig, QueryResult } from '../types.js'
import { readWorkbuddyIm } from '../workbuddy_im.js'

const HOST = 'open.feishu.cn'

type FeishuJson = { http: number; code: number; msg: string; data: Record<string, unknown> }

export type FeishuTarget =
  | { kind: 'docx'; token: string }
  | { kind: 'folder'; token: string }
  | { kind: 'wiki'; token: string }
  | { kind: 'none' }

/** 解析飞书文档 / 文件夹 / 知识库链接。多维表格拒绝。 */
export function parseFeishuTarget(raw: string): FeishuTarget {
  const text = String(raw || '').trim()
  if (!text) return { kind: 'none' }
  const lower = text.toLowerCase()
  if (lower.includes('/base/') || lower.includes('/basex/')) {
    throw new Error('请填飞书文档 /docx/…，不是多维表格 /base/')
  }
  const docx = text.match(/(?:^|\/)docx\/([^/?#]+)/i)
  if (docx) return { kind: 'docx', token: docx[1].trim() }
  const folder = text.match(/(?:^|\/)(?:drive\/)?folder\/([^/?#]+)/i)
  if (folder) return { kind: 'folder', token: folder[1].trim() }
  const wiki = text.match(/(?:^|\/)wiki\/([^/?#]+)/i)
  if (wiki) return { kind: 'wiki', token: wiki[1].trim() }
  if (text.includes('://') || lower.includes('feishu.cn') || lower.includes('larksuite.com')) {
    throw new Error('无法解析飞书链接。请粘贴云文档 /docx/… ，或云空间文件夹 /drive/folder/…')
  }
  if (/^fld/i.test(text)) return { kind: 'folder', token: text }
  return { kind: 'docx', token: text }
}

/** @deprecated 兼容旧测试：只认 /wiki/ 。新代码用 parseFeishuTarget。 */
export function normalizeWikiToken(raw: string): string {
  const hit = parseFeishuTarget(raw)
  if (hit.kind === 'wiki') return hit.token
  if (hit.kind === 'none') return ''
  throw new Error('请填知识库 /wiki/… 链接，或改用飞书文档 /docx/…')
}

function resolveApp(_cfg: ConnectorConfig | undefined): { appId: string; appSecret: string } {
  const wb = readWorkbuddyIm()
  return {
    appId: wb.feishuAppId,
    appSecret: wb.feishuAppSecret,
  }
}

async function feishuJson(
  url: string,
  token: string | null,
  init?: { method?: string; body?: unknown },
): Promise<FeishuJson> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8' }
  if (token) headers.Authorization = `Bearer ${token}`
  const method = init?.method || (init?.body === undefined ? 'GET' : 'POST')
  const res = await fetch(url, {
    method,
    headers,
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
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
    method: 'POST',
    body: { app_id: appId, app_secret: appSecret },
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

async function insertConvertedBlocks(token: string, documentId: string, markdown: string): Promise<void> {
  const converted = await feishuJson(`https://${HOST}/open-apis/docx/v1/documents/blocks/convert`, token, {
    method: 'POST',
    body: { content_type: 'markdown', content: markdown.slice(0, 200000) },
  })
  if (converted.code !== 0) {
    throw new Error(
      `Markdown 转文档失败：${converted.msg || converted.http}。请给系统配置里的飞书应用开通 docx:document.block:convert 并发布。`,
    )
  }
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
    { method: 'POST', body: { index: -1, children_id: first, descendants } },
  )
  if (written.code !== 0) throw new Error(`写入正文失败：${written.msg || written.http}`)
}

async function createCloudDoc(
  token: string,
  title: string,
  folderToken = '',
): Promise<{ documentId: string; url: string }> {
  const body: Record<string, string> = { title: title.slice(0, 800) }
  if (folderToken) body.folder_token = folderToken
  const created = await feishuJson(`https://${HOST}/open-apis/docx/v1/documents`, token, { method: 'POST', body })
  if (created.code !== 0) {
    throw new Error(
      `创建飞书文档失败：${created.msg || created.http}。请开通 docx:document 或 docx:document:create；` +
        '或改填已有 /docx/ 链接，并把本应用加为该文档「可编辑」协作者。',
    )
  }
  const doc = (created.data.document && typeof created.data.document === 'object'
    ? created.data.document
    : created.data) as Record<string, unknown>
  const documentId = String(doc.document_id || created.data.document_id || '')
  if (!documentId) throw new Error('创建成功但未返回 document_id')
  return { documentId, url: `https://www.feishu.cn/docx/${documentId}` }
}

async function loadWikiNode(
  token: string,
  parent: string,
): Promise<{ spaceId: string; nodeToken: string; objType: string; objToken: string; title: string }> {
  const nodeRes = await feishuJson(
    `https://${HOST}/open-apis/wiki/v2/spaces/get_node?token=${encodeURIComponent(parent)}`,
    token,
  )
  if (nodeRes.code !== 0) {
    throw new Error(
      `读不到该飞书链接：${nodeRes.msg || nodeRes.http}。请确认应用已加入该知识库/文档，并有可编辑权限。`,
    )
  }
  const node = (nodeRes.data.node && typeof nodeRes.data.node === 'object' ? nodeRes.data.node : nodeRes.data) as Record<
    string,
    unknown
  >
  const objType = String(node.obj_type || '')
  if (objType.toLowerCase() === 'bitable') {
    throw new Error('该链接是多维表格。请改用飞书文档（地址栏含 /docx/ 或知识库里的文档页 /wiki/）。')
  }
  const spaceId = String(node.space_id || '')
  const nodeToken = String(node.node_token || parent)
  const objToken = String(node.obj_token || '')
  const title = String(node.title || '')
  if (!spaceId) throw new Error('节点未返回 space_id')
  return { spaceId, nodeToken, objType, objToken, title }
}

async function createWikiDoc(
  token: string,
  parent: string,
  title: string,
): Promise<{ documentId: string; url: string }> {
  const node = await loadWikiNode(token, parent)
  const created = await feishuJson(
    `https://${HOST}/open-apis/wiki/v2/spaces/${encodeURIComponent(node.spaceId)}/nodes`,
    token,
    {
      method: 'POST',
      body: {
        obj_type: 'docx',
        node_type: 'origin',
        title: title.slice(0, 800),
        parent_node_token: node.nodeToken,
      },
    },
  )
  if (created.code !== 0) {
    throw new Error(`在知识库创建失败：${created.msg || created.http}。建议改用云文档 /docx/，不必走知识库。`)
  }
  const createdNode = (created.data.node && typeof created.data.node === 'object'
    ? created.data.node
    : created.data) as Record<string, unknown>
  const documentId = String(createdNode.obj_token || '')
  const nodeToken = String(createdNode.node_token || '')
  if (!documentId) throw new Error('创建成功但未返回 obj_token')
  const url = nodeToken ? `https://www.feishu.cn/wiki/${nodeToken}` : `https://www.feishu.cn/docx/${documentId}`
  return { documentId, url }
}

export async function probeFeishu(cfg: ConnectorConfig): Promise<QueryResult> {
  const app = resolveApp(cfg)
  if (!app.appId || !app.appSecret) {
    if (cfg.mode === 'mock') {
      return { ok: true, source: 'mock', detail: 'mock：不写飞书。系统配置填好 App 后点测通，会验登录和文档链接。' }
    }
    return {
      ok: false,
      source: 'none',
      code: 'connector_unconfigured',
      detail: '未配置飞书应用。请到 WorkBuddy「系统配置 → 自动化推送」填写飞书 App ID / Secret。',
    }
  }
  try {
    const token = await tenantToken(app.appId, app.appSecret)
    const raw = String(cfg.docTarget || '').trim()
    if (!raw) {
      return {
        ok: true,
        source: 'http',
        detail: '已登录飞书应用。未填文档链接时，写入会新建一篇。测通未写正文。',
      }
    }
    const target = parseFeishuTarget(raw)
    if (target.kind === 'wiki') {
      const node = await loadWikiNode(token, target.token)
      return {
        ok: true,
        source: 'http',
        detail: `已定位知识库节点「${node.title || node.nodeToken}」，测通成功。写入会在其下新建一篇文档，不会改这篇的正文。`,
      }
    }
    if (target.kind === 'docx') {
      const doc = await feishuJson(
        `https://${HOST}/open-apis/docx/v1/documents/${encodeURIComponent(target.token)}`,
        token,
      )
      if (doc.code !== 0) {
        throw new Error(`读不到该云文档：${doc.msg || doc.http}。请把本应用加为文档「可编辑」协作者。`)
      }
      const rec = doc.data.document && typeof doc.data.document === 'object' ? (doc.data.document as Record<string, unknown>) : {}
      const title = String(rec.title || target.token)
      return { ok: true, source: 'http', detail: `已定位云文档「${title}」，测通成功。写入会追加（未写正文）。` }
    }
    return { ok: true, source: 'http', detail: '已登录飞书应用。测通未写正文。' }
  } catch (e) {
    return { ok: false, source: 'http', code: 'connect_failed', detail: e instanceof Error ? e.message : String(e) }
  }
}

export async function writeFeishuDoc(
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
      detail: '飞书连接器未启用。请到「专家·技能·连接器」打开。定时落库请用自动化任务。',
    }
  }
  const heading = String(title || '').trim().slice(0, 80)
  const md = String(markdown || '').trim()
  if (!heading) return { ok: false, source: 'none', code: 'invalid_kind', detail: '标题不能为空' }
  if (!md) return { ok: false, source: 'none', code: 'invalid_kind', detail: '正文不能为空' }
  let target: FeishuTarget
  try {
    target = parseFeishuTarget(targetRaw || cfg.docTarget || '')
  } catch (e) {
    return { ok: false, source: 'none', code: 'invalid_kind', detail: e instanceof Error ? e.message : String(e) }
  }
  if (cfg.mode === 'mock') {
    return { ok: true, source: 'mock', detail: 'mock：未写入飞书', data: { title: heading, target } }
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
    let documentId = ''
    let url = ''
    let action = '写入'
    if (target.kind === 'docx') {
      documentId = target.token
      url = `https://www.feishu.cn/docx/${documentId}`
      action = '追加写入'
      await insertConvertedBlocks(token, documentId, md)
    } else if (target.kind === 'wiki') {
      const created = await createWikiDoc(token, target.token, heading)
      documentId = created.documentId
      url = created.url
      action = '新建'
      await insertConvertedBlocks(token, documentId, md)
    } else {
      const created = await createCloudDoc(token, heading, target.kind === 'folder' ? target.token : '')
      documentId = created.documentId
      url = created.url
      action = '新建'
      await insertConvertedBlocks(token, documentId, md)
    }
    return { ok: true, source: 'http', detail: `已${action}飞书文档：${url}`, data: { url, documentId, action } }
  } catch (e) {
    return { ok: false, source: 'http', code: 'connect_failed', detail: e instanceof Error ? e.message : String(e) }
  }
}

/** @deprecated 用 writeFeishuDoc */
export async function writeFeishuWiki(
  cfg: ConnectorConfig | undefined,
  title: string,
  markdown: string,
  parentRaw: string,
): Promise<QueryResult> {
  return writeFeishuDoc(cfg, title, markdown, parentRaw)
}
