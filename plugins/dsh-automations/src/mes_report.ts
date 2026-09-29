/**
 * 每日生产运营日报：对照 WorkBuddy mes_analyzer / mes_client 只读接口，
 * 按 simplified production_report 早报骨架排版。无数据的段整段省略，禁止编造。
 */
import type { MesSettings } from './config.js'
import { AutomationError } from './types.js'
import {
  MesHttpError,
  listItems,
  mesGet,
  mesGetOptional,
  mesListAll,
  mesLogin,
} from './mes_client.js'

export const STATUS_LABEL: Record<string, string> = {
  pending: '待开工',
  in_progress: '进行中',
  completed: '已完成',
  closed: '已关闭',
  cancelled: '已取消',
  draft: '草稿',
}

const URGENT_PRI = new Set(['urgent', 'high'])

export type UtilizationPoint = { time: string; value: number }

export type MesDailyFacts = {
  yesterday: string
  statusCounts: Record<string, number>
  wip: number
  pending: number
  open: number
  urgentOpen: number
  completedYesterday: number
  utilization: UtilizationPoint[] | null
  oee: { oee: number; availability: number; performance: number; quality: number } | null
  outputTotal: number | null
  processYield: { process: string; yieldRate: number }[]
  anomalies: { line: string; process: string; defect: string; severity: string }[]
}

export function shanghaiYmd(at = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}

