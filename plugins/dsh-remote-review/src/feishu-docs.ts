import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RemoteReviewConfig } from './types.js'
import { feishuReady } from './config.js'

type FeishuResult = {
  ok: boolean
  mode: 'feishu' | 'local-file'
  url?: string
  documentId?: string
  localPath?: string
  detail?: string
}

type TokenCache = { token: string; exp: number; appId: string }
let tokenCache: TokenCache | null = null

async function feishuJson(
  url: string,
  token: string,
  init?: { method?: string; body?: unknown },
): Promise<{ http: number; code: number; msg: string; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: init?.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
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

export async function getTenantToken(cfg: RemoteReviewConfig): Promise<string> {
  if (tokenCache && tokenCache.appId === cfg.feishu.appId && Date.now() < tokenCache.exp - 60_000) {
    return tokenCache.token
  }
  const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: cfg.feishu.appId, app_secret: cfg.feishu.appSecret }),
    signal: AbortSignal.timeout(20_000),
  })
  const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>
  const token = String(raw.tenant_access_token || '')
  if (!token) {
    throw new Error(`飞书 tenant_access_token 失败：${raw.msg || raw.error || res.status}`)
  }
  const expireSec = typeof raw.expire === 'number' ? raw.expire : 7200
  tokenCache = { token, exp: Date.now() + expireSec * 1000, appId: cfg.feishu.appId }
  return token
}

function stripMergeInfo(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripMergeInfo)
  if (!node || typeof node !== 'object') return node
  const obj = node as Record<string, unknown>
  const next: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'merge_info') continue
    if (k === 'revision_id') continue
    next[k] = stripMergeInfo(v)
  }
  return next
}

async function insertConvertedBlocks(token: string, documentId: string, markdown: string): Promise<void> {
  const converted = await feishuJson(
    'https://open.feishu.cn/open-apis/docx/v1/documents/blocks/convert',
    token,
    { method: 'POST', body: { content_type: 'markdown', content: markdown.slice(0, 1_000_000) || '（空报告）' } },
  )
  if (converted.code !== 0) {
    throw new Error(`Markdown 转文档块失败：${converted.msg || converted.http}`)
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
  const url = `https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}/blocks/${documentId}/descendant?document_revision_id=-1`
  const out = await feishuJson(url, token, {
    method: 'POST',
    body: { index: -1, children_id: first, descendants },
  })
  if (out.code !== 0) throw new Error(`嵌套块写入失败：${out.msg || out.http}`)
}

function writeLocalDoc(cfg: RemoteReviewConfig, title: string, markdown: string): string {
  const dir = join(cfg.dataRoot, 'feishu-out')
  mkdirSync(dir, { recursive: true })
  const safe = title.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80)
  const path = join(dir, `${safe}-${Date.now()}.md`)
  writeFileSync(path, markdown, 'utf8')
  return path
}

async function createInWiki(
  token: string,
  cfg: RemoteReviewConfig,
  title: string,
): Promise<{ documentId: string; url: string }> {
  const spaceId = cfg.feishu.wikiSpaceId.trim()
  const body: Record<string, string> = {
    obj_type: 'docx',
    node_type: 'origin',
    title: title.slice(0, 800),
  }
  const parent = cfg.feishu.wikiParentNodeToken.trim()
  if (parent) body.parent_node_token = parent

  const created = await feishuJson(
    `https://open.feishu.cn/open-apis/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes`,
    token,
    { method: 'POST', body },
  )
  if (created.code !== 0) {
    throw new Error(
      `在文档库创建失败：${created.msg || created.http}（请确认：1) 开放平台已开通 wiki 权限 2) 文档库成员里已添加本应用并可编辑）`,
    )
  }
  const node = (created.data.node && typeof created.data.node === 'object'
    ? created.data.node
    : created.data) as Record<string, unknown>
  const documentId = String(node.obj_token || '')
  const nodeToken = String(node.node_token || '')
  if (!documentId) throw new Error('文档库创建成功但未返回 obj_token')
  const url = nodeToken
    ? `https://www.feishu.cn/wiki/${nodeToken}`
    : `https://www.feishu.cn/docx/${documentId}`
  return { documentId, url }
}

