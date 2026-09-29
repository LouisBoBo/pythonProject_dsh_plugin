/**
 * 生产日报图示：只根据已查出的 MES 数字绘图，禁止编造序列。
 * 企微正文保持纯文字；飞书文档与运行详情可附图表。
 */
import type { ReportChart, ReportChartItem } from './types.js'
import type { MesDailyFacts } from './mes_report.js'
import { STATUS_LABEL } from './mes_report.js'

const STATUS_VALUE: Record<string, string> = Object.fromEntries(
  Object.entries(STATUS_LABEL).map(([k, v]) => [v, k]),
)

function looksLikeMesDaily(text: string, automationName = ''): boolean {
  if (/生产运营日报|生产日报|昨日生产/.test(String(automationName || ''))) return true
  const raw = String(text || '')
  return /\*\*\d+\.\s*工单概况\*\*/.test(raw) || /^1\.\s*工单概况/m.test(raw)
}

function finiteItems(items: ReportChartItem[]): ReportChartItem[] {
  return items.filter((x) => x.label && Number.isFinite(x.value) && x.value > 0)
}

export function chartsFromMesFacts(facts: MesDailyFacts): ReportChart[] {
  const charts: ReportChart[] = []
  const statusItems = finiteItems(
    Object.entries(facts.statusCounts || {}).map(([k, n]) => ({
      label: STATUS_LABEL[k] || k,
      value: Number(n) || 0,
    })),
  )
  if (statusItems.length) {
    charts.push({ id: 'wo-status', title: '工单状态', type: 'bar', unit: '单', items: statusItems })
  }
  const openItems = finiteItems([
    { label: '待开工', value: Number(facts.pending) || 0 },
    { label: '进行中', value: Number(facts.wip) || 0 },
  ])
  if (openItems.length >= 2) {
    charts.push({ id: 'wo-open', title: '未完工构成', type: 'pie', unit: '单', items: openItems })
  }
  const yieldItems = finiteItems(
    (facts.processYield || []).map((p) => ({ label: p.process, value: Number(p.yieldRate) || 0 })),
  )
  if (yieldItems.length) {
    charts.push({ id: 'yield', title: '工序良率', type: 'bar', unit: '%', items: yieldItems })
  }
  if (facts.oee) {
    const oeeItems = finiteItems([
      { label: '综合 OEE', value: facts.oee.oee },
      { label: '可用率', value: facts.oee.availability },
      { label: '性能率', value: facts.oee.performance },
      { label: '质量率', value: facts.oee.quality },
    ])
    if (oeeItems.length) {
      charts.push({ id: 'oee', title: '设备 OEE', type: 'bar', unit: '%', items: oeeItems })
    }
  }
  const utilItems = (facts.utilization || [])
    .map((p) => ({ label: p.time, value: Number(p.value) || 0 }))
    .filter((x) => x.label && Number.isFinite(x.value))
  if (utilItems.length >= 2) {
    charts.push({ id: 'util', title: '设备利用率', type: 'line', unit: '%', items: utilItems })
  }
  return charts
}

function parseLabeledCounts(blob: string, unit: '单' | '%'): ReportChartItem[] {
  const items: ReportChartItem[] = []
  const re =
    unit === '%'
      ? /([^、，,\n：:]+?)\s+(\d+(?:\.\d+)?)\s*%/g
      : /([^、，,\n：:]+?)\s+(\d+(?:\.\d+)?)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(blob))) {
    const label = String(m[1] || '').replace(/^细分：/, '').trim()
    const value = Number(m[2])
    if (!label || !Number.isFinite(value) || value < 0) continue
    if (unit === '单' && !STATUS_VALUE[label] && !/待开工|进行中|已完成|已关闭|已取消|草稿/.test(label)) continue
    items.push({ label, value })
  }
  return finiteItems(items)
}

