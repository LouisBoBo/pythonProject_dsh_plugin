/**
 * 这一轮到底做完没有：只认读盘、端口响应、运行中的接口文档、实际跑过的测试。
 * 模型结论文案不算完成。对不上的项记未过，完成度 = 通过数 / 检查数。
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readBackendPortFromViteProxy, resolveBackendRoot } from './backendRestart.js'
import {
  assessBackend,
  collectRoutePaths,
  readFrontendDevPort,
} from './serviceEnsure.js'
import { isDeleteIntent } from './deleteIntent.js'
import { normalizeRel } from './pathScope.js'

export type AuditCheck = { name: string; ok: boolean; detail: string }

export type CompletionScore = { passed: number; total: number; percent: number }

export function scoreChecks(checks: AuditCheck[]): CompletionScore {
  const total = checks.length
  const passed = checks.filter((c) => c.ok).length
  const percent = total ? Math.round((passed / total) * 100) : 0
  return { passed, total, percent }
}

export function finishAudit(
  checks: AuditCheck[],
  emptyDetail = '',
): { ok: boolean; checks: AuditCheck[]; detail: string; completion?: CompletionScore } {
  const completion = checks.length ? scoreChecks(checks) : undefined
  const failed = checks.filter((c) => !c.ok)
  if (!checks.length) return { ok: true, checks, detail: emptyDetail }
  if (!failed.length) {
    return {
      ok: true,
      checks,
      completion,
      detail: `交付审计通过，完成度 ${completion!.percent}%（${completion!.passed}/${completion!.total}）`,
    }
  }
  const detail =
    `交付审计未通过（禁止假完成），完成度 ${completion!.percent}%（${completion!.passed}/${completion!.total}）：` +
    failed
      .map((c) => c.detail || c.name)
      .filter(Boolean)
      .slice(0, 4)
      .join('；')
  return { ok: false, checks, completion, detail }
}

function normRel(raw: string): string {
  return String(raw || '').replace(/\\/g, '/').replace(/^\.?\//, '').trim()
}

function isPageWanted(requirement: string): boolean {
  // 只认明确要页面/界面。单说「列表」「筛选」会把增列、改筛选项误判成缺页面。
  return /页面|界面/.test(String(requirement || ''))
}

function isTestFile(rel: string): boolean {
  return /(?:^|\/)test_[^/]+\.py$/.test(rel) || /(?:^|\/)tests\/[^/]+\.py$/.test(rel)
}

function isViewFile(rel: string): boolean {
  const r = normRel(rel)
  return /\.(vue|tsx|jsx)$/.test(r) && r.includes('/views/')
}

/**
 * 需求里写了页面或界面时，按这一轮的实际落盘判断。
 * 新增/修改要有页面文件同步上来；删除则认被删掉的页面文件，不再要求再交一个新页面。
 */
export function requirementEvidenceChecks(
  requirement: string,
  synced: string[],
  deleted: string[] = [],
): AuditCheck[] {
  if (!isPageWanted(requirement)) return []
  const views = synced.filter(isViewFile)
  const removed = deleted.filter(isViewFile)
  if (isDeleteIntent(requirement)) {
    if (removed.length || views.length) {
      return [{
        name: 'requirement_page',
        ok: true,
        detail: removed.length
          ? '需求里的页面文件已删除'
          : '需求里的页面已有前端页面文件落盘',
      }]
    }
    return []
  }
  return [
    {
      name: 'requirement_page',
      ok: views.length > 0,
      detail: views.length
        ? '需求里的页面已有前端页面文件落盘'
        : '需求里要页面或界面，但没有同步前端页面文件',
    },
  ]
}

const GENERIC_NAME = new Set([
  'report', 'reports', 'index', 'view', 'test', 'tests', 'api', 'app', 'main',
  'router', 'routers', 'schema', 'schemas', 'src', 'frontend', 'backend', 'config',
])