async function createInDrive(
  token: string,
  cfg: RemoteReviewConfig,
  title: string,
): Promise<{ documentId: string; url: string }> {
  const created = await feishuJson('https://open.feishu.cn/open-apis/docx/v1/documents', token, {
    method: 'POST',
    body: {
      title: title.slice(0, 800),
      folder_token: cfg.feishu.folderToken.trim() || undefined,
    },
  })
  if (created.code !== 0) {
    throw new Error(`创建飞书文档失败：${created.msg || created.http}`)
  }
  const document = (created.data.document && typeof created.data.document === 'object'
    ? created.data.document
    : created.data) as Record<string, unknown>
  const documentId = String(document.document_id || document.documentId || '')
  if (!documentId) throw new Error('创建飞书文档未返回 document_id')
  const url = String(document.url || `https://www.feishu.cn/docx/${documentId}`)
  return { documentId, url }
}

/** 列出应用可见的文档库，便于用户抄 space_id */
export async function listWikiSpaces(cfg: RemoteReviewConfig): Promise<{
  ok: boolean
  detail?: string
  spaces: Array<{ spaceId: string; name: string; description: string }>
}> {
  if (!feishuReady(cfg)) return { ok: false, detail: '飞书未配置', spaces: [] }
  try {
    const token = await getTenantToken(cfg)
    const out = await feishuJson(
      'https://open.feishu.cn/open-apis/wiki/v2/spaces?page_size=50',
      token,
    )
    if (out.code !== 0) {
      return { ok: false, detail: out.msg || String(out.http), spaces: [] }
    }
    const items = (out.data.items as unknown[]) || []
    const spaces = items.map((raw) => {
      const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
      return {
        spaceId: String(s.space_id || ''),
        name: String(s.name || ''),
        description: String(s.description || ''),
      }
    }).filter((s) => s.spaceId)
    return { ok: true, spaces }
  } catch (err) {
    return { ok: false, detail: String(err), spaces: [] }
  }
}

export async function publishReviewToFeishu(opts: {
  cfg: RemoteReviewConfig
  title: string
  markdown: string
}): Promise<FeishuResult> {
  const localPath = writeLocalDoc(opts.cfg, opts.title, opts.markdown)
  if (!feishuReady(opts.cfg)) {
    return {
      ok: false,
      mode: 'local-file',
      localPath,
      detail: '飞书 App ID/Secret 未配置：报告已落本地 md，配置后可用 remote_review_retry_feishu 补发',
    }
  }

  try {
    const token = await getTenantToken(opts.cfg)
    const created = opts.cfg.feishu.wikiSpaceId.trim()
      ? await createInWiki(token, opts.cfg, opts.title)
      : await createInDrive(token, opts.cfg, opts.title)
    const { documentId, url } = created

    // 强制按 Markdown 写入飞书新版文档；转换失败则整单失败，不再降级为纯文本块
    // （降级后飞书里只剩一行行白文，标题/列表/代码块都会丢）
    const md = String(opts.markdown || '').trim()
    if (!md) {
      throw new Error('报告正文为空，拒绝写入飞书（须为 Markdown）')
    }
    try {
      await insertConvertedBlocks(token, documentId, md)
    } catch (convErr) {
      throw new Error(
        `飞书要求以 Markdown 写入失败：${String(convErr)}。` +
          `请在开放平台开通并发布权限 docx:document.block:convert（Markdown 转文档块），勿使用纯文本降级。`,
      )
    }

    return { ok: true, mode: 'feishu', url, documentId, localPath }
  } catch (err) {
    return {
      ok: false,
      mode: 'local-file',
      localPath,
      detail: String(err),
    }
  }
}
