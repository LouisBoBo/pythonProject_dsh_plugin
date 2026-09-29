/**
 * 本机读 Excel（.xlsx/.csv）抽出分类与数值，再复用 AntV GPT-Vis 出图。
 * 不另起 MCP 子进程；不传整本文件，但会把拆好的 labels/values（最多 12 点）发给图表服务。
 * 解析用 exceljs（避免 npm xlsx@0.18.x 原型污染）。
 */
import { existsSync, realpathSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { extname, isAbsolute, resolve, sep } from 'node:path'
import ExcelJS from 'exceljs'
import type { ConnectorConfig, QueryResult } from '../types.js'
import { renderChart } from './mcp_chart.js'

const MAX_BYTES = 8 * 1024 * 1024
const MAX_POINTS = 12
const ALLOWED_EXT = new Set(['.xlsx', '.csv'])

export type ExcelSeries = {
  sheet: string
  labelColumn: string
  valueColumn: string
  value2Column: string
  labels: string
  values: string
  values2: string
  pointCount: number
}

function cellText(raw: unknown): string {
  if (raw == null) return ''
  if (typeof raw === 'string') return raw.trim()
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
  if (typeof raw === 'boolean') return raw ? 'true' : 'false'
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw.toISOString().slice(0, 10)
  if (typeof raw === 'object' && raw !== null && 'text' in raw) {
    return cellText((raw as { text: unknown }).text)
  }
  if (typeof raw === 'object' && raw !== null && 'result' in raw) {
    return cellText((raw as { result: unknown }).result)
  }
  return String(raw).trim()
}

function cellNumber(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  const s = cellText(raw).replace(/,/g, '')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Desktop / Documents / Downloads / 系统临时目录；可用 ESC_EXCEL_ROOTS 追加（冒号分隔）。 */
export function excelAllowedRoots(): string[] {
  const home = homedir()
  const roots = [resolve(home, 'Desktop'), resolve(home, 'Documents'), resolve(home, 'Downloads'), tmpdir()]
  const extra = String(process.env.ESC_EXCEL_ROOTS || '')
  for (const part of extra.split(/[:;]/)) {
    const p = part.trim()
    if (p) roots.push(resolve(p))
  }
  return roots
}

function isUnderAllowedRoot(realPath: string): boolean {
  for (const root of excelAllowedRoots()) {
    let rootReal = root
    try {
      if (!existsSync(root)) continue
      rootReal = realpathSync(root)
    } catch {
      continue
    }
    if (realPath === rootReal || realPath.startsWith(rootReal + sep)) return true
  }
  return false
}

/** 展开 ~；要求绝对路径，且落在允许根目录下。 */
export function resolveExcelPath(raw: string): string | { error: string } {
  const text = String(raw || '').trim()
  if (!text) return { error: '文件路径不能为空' }
  if (text.includes('\0')) return { error: '非法路径' }
  let expanded = text
  if (text === '~') expanded = homedir()
  else if (text.startsWith('~/') || text.startsWith('~\\')) {
    expanded = resolve(homedir(), text.slice(2))
  }
  if (!isAbsolute(expanded)) {
    return { error: '请使用绝对路径或 ~/ 开头的本机路径' }
  }
  if (!existsSync(expanded)) return { error: '文件不存在' }
  let real = expanded
  try {
    real = realpathSync(expanded)
  } catch {
    return { error: '无法解析文件路径' }
  }
  if (!isUnderAllowedRoot(real)) {
    return {
      error:
        '路径不在允许目录（桌面 / 文档 / 下载 / 系统临时目录）。可用环境变量 ESC_EXCEL_ROOTS 追加根目录',
    }
  }
  let st
  try {
    st = statSync(real)
  } catch {
    return { error: '无法读取文件信息' }
  }
  if (!st.isFile()) return { error: '路径不是普通文件' }
  if (st.size <= 0) return { error: '文件为空' }
  if (st.size > MAX_BYTES) return { error: `文件过大，上限 ${MAX_BYTES / 1024 / 1024}MB` }
  const ext = extname(real).toLowerCase()
  if (ext === '.xls') return { error: '不支持旧版 .xls，请另存为 .xlsx 或导出 .csv' }
  if (!ALLOWED_EXT.has(ext)) return { error: '仅支持 .xlsx / .csv' }
  return real
}

function findColumnIndex(headers: string[], want: string, fallback: number): number | { error: string } {
  const name = String(want || '').trim()
  if (!name) {
    if (fallback < 0 || fallback >= headers.length) return { error: '表头列数不足' }
    return fallback
  }
  const hit = headers.findIndex((h) => h === name)
  if (hit >= 0) return hit
  const loose = headers.findIndex((h) => h.toLowerCase() === name.toLowerCase())
  if (loose >= 0) return loose
  return { error: `找不到列「${name}」。可用列：${headers.filter(Boolean).slice(0, 20).join('、') || '无'}` }
}

function worksheetToMatrix(ws: ExcelJS.Worksheet): unknown[][] {
  const rows: unknown[][] = []
  ws.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values
    if (!Array.isArray(values)) return
    // exceljs row.values 下标从 1 开始
    rows.push(values.slice(1).map((c) => (c == null ? '' : c)))
  })
  return rows
}