/** 从本轮文件名抽出能对上接口路径的词。reports.py 这类泛名不拿来匹配，避免把同文件里的旧接口算成本轮。 */
export function pathsForThisRound(rels: string[], paths: string[]): string[] {
  const tokens = new Set<string>()
  for (const rel of rels) {
    const base = normRel(rel).split('/').pop() || ''
    const stem = base.replace(/\.[^.]+$/, '')
    const parts = stem
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .split(/[^A-Za-z0-9]+/)
      .map((s) => s.toLowerCase())
      .filter((s) => s.length >= 5 && !GENERIC_NAME.has(s))
    for (const part of parts) tokens.add(part)
  }
  if (!tokens.size) return []
  return paths.filter((p) => {
    const norm = p.toLowerCase().replace(/[_-]/g, '')
    for (const token of tokens) {
      if (norm.includes(token.replace(/[_-]/g, ''))) return true
    }
    return false
  })
}

/** 探测已经确认前端在听时，丢掉同步阶段「端口未监听」的过时说明。 */
export function dropStaleFrontendDownNote(detail: string, frontendUp: boolean): string {
  if (!frontendUp) return detail
  return String(detail || '')
    .replace(/已触碰前端文件；:\d+\s*未在监听（请本机自行开 Vite，插件不再自动 npm run dev）/g, '')
    .replace(/；\s*；/g, '；')
    .replace(/；\s*。/g, '。')
    .trim()
}

function quotedApiPaths(workspace: string, rels: string[]): string[] {
  const found: string[] = []
  const re = /['"`](\/api\/[A-Za-z0-9_\-./{}]+)['"`]/g
  for (const raw of rels) {
    const rel = normalizeRel(raw)
    if (!rel || !/\.(vue|js|ts|jsx|tsx|py)$/.test(rel)) continue
    const full = join(workspace, rel)
    if (!existsSync(full)) continue
    let text = ''
    try {
      text = readFileSync(full, 'utf8').slice(0, 80_000)
    } catch {
      continue
    }
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      const path = m[1] || ''
      if (path && !found.includes(path)) found.push(path)
    }
  }
  return found
}

async function fetchStatus(url: string): Promise<number> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
    return res.status
  } catch {
    return 0
  }
}

function venvPython(backendRoot: string | null): string {
  if (!backendRoot) return ''
  for (const rel of [
    join(backendRoot, '.venv', 'Scripts', 'python.exe'),
    join(backendRoot, 'venv', 'Scripts', 'python.exe'),
    join(backendRoot, '.venv', 'bin', 'python'),
    join(backendRoot, 'venv', 'bin', 'python'),
  ]) {
    if (existsSync(rel)) return rel
  }
  return ''
}

function runProcess(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<{ code: number | null; output: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, { cwd, windowsHide: true })
    let output = ''
    const take = (buf: Buffer) => {
      output = (output + buf.toString('utf8')).slice(-800)
    }
    child.stdout?.on('data', take)
    child.stderr?.on('data', take)
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
    }, timeoutMs)
    child.once('error', (err) => {
      clearTimeout(timer)
      resolvePromise({ code: null, output: String(err).slice(0, 300) })
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolvePromise({ code, output })
    })
  })
}

/** 运行中探测只覆盖本轮改过的前后端文件，不因为工程里还有别的目录就去探。 */
export function liveAuditScope(rels: string[]): { frontend: boolean; backend: boolean } {
  const files = rels.map(normRel).filter(Boolean)
  return {
    frontend: files.some((r) => r.startsWith('frontend/')),
    backend: files.some((r) => r.startsWith('backend/') && r.endsWith('.py') && !isTestFile(r)),
  }
}

/**
 * 同步之后对真实项目做探测。自检模式不探端口、不跑测试，避免把假通过写进账本。
 * 只探本轮改过的前端或后端；接口只核对本轮文件里出现的路径。
 */
