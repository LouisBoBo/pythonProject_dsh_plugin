import type { ConnectorConfig, QueryResult } from '../types.js'
import { truncate } from '../util.js'

export async function probeDify(cfg: ConnectorConfig): Promise<QueryResult> {
  if (cfg.mode === 'mock') {
    return { ok: true, source: 'mock', detail: 'Dify 当前无 datasetId 时请用 http 配置；mock 仅表示「跳过真检索」' }
  }
  if (!cfg.baseUrl.trim() || !cfg.apiKey.trim() || !cfg.datasetId.trim()) {
    return {
      ok: false,
      source: 'none',
      code: 'connector_unconfigured',
      detail: 'Dify 需要 Base URL、API Key、datasetId。当前无现成知识库 id 时可先不启用检索。',
    }
  }
  const result = await searchDify(cfg, '连通性探测')
  return result
}

export async function searchDify(cfg: ConnectorConfig, query: string): Promise<QueryResult> {
  if (!cfg.enabled) {
    return {
      ok: false,
      source: 'none',
      code: 'connector_disabled',
      detail: 'Dify 连接器未启用。请到左侧栏打开，或仅根据用户粘贴文本分析，禁止编造知识库条目。',
    }
  }
  if (!cfg.baseUrl.trim() || !cfg.apiKey.trim() || !cfg.datasetId.trim()) {
    return {
      ok: false,
      source: 'none',
      code: 'connector_unconfigured',
      detail: '未配置 Dify datasetId（或地址/密钥）。请跳过检索，只根据对话原文分析，禁止编造知识库命中。',
    }
  }
  const q = query.trim()
  if (!q) {
    return { ok: false, source: 'none', code: 'invalid_query', detail: '检索词不能为空' }
  }
  const base = cfg.baseUrl.trim().replace(/\/+$/, '')
  const url = `${base}/datasets/${encodeURIComponent(cfg.datasetId.trim())}/retrieve`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: q,
        retrieval_model: {
          search_method: 'semantic_search',
          reranking_enable: false,
          top_k: 4,
        },
      }),
      signal: AbortSignal.timeout(20000),
    })
    const text = await res.text()
    if (!res.ok) {
      return {
        ok: false,
        source: 'http',
        code: 'dify_failed',
        detail: `Dify 检索失败 HTTP ${res.status}：${text.slice(0, 180)}`,
      }
    }
    let data: unknown = text
    try {
      data = JSON.parse(text)
    } catch {
      data = { raw: truncate(text, 4000) }
    }
    return { ok: true, source: 'http', detail: 'Dify 检索完成', data }
  } catch (e) {
    return {
      ok: false,
      source: 'http',
      code: 'dify_failed',
      detail: e instanceof Error ? e.message : String(e),
    }
  }
}