async function loadSheetMatrix(
  filePath: string,
  sheetRaw: string,
): Promise<{ sheet: string; rows: unknown[][] } | { error: string }> {
  const ext = extname(filePath).toLowerCase()
  try {
    if (ext === '.csv') {
      const wb = new ExcelJS.Workbook()
      await wb.csv.readFile(filePath)
      const ws = wb.worksheets[0]
      if (!ws) return { error: 'CSV 无数据' }
      return { sheet: ws.name || 'Sheet1', rows: worksheetToMatrix(ws) }
    }
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(filePath)
    if (!wb.worksheets.length) return { error: '工作簿没有工作表' }
    const names = wb.worksheets.map((s) => s.name)
    const wantSheet = String(sheetRaw || '').trim()
    const sheetName = wantSheet || (names[0] as string)
    const ws = wb.getWorksheet(sheetName)
    if (!ws) {
      return { error: `找不到工作表「${sheetName}」。可用：${names.slice(0, 12).join('、')}` }
    }
    return { sheet: sheetName, rows: worksheetToMatrix(ws) }
  } catch (e) {
    return { error: e instanceof Error ? `无法解析表格：${e.message}` : '无法解析表格' }
  }
}

/**
 * 首行表头；默认第 1 列分类、第 2 列数值。最多 12 个有效点（与 AntV 图表一致）。
 */
export async function readExcelSeries(
  filePathRaw: string,
  sheetRaw = '',
  labelColumnRaw = '',
  valueColumnRaw = '',
  value2ColumnRaw = '',
): Promise<ExcelSeries | { error: string }> {
  const pathOrErr = resolveExcelPath(filePathRaw)
  if (typeof pathOrErr !== 'string') return pathOrErr
  const loaded = await loadSheetMatrix(pathOrErr, sheetRaw)
  if ('error' in loaded) return loaded
  const { sheet: sheetName, rows } = loaded
  if (!rows.length) return { error: '工作表无数据' }
  const headerRow = Array.isArray(rows[0]) ? rows[0] : []
  const headers = headerRow.map((c) => cellText(c))
  if (headers.every((h) => !h)) return { error: '首行表头为空' }

  const labelIdx = findColumnIndex(headers, labelColumnRaw, 0)
  if (typeof labelIdx !== 'number') return labelIdx
  const valueIdx = findColumnIndex(headers, valueColumnRaw, 1)
  if (typeof valueIdx !== 'number') return valueIdx
  const wantValue2 = String(value2ColumnRaw || '').trim()
  let value2Idx: number | null = null
  if (wantValue2) {
    const idx = findColumnIndex(headers, wantValue2, -1)
    if (typeof idx !== 'number') return idx
    value2Idx = idx
  }

  const labels: string[] = []
  const values: number[] = []
  const values2: number[] = []
  for (let r = 1; r < rows.length && labels.length < MAX_POINTS; r++) {
    const row = rows[r]
    if (!Array.isArray(row)) continue
    const label = cellText(row[labelIdx])
    if (!label) continue
    const v = cellNumber(row[valueIdx])
    if (v == null) continue
    if (value2Idx != null) {
      const v2 = cellNumber(row[value2Idx])
      if (v2 == null) continue
      values2.push(v2)
    }
    labels.push(label.slice(0, 40))
    values.push(v)
  }
  if (labels.length < 2) {
    return { error: '有效数据不足 2 行（需非空分类 + 数字）。请检查列名与工作表' }
  }
  return {
    sheet: sheetName,
    labelColumn: headers[labelIdx] || `列${labelIdx + 1}`,
    valueColumn: headers[valueIdx] || `列${valueIdx + 1}`,
    value2Column: value2Idx == null ? '' : headers[value2Idx] || `列${value2Idx + 1}`,
    labels: labels.join(','),
    values: values.join(','),
    values2: values2.join(','),
    pointCount: labels.length,
  }
}

