/**
 * 对接 ModelScope 上的 @antvis/mcp-server-chart。
 * 不另起 MCP 子进程（避免占用端口、影响其它插件）；调用该 MCP 默认的 GPT-Vis HTTP，工具名与 MCP 一致。
 * 文档：https://www.modelscope.cn/mcp/servers/@antvis/mcp-server-chart
 */
import type { ConnectorConfig, QueryResult } from '../types.js'
import { sanitizeMdImageUrl } from '../util.js'
import { assertPublicHttpUrl, isPrivateHttpHost } from './web_read.js'

export const DEFAULT_VIS_URL = 'https://antv-studio.alipay.com/api/gpt-vis'
export const CHART_TYPES = ['bar', 'column', 'line', 'pie', 'area', 'funnel', 'radar', 'dual-axes'] as const
export type ChartType = (typeof CHART_TYPES)[number]

export type ChartPoint = { label: string; value: number }

export function normalizeChartType(raw: string): ChartType | null {
  const s = String(raw || '').trim().toLowerCase()
  return (CHART_TYPES as readonly string[]).includes(s) ? (s as ChartType) : null
}

export function parseChartSeries(labelsRaw: string, valuesRaw: string): ChartPoint[] | { error: string } {
  const labels = String(labelsRaw || '')
    .split(/[,，|]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12)
  const values = String(valuesRaw || '')
    .split(/[,，|]/)
    .map((s) => Number(s.trim()))
  if (labels.length < 2) return { error: '至少 2 个分类' }
  if (values.length !== labels.length) return { error: 'labels 与 values 数量必须一致' }
  if (values.some((n) => !Number.isFinite(n))) return { error: 'values 必须是数字' }
  return labels.map((label, i) => ({ label, value: values[i] as number }))
}

export function buildGptVisPayload(
  type: ChartType,
  title: string,
  points: ChartPoint[],
  points2?: ChartPoint[],
): Record<string, unknown> {
  const heading = String(title || '').trim().slice(0, 80)
  if (type === 'dual-axes') {
    return {
      type,
      title: heading,
      theme: 'academy',
      locale: 'zh-CN',
      categories: points.map((p) => p.label),
      series: [
        { type: 'column', data: points.map((p) => p.value), axisYTitle: '实际' },
        { type: 'line', data: (points2 || []).map((p) => p.value), axisYTitle: '计划' },
      ],
    }
  }
  const data =
    type === 'line' || type === 'area'
      ? points.map((p) => ({ time: p.label, value: p.value }))
      : type === 'radar'
        ? points.map((p) => ({ name: p.label, value: p.value }))
        : points.map((p) => ({ category: p.label, value: p.value }))
  const extra = type === 'radar' ? { align: true } : {}
  return { type, title: heading, theme: 'academy', locale: 'zh-CN', data, ...extra }
}

export function visEndpoint(cfg: ConnectorConfig): string {
  const raw = cfg.baseUrl.trim()
  if (!raw) return DEFAULT_VIS_URL
  const url = assertPublicHttpUrl(raw)
  if (url.protocol !== 'https:') throw new Error('图表服务只允许 https')
  url.hash = ''
  return url.href.replace(/\/+$/, '')
}

export function parseGptVisBody(raw: unknown): QueryResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, source: 'http', code: 'chart_failed', detail: '图表服务返回空' }
  }
  const rec = raw as Record<string, unknown>
  if (rec.success === false) {
    return {
      ok: false,
      source: 'http',
      code: 'chart_failed',
      detail: String(rec.errorMessage || rec.message || '出图失败'),
    }
  }
  const href = sanitizeMdImageUrl(String(rec.resultObj || rec.url || rec.imageUrl || '').trim())
  if (!href) {
    return { ok: false, source: 'http', code: 'chart_failed', detail: '图表服务未返回合法 https 图片地址' }
  }
  try {
    const image = new URL(href)
    if (isPrivateHttpHost(image.hostname)) {
      return { ok: false, source: 'http', code: 'chart_failed', detail: '图表地址不能指向内网' }
    }
  } catch {
    return { ok: false, source: 'http', code: 'chart_failed', detail: '图表服务未返回合法 https 图片地址' }
  }
  return { ok: true, source: 'http', detail: '已生成图表', data: { imageUrl: href } }
}

export async function renderChart(
  cfg: ConnectorConfig | undefined,
  typeRaw: string,
  title: string,
  labels: string,
  values: string,
  values2 = '',
): Promise<QueryResult> {
  if (!cfg || !cfg.enabled) {
    return {
      ok: false,
      source: 'none',
      code: 'connector_disabled',
      detail: '图表 MCP 未启用。请到「专家·技能·连接器」打开 AntV 图表。',
    }
  }
  const type = normalizeChartType(typeRaw)
  if (!type) {
    return {
      ok: false,
      source: 'none',
      code: 'invalid_kind',
      detail: `chart_type 只允许 ${CHART_TYPES.join(' | ')}`,
    }
  }
  const series = parseChartSeries(labels, values)
  if ('error' in series) {
    return { ok: false, source: 'none', code: 'invalid_kind', detail: series.error }
  }
  if (type === 'radar' && series.length < 3) {
    return { ok: false, source: 'none', code: 'invalid_kind', detail: '雷达图至少 3 个维度' }
  }
  let series2: ChartPoint[] | undefined
  if (type === 'dual-axes') {
    const second = parseChartSeries(labels, values2)
    if ('error' in second) {
      return { ok: false, source: 'none', code: 'invalid_kind', detail: `第二轴：${second.error}` }
    }
    series2 = second
  }
  let endpoint = DEFAULT_VIS_URL
  try {
    endpoint = visEndpoint(cfg)
  } catch (e) {
    return {
      ok: false,
      source: 'none',
      code: 'connector_unconfigured',
      detail: e instanceof Error ? e.message : String(e),
    }
  }
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildGptVisPayload(type, title, series, series2)),
      signal: AbortSignal.timeout(20000),
    })
    const text = await res.text()
    if (!res.ok) {
      return {
        ok: false,
        source: 'http',
        code: 'chart_failed',
        detail: `图表服务 HTTP ${res.status}`,
      }
    }
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      return { ok: false, source: 'http', code: 'chart_failed', detail: '图表服务返回非 JSON' }
    }
    return parseGptVisBody(data)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, source: 'http', code: 'connect_failed', detail: msg }
  }
}

export async function probeChart(cfg: ConnectorConfig): Promise<QueryResult> {
  if (cfg.mode === 'mock') {
    return { ok: true, source: 'mock', detail: 'mock：不请求 AntV。启用 http 后按 ModelScope mcp-server-chart 出图' }
  }
  return renderChart({ ...cfg, enabled: true }, 'bar', '连通探测', 'A,B', '1,2')
}
