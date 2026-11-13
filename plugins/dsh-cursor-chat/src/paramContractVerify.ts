/**
 * 前后端分页契约验尸：前端 page_size 不得超过后端 Query(..., le=N)。
 *
 * 现场：MaterialInbound 调 getSuppliers({ page_size: 200 })，后端 le=100 → 422，
 * 页面红条报错，而旧审计只看挂载/OpenAPI 路径，假通过。
 *
 * 只认本轮同步的前端源码 + 工作区后端 Query 上限；不扫用户结论文案。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { detectProjectLayout } from './projectLayout.js'
import { normalizeRel } from './pathScope.js'

export type ParamContractResult = { ok: boolean; detail: string }

const SKIP_DIR = new Set([
  'node_modules',
  '.git',
  '.venv',
  'venv',
  '__pycache__',
  'dist',
  'build',
  '.tox',
  '.mypy_cache',
  '.pytest_cache',
])

function readText(path: string, limit = 120_000): string {
  try {
    if (!existsSync(path)) return ''
    return readFileSync(path, 'utf8').slice(0, limit)
  } catch {
    return ''
  }
}

/** 从 FastAPI Query 声明收集 page_size 的 le 上限。 */
export function collectBackendPageSizeCaps(backendRoots: string[]): number[] {
  const caps = new Set<number>()
  const fileRe = /\.py$/i
  const leRe = /page_size\s*:\s*int\s*=\s*Query\s*\([^)]*\ble\s*=\s*(\d+)/g

  const walk = (dir: string, depth: number) => {
    if (depth > 6 || !existsSync(dir)) return
    let entries: string[] = []
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      if (SKIP_DIR.has(name) || name.startsWith('.')) continue
      const full = join(dir, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        walk(full, depth + 1)
        continue
      }
      if (!fileRe.test(name)) continue
      const text = readText(full)
      if (!text.includes('page_size')) continue
      leRe.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = leRe.exec(text))) {
        const n = Number(m[1])
        if (Number.isFinite(n) && n > 0) caps.add(n)
      }
    }
  }

  for (const root of backendRoots) {
    const abs = resolve(root)
    if (existsSync(abs)) walk(abs, 0)
  }
  return [...caps].sort((a, b) => a - b)
}

export type FePageSizeHit = { rel: string; value: number; line: number }

/** 本轮同步的前端文件里显式写出的 page_size / pageSize 字面量。 */
export function collectFrontendPageSizeHits(workspace: string, synced: string[]): FePageSizeHit[] {
  const hits: FePageSizeHit[] = []
  const re = /\bpage[_-]?size\s*[:=]\s*(\d+)\b/gi
  for (const raw of synced || []) {
    const rel = normalizeRel(raw)
    if (!rel || !/\.(vue|js|jsx|ts|tsx|mjs|cjs)$/i.test(rel)) continue
    // 后端/脚本里的 page_size 默认值不属前端请求契约
    if (/(?:^|\/)(?:backend|server)\//i.test(rel) || rel.endsWith('.py')) continue
    const full = join(workspace, rel)
    const text = readText(full)
    if (!text) continue
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || ''
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(line))) {
        const value = Number(m[1])
        if (!Number.isFinite(value) || value <= 0) continue
        hits.push({ rel, value, line: i + 1 })
      }
    }
  }
  return hits
}

/**
 * 前端字面 page_size 不得超过后端 Query le 上限。
 * feRoot：读前端字面量（同步后真工程，或同步前沙箱）。
 * backendRoot：可选，稀疏沙箱缺后端时用真工程扫 le。
 * 无前端分页字面量、或后端未声明 le 时跳过（不编造失败）。
 */
export function verifyPageSizeContractOnTarget(
  feRoot: string,
  opts?: { synced_files?: string[]; backendRoot?: string },
): ParamContractResult {
  const workspace = resolve(feRoot)
  const synced = (opts?.synced_files || []).map((s) => normalizeRel(s)).filter(Boolean)
  if (!synced.length) return { ok: true, detail: '' }

  const hits = collectFrontendPageSizeHits(workspace, synced)
  if (!hits.length) return { ok: true, detail: '' }

  const backendScan = resolve(opts?.backendRoot || feRoot)
  const layout = detectProjectLayout(backendScan, synced)
  const caps = collectBackendPageSizeCaps(layout.backendRoots)
  if (!caps.length) return { ok: true, detail: '' }

  // 取最严 le：多路由并存时用 max 会放过「打到 le=100 却写了 200」的 422
  const strictCap = Math.min(...caps)
  const offenders = hits.filter((h) => h.value > strictCap)
  if (!offenders.length) return { ok: true, detail: '分页参数未超过后端 le 上限' }

  const sample = offenders
    .slice(0, 4)
    .map((h) => `${h.rel}:${h.line} page_size=${h.value}`)
    .join('；')
  return {
    ok: false,
    detail:
      `前端 page_size 超过后端最严上限 le=${strictCap}（${sample}）。` +
      '页面会弹出 422 校验错误。请把下拉/列表请求的 page_size 调到 ≤ 后端 le。',
  }
}