export async function excelToChart(
  excelCfg: ConnectorConfig | undefined,
  chartCfg: ConnectorConfig | undefined,
  filePath: string,
  chartType: string,
  title: string,
  sheet = '',
  labelColumn = '',
  valueColumn = '',
  value2Column = '',
): Promise<QueryResult> {
  if (!excelCfg?.enabled) {
    return {
      ok: false,
      source: 'none',
      code: 'connector_disabled',
      detail: 'Excel 出图连接器未启用。请到「专家·技能·连接器」打开「Excel 表格出图」。',
    }
  }
  if (excelCfg.mode === 'mock') {
    const series = await readExcelSeries(filePath, sheet, labelColumn, valueColumn, value2Column)
    if ('error' in series) {
      return { ok: false, source: 'mock', code: 'invalid_kind', detail: series.error }
    }
    return {
      ok: true,
      source: 'mock',
      detail: 'mock：已读表，未请求图表服务',
      data: {
        imageUrl: 'https://example.com/esc-excel-mock.png',
        sheet: series.sheet,
        labels: series.labels,
        values: series.values,
        pointCount: series.pointCount,
      },
    }
  }
  if (!excelCfg.outboundArmed) {
    return {
      ok: false,
      source: 'none',
      code: 'connector_disabled',
      detail: 'Excel 出图未解除外传锁定。请在面板重新打开「Excel 表格出图」。',
    }
  }
  if (!chartCfg?.enabled) {
    return {
      ok: false,
      source: 'none',
      code: 'connector_disabled',
      detail: 'Excel 出图依赖 AntV 图表。请同时启用「AntV 图表」连接器。',
    }
  }
  const series = await readExcelSeries(filePath, sheet, labelColumn, valueColumn, value2Column)
  if ('error' in series) {
    return { ok: false, source: 'none', code: 'invalid_kind', detail: series.error }
  }
  const type = String(chartType || '').trim() || 'bar'
  if (type === 'dual-axes' && !series.values2) {
    return {
      ok: false,
      source: 'none',
      code: 'invalid_kind',
      detail: 'dual-axes 必须指定 value2_column（第二轴数值列）',
    }
  }
  const result = await renderChart(
    chartCfg,
    type,
    title,
    series.labels,
    series.values,
    type === 'dual-axes' ? series.values2 : '',
  )
  if (!result.ok) return result
  const prev = result.data && typeof result.data === 'object' ? (result.data as Record<string, unknown>) : {}
  return {
    ...result,
    detail: `已从 ${series.sheet} 读取 ${series.pointCount} 点并生成图表（分类/数值已发往图表服务）`,
    data: {
      ...prev,
      sheet: series.sheet,
      labelColumn: series.labelColumn,
      valueColumn: series.valueColumn,
      pointCount: series.pointCount,
    },
  }
}

export async function probeExcel(cfg: ConnectorConfig): Promise<QueryResult> {
  if (cfg.mode === 'mock') {
    return { ok: true, source: 'mock', detail: 'mock：不读盘、不出图。启用 http 后可读本机 Excel 并出图' }
  }
  return {
    ok: true,
    source: 'http',
    detail:
      'Excel 出图：仅桌面/文档/下载等目录；http 模式需同时启用 AntV，且会把最多 12 点分类/数值发往 GPT-Vis。测通不读用户文件。',
  }
}
