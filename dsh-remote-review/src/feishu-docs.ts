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

function simpleTextBlocks(markdown: string): Record<string, unknown>[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const blocks: Record<string, unknown>[] = []
  const flush = (text: string, type: number, key: string) => {
    const content = text.slice(0, 8000)
    if (!content.trim() && type === 2) {
      blocks.push({
        block_type: 2,
        text: { elements: [{ text_run: { content: ' ' } }] },
      })
      return
    }
    blocks.push({
      block_type: type,
      [key]: { elements: [{ text_run: { content: content || ' ' } }] },
    })
  }
  for (const line of lines) {
    if (line.startsWith('### ')) flush(line.slice(4), 5, 'heading3')
    else if (line.startsWith('## ')) flush(line.slice(3), 4, 'heading2')
    else if (line.startsWith('# ')) flush(line.slice(2), 3, 'heading1')
    else if (/^[-*] /.test(line)) flush(line.replace(/^[-*] /, ''), 12, 'bullet')
    else flush(line, 2, 'text')
  }
  return blocks.length ? blocks : [{ block_type: 2, text: { elements: [{ text_run: { content: markdown.slice(0, 8000) || ' ' } }] } }]
}

async function insertSimpleBlocks(token: string, documentId: string, markdown: string): Promise<void> {
  const blocks = simpleTextBlocks(markdown)
  const url = `https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}/blocks/${documentId}/children?document_revision_id=-1`
  for (let i = 0; i < blocks.length; i += 40) {
    const chunk = blocks.slice(i, i + 40)
    const out = await feishuJson(url, token, { method: 'POST', body: { children: chunk, index: -1 } })
    if (out.code !== 0) throw new Error(`插入文档块失败：${out.msg || out.http}`)
  }
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
    const created = await feishuJson('https://open.feishu.cn/open-apis/docx/v1/documents', token, {
      method: 'POST',
      body: {
        title: opts.title.slice(0, 800),
        folder_token: opts.cfg.feishu.folderToken || undefined,
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

    try {
      await insertConvertedBlocks(token, documentId, opts.markdown)
    } catch (convErr) {
      console.warn('[remote-review] Markdown 转块失败，降级为简单块：', String(convErr))
      try {
        await insertSimpleBlocks(token, documentId, opts.markdown)
      } catch (simpleErr) {
        throw new Error(`转换失败(${String(convErr)})；简单块写入亦失败(${String(simpleErr)})`)
      }
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
