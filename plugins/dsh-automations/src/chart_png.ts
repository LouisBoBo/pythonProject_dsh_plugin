/**
 * 生产日报图表 → PNG。用本机 python3 + matplotlib（与 WorkBuddy 离线图同一路），
 * 无额外 npm 依赖；渲染失败时返回空数组，飞书回退为表格。
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ReportChart } from './types.js'
import { sanitizeCharts } from './mes_charts.js'

export type ChartPng = {
  id: string
  title: string
  buffer: Buffer
  width: number
  height: number
}

function scriptPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'chart_render.py')
}

function pythonBin(): string {
  return (process.env.PYTHON || process.env.PYTHON3 || 'python3').trim() || 'python3'
}

export function renderChartPngs(charts: ReportChart[]): ChartPng[] {
  const list = sanitizeCharts(charts)
  if (!list.length) return []
  const dir = mkdtempSync(join(tmpdir(), 'dsh-auto-chart-'))
  try {
    const payload = JSON.stringify({ outdir: dir, charts: list })
    const ran = spawnSync(pythonBin(), [scriptPath()], {
      input: payload,
      encoding: 'utf8',
      timeout: 90_000,
      maxBuffer: 4 * 1024 * 1024,
    })
    if (ran.error || ran.status !== 0) return []
    const raw = String(ran.stdout || '').trim()
    if (!raw) return []
    const parsed = JSON.parse(raw) as {
      ok?: boolean
      files?: { id?: string; path?: string; width?: number; height?: number; title?: string }[]
    }
    if (!parsed.ok || !Array.isArray(parsed.files)) return []
    const out: ChartPng[] = []
    const root = resolve(dir)
    for (const f of parsed.files) {
      if (!f?.path) continue
      const abs = resolve(String(f.path))
      if (abs !== root && !abs.startsWith(`${root}/`)) continue
      const buffer = readFileSync(abs)
      if (buffer.length < 32 || buffer[0] !== 0x89) continue
      out.push({
        id: String(f.id || `chart-${out.length + 1}`),
        title: String(f.title || ''),
        buffer,
        width: Math.max(320, Number(f.width) || 860),
        height: Math.max(160, Number(f.height) || 280),
      })
    }
    return out
  } catch {
    return []
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