export function addYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
    dt.getUTCDate(),
  ).padStart(2, '0')}`
}

export function formatMdDate(ymd: string): string {
  const parts = ymd.split('-').map(Number)
  const m = parts[1]
  const d = parts[2]
  if (!m || !d) return ymd
  return `${m} 月 ${d} 日`
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function str(v: unknown): string {
  return v == null ? '' : String(v)
}

function rowDate(row: Record<string, unknown>): string {
  const end = str(row.actual_end_time)
  if (end.length >= 10) return end.slice(0, 10)
  const ed = str(row.end_date)
  return ed.length >= 10 ? ed.slice(0, 10) : ''
}

function parseUtilization(body: unknown): UtilizationPoint[] | null {
  if (!body || typeof body !== 'object') return null
  const rec = body as Record<string, unknown>
  const labels = rec.labels
  const values = rec.values
  if (!Array.isArray(labels) || !Array.isArray(values) || !labels.length || !values.length) return null
  if (labels[0] && typeof labels[0] === 'object') return null
  const n = Math.min(labels.length, values.length)
  const out: UtilizationPoint[] = []
  for (let i = 0; i < n; i++) {
    const v = num(values[i])
    out.push({ time: str(labels[i]), value: v })
  }
  return out.length ? out : null
}

function parseOee(body: unknown): MesDailyFacts['oee'] {
  if (!body || typeof body !== 'object') return null
  const rec = body as Record<string, unknown>
  const oee = num(rec.oee)
  if (!oee && !num(rec.availability) && !num(rec.performance) && !num(rec.quality)) return null
  return {
    oee,
    availability: num(rec.availability),
    performance: num(rec.performance),
    quality: num(rec.quality),
  }
}

export async function collectMesDailyFacts(cfg: MesSettings): Promise<MesDailyFacts> {
  const yesterday = addYmd(shanghaiYmd(), -1)
  let token: string
  try {
    token = await mesLogin(cfg)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new AutomationError('mes_query_failed', `MES 登录失败：${msg}`)
  }

  const statusCounts: Record<string, number> = {}
  for (const st of Object.keys(STATUS_LABEL)) {
    try {
      const body = (await mesGet(cfg, token, '/api/work-orders', {
        page: 1,
        page_size: 1,
        status: st,
      })) as Record<string, unknown>
      statusCounts[st] = num(body.total)
    } catch (e) {
      if (e instanceof MesHttpError && e.status === 404) break
      throw e
    }
  }

  const openRows = [
    ...(await mesListAll(cfg, token, '/api/work-orders', { status: 'pending' })).items,
    ...(await mesListAll(cfg, token, '/api/work-orders', { status: 'in_progress' })).items,
  ]
  const urgentOpen = openRows.filter((r) => URGENT_PRI.has(str(r.priority).toLowerCase())).length

  const completed = await mesListAll(cfg, token, '/api/work-orders', { status: 'completed' })
  const completedYesterday = completed.items.filter((r) => rowDate(r) === yesterday).length

  const utilBody = await mesGetOptional(cfg, token, '/api/device/utilization', { period: 'day' })
  const oeeBody = await mesGetOptional(cfg, token, '/api/device/oee')

  let outputTotal: number | null = null
  try {
    const outBody = (await mesGet(cfg, token, '/api/reports/daily-output', {
      page: 1,
      page_size: 100,
      date_from: yesterday,
      date_to: yesterday,
    })) as Record<string, unknown>
    const sum = num(outBody.actual_qty_sum)
    const rows = listItems(outBody)
    const fromRows = rows.reduce((acc, r) => acc + num(r.actual_qty), 0)
    const value = sum || fromRows
    outputTotal = value > 0 ? value : null
  } catch (e) {
    if (!(e instanceof MesHttpError && e.status === 404)) throw e
  }

  const processYield: MesDailyFacts['processYield'] = []
  const py = await mesGetOptional(cfg, token, '/api/quality/process-yield')
  if (py) {
    for (const row of listItems(py)) {
      const process = str(row.process)
      const yieldRate = num(row.yield_rate)
      if (process && yieldRate > 0) processYield.push({ process, yieldRate })
    }
  }

  const anomalies: MesDailyFacts['anomalies'] = []
  const an = await mesGetOptional(cfg, token, '/api/quality/anomalies', { limit: 5, page: 1, page_size: 5 })
  if (an) {
    for (const row of listItems(an)) {
      if (str(row.status) && str(row.status) !== 'open') continue
      anomalies.push({
        line: str(row.production_line),
        process: str(row.process),
        defect: str(row.defect_type),
        severity: str(row.severity),
      })
    }
  }

  const wip = statusCounts.in_progress || 0
  const pending = statusCounts.pending || 0
  return {
    yesterday,
    statusCounts,
    wip,
    pending,
    open: wip + pending,
    urgentOpen,
    completedYesterday,
    utilization: parseUtilization(utilBody),
    oee: parseOee(oeeBody),
    outputTotal,
    processYield,
    anomalies,
  }
}

function pct(v: number, digits = 1): string {
  return `${v.toFixed(digits)}%`
}

function int(v: number): string {
  return String(Math.round(v))
}

export function formatMesDailyReport(facts: MesDailyFacts): string {
  const day = formatMdDate(facts.yesterday)
  const blocks: [string, string, string][] = []

  const hasOrders = Object.values(facts.statusCounts).some((n) => n > 0) || facts.open > 0
  if (hasOrders) {
    let 要点 = `${day}在制 ${int(facts.wip)} 单、待开工 ${int(facts.pending)} 单，未完工合计 ${int(facts.open)} 单`
    if (facts.urgentOpen > 0) 要点 += `，其中紧急未完工 ${int(facts.urgentOpen)} 单`
    if (facts.completedYesterday > 0) 要点 += `；昨日完工 ${int(facts.completedYesterday)} 单`
    要点 += '。'
    const dist = Object.entries(facts.statusCounts)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${STATUS_LABEL[k] || k} ${int(n)}`)
    const 细分 = dist.length ? `状态分布：${dist.join('、')}。` : ''
    blocks.push(['工单概况', 要点, 细分])
  }

  if (facts.utilization && facts.utilization.length) {
    const vals = facts.utilization.map((p) => p.value)
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length
    const max = Math.max(...vals)
    const min = Math.min(...vals)
    const maxT = facts.utilization[vals.indexOf(max)]?.time || ''
    const minT = facts.utilization[vals.indexOf(min)]?.time || ''
    let 要点 = `${day}设备利用率平均 ${pct(avg)}，峰值 ${pct(max)}（${maxT}），低谷 ${pct(min)}（${minT}）。`
    let 细分 = ''
    if (facts.oee) {
      细分 = `综合 OEE ${pct(facts.oee.oee)}（可用率 ${pct(facts.oee.availability)} / 性能率 ${pct(facts.oee.performance)} / 质量率 ${pct(facts.oee.quality)}）。`
    }
    blocks.push(['设备稼动率', 要点, 细分])
  }

  if (facts.outputTotal && facts.outputTotal > 0) {
    blocks.push(['设备产出', `${day}日产出 ${int(facts.outputTotal)}。`, ''])
  }

  if (facts.processYield.length) {
    const rates = facts.processYield.map((p) => p.yieldRate)
    const min = Math.min(...rates)
    const max = Math.max(...rates)
    const top = [...facts.processYield].sort((a, b) => b.yieldRate - a.yieldRate)[0]
    const names = facts.processYield.map((p) => `${p.process} ${pct(p.yieldRate, 2)}`).join('、')
    let 要点 = `${day}主要工序良率 ${pct(min, 2)}～${pct(max, 2)}`
    if (top) 要点 += `，其中 ${top.process} ${pct(top.yieldRate, 2)}`
    要点 += `。`
    const 细分 = facts.processYield.length > 1 ? `${names}。` : ''
    blocks.push(['工序良率', 要点, 细分])
  }

  const notes: string[] = []
  if (facts.urgentOpen > 0) {
    notes.push(`紧急未完工 ${int(facts.urgentOpen)} 单，建议优先排产、盯紧交期`)
  }
  if (facts.anomalies.length) {
    const a = facts.anomalies[0]
    const bit = [a.line, a.process, a.defect].filter(Boolean).join(' ')
    if (bit) notes.push(`品质异常待处理：${bit}${a.severity ? `（${a.severity}）` : ''}`)
  }
  if (notes.length) {
    blocks.push(['需关注', notes.slice(0, 2).join('；') + '。', ''])
  }

  if (!blocks.length) {
    throw new AutomationError('mes_query_failed', 'MES 昨日无可用生产数据，拒绝编造日报')
  }

  return blocks
    .map((b, i) => {
      const [title, 要点, 细分] = b
      const head = `**${i + 1}. ${title}**\n要点：${要点}`
      return 细分 ? `${head}\n细分：${细分}` : head
    })
    .join('\n\n')
}

export async function runMesDailyBundle(
  cfg: MesSettings,
): Promise<{ summary: string; yesterday: string; facts: MesDailyFacts }> {
  if (!cfg.baseUrl) {
    throw new AutomationError(
      'mes_unconfigured',
      '未配置 MES 地址。请到 WorkBuddy「系统配置」填写 MES Base URL；P0 不会编造生产数字。',
    )
  }
  try {
    const facts = await collectMesDailyFacts(cfg)
    return { summary: formatMesDailyReport(facts), yesterday: facts.yesterday, facts }
  } catch (e) {
    if (e instanceof AutomationError) throw e
    const msg = e instanceof Error ? e.message : String(e)
    throw new AutomationError('mes_query_failed', `MES 查询失败：${msg}`)
  }
}

export async function runMesDailyReport(cfg: MesSettings): Promise<string> {
  return (await runMesDailyBundle(cfg)).summary
}