export async function probeLiveAudit(opts: {
  workspace: string
  requirement: string
  synced: string[]
  prior?: AuditCheck[]
}): Promise<AuditCheck[]> {
  if (process.env.CURSOR_CHAT_MOCK === '1') return []
  const workspace = resolve(String(opts.workspace || ''))
  const rels = (opts.synced || []).map(normRel).filter(Boolean)
  const checks: AuditCheck[] = []

  const scope = liveAuditScope(rels)
  const frontPort = scope.frontend ? readFrontendDevPort(workspace) : null
  if (scope.frontend) {
    if (!frontPort) {
      checks.push({
        name: 'frontend_service',
        ok: false,
        detail: '本轮改了前端，但没有从 Vite 配置识别到端口，不能确认前端服务',
      })
    } else {
      const status = await fetchStatus(`http://127.0.0.1:${frontPort}/`)
      const up = status >= 200 && status < 400
      checks.push({
        name: 'frontend_service',
        ok: up,
        detail: up ? `端口 ${frontPort} 已响应（HTTP ${status}）` : `端口 ${frontPort} 没有可用响应`,
      })
    }
  }

  const routePaths = pathsForThisRound(rels, [
    ...collectRoutePaths(workspace, rels),
    ...quotedApiPaths(workspace, rels),
  ].filter((p, i, arr) => arr.indexOf(p) === i))
  const needBackend = scope.backend || routePaths.length > 0
  const backPort = needBackend ? readBackendPortFromViteProxy(workspace) : null
  let backendUp = false
  if (needBackend) {
    if (!backPort) {
      if (scope.backend) {
        checks.push({
          name: 'backend_service',
          ok: false,
          detail: '本轮改了后端，但 Vite 代理里没有本机后台端口，不能确认后端服务',
        })
      }
    } else {
      const assessed = await assessBackend(backPort, [])
      backendUp = assessed.ok
      if (scope.backend) {
        checks.push({
          name: 'backend_service',
          ok: assessed.ok,
          detail: assessed.backend,
        })
      }
    }
  }

  if (routePaths.length) {
    if (!backPort || !backendUp) {
        checks.push({
          name: 'requirement_api',
          ok: false,
          detail: '同步文件里有接口路径，但后端文档没打开，不能确认接口已加载',
        })
      } else {
        let body = ''
        try {
          const res = await fetch(`http://127.0.0.1:${backPort}/openapi.json`, {
            signal: AbortSignal.timeout(4000),
          })
          body = res.status === 200 ? (await res.text()).slice(0, 200_000) : ''
        } catch {
          body = ''
        }
        const missing = routePaths.filter((p) => !body.includes(p))
        checks.push({
          name: 'requirement_api',
          ok: Boolean(body) && missing.length === 0,
          detail: !body
            ? '后端文档开了，但没有拿到 openapi，不能确认接口已加载'
            : missing.length
              ? `正在跑的文档里还没有本轮接口：${missing.slice(0, 4).join('、')}`
              : `运行中的接口文档含本轮接口 ${routePaths.slice(0, 4).join('、')}`,
        })
    }
  }

  const tests = rels
    .map((rel) => normalizeRel(rel))
    .filter((rel) => rel && isTestFile(rel) && !rel.split('/').some((part) => part.startsWith('-')))
  if (tests.length) {
    const backendRoot = resolveBackendRoot(workspace)
    const py = venvPython(backendRoot) || 'python'
    const cwd = backendRoot || workspace
    const args = tests.map((rel) =>
      backendRoot && rel.startsWith('backend/') ? rel.slice('backend/'.length) : rel,
    )
    if (args.some((arg) => !arg || arg.startsWith('-') || arg.includes('..'))) {
      checks.push({
        name: 'pytest',
        ok: false,
        detail: '本轮测试路径越出工程，没有执行',
      })
      return checks
    }
    const run = await runProcess(py, ['-m', 'pytest', ...args, '-q', '--tb=line'], cwd, 45_000)
    const sample = tests.slice(0, 2).join('、')
    checks.push({
      name: 'pytest',
      ok: run.code === 0,
      detail:
        run.code === 0
          ? `已运行并通过 ${sample}`
          : `未通过 ${sample}${run.output ? `：${run.output.replace(/\s+/g, ' ').trim().slice(0, 180)}` : ''}`,
    })
  }

  return checks
}