export function chartsFromMesSummary(summary: string, automationName = ''): ReportChart[] {
  const raw = String(summary || '').trim()
  if (!raw || !looksLikeMesDaily(raw, automationName)) return []
  const charts: ReportChart[] = []
  const dist = raw.match(/状态分布：([^\n。]+)/)
  if (dist && dist[1]) {
    const statusItems = parseLabeledCounts(dist[1], '单')
    if (statusItems.length) {
      charts.push({ id: 'wo-status', title: '工单状态', type: 'bar', unit: '单', items: statusItems })
      const pending = statusItems.find((x) => x.label === '待开工')
      const wip = statusItems.find((x) => x.label === '进行中')
      const openItems = finiteItems([
        { label: '待开工', value: pending ? pending.value : 0 },
        { label: '进行中', value: wip ? wip.value : 0 },
      ])
      if (openItems.length >= 2) {
        charts.push({ id: 'wo-open', title: '未完工构成', type: 'pie', unit: '单', items: openItems })
      }
    }
  }
  const yieldLine = raw.match(/\*\*\d+\.\s*工序良率\*\*[\s\S]*?细分：([^\n。]+)/)
  if (yieldLine && yieldLine[1]) {
    const yieldItems = parseLabeledCounts(yieldLine[1], '%')
    if (yieldItems.length) {
      charts.push({ id: 'yield', title: '工序良率', type: 'bar', unit: '%', items: yieldItems })
    }
  }
  return charts
}

export function sanitizeCharts(input: unknown): ReportChart[] {
  if (!Array.isArray(input)) return []
  const out: ReportChart[] = []
  for (const row of input) {
    if (!row || typeof row !== 'object') continue
    const rec = row as Record<string, unknown>
    const type = rec.type === 'pie' || rec.type === 'line' || rec.type === 'bar' ? rec.type : ''
    const unit = rec.unit === '单' || rec.unit === '%' || rec.unit === '' ? rec.unit : ''
    const items = Array.isArray(rec.items)
      ? finiteItems(
          rec.items.map((it) => {
            const x = it && typeof it === 'object' ? (it as Record<string, unknown>) : {}
            return { label: String(x.label || '').trim(), value: Number(x.value) }
          }),
        )
      : []
    if (!type || !items.length) continue
    out.push({
      id: String(rec.id || `chart-${out.length + 1}`)
        .replace(/\.\./g, '')
        .replace(/[^A-Za-z0-9._-]/g, '')
        .slice(0, 64) || `chart-${out.length + 1}`,
      title: String(rec.title || '图示'),
      type,
      unit,
      items,
    })
  }
  return out
}

export function attachRunCharts(row: {
  charts?: unknown
  summary?: string
  automation_name?: string
}): ReportChart[] {
  const stored = sanitizeCharts(row.charts)
  if (stored.length) return stored
  return chartsFromMesSummary(row.summary || '', row.automation_name || '')
}

function glyphBar(value: number, max: number, width = 12): string {
  if (max <= 0 || value <= 0) return ''
  const n = Math.max(1, Math.round((value / max) * width))
  return '█'.repeat(Math.min(width, n))
}

function mdTable(chart: ReportChart): string {
  const max = Math.max(...chart.items.map((x) => x.value), 0)
  const head = `| ${chart.type === 'pie' ? '构成' : chart.unit === '%' ? '工序' : '状态'} | ${
    chart.unit === '%' ? '良率' : '单数'
  } | 示意 |`
  const sep = '| :--- | ---: | :--- |'
  const rows = chart.items.map((it) => {
    const shown = chart.unit === '%' ? `${it.value.toFixed(2)}%` : String(Math.round(it.value))
    return `| ${it.label} | ${shown} | ${glyphBar(it.value, max)} |`
  })
  return `### ${chart.title}\n\n${head}\n${sep}\n${rows.join('\n')}`
}

export function formatChartsMarkdown(charts: ReportChart[]): string {
  const list = sanitizeCharts(charts).filter((c) => c.type !== 'line')
  if (!list.length) return ''
  return `## 数据图示\n\n${list.map(mdTable).join('\n\n')}`
}
