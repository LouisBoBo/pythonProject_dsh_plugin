/**
 * 项目画像（布局）——写码插件里**唯一**的工程布局解析入口。
 *
 * 端口 / 前后端根 / 菜单路由探针 / 约定路径映射，一律走这里。
 * 禁止在 menuVerify / deleteVerify / apiVerify / serviceEnsure 再写死
 * `frontend/src/...` 顶层路径或仓名（pythonProject_*）。
 *
 * 证据：vite.config / package.json+vite、FastAPI main.py、代理 target 端口、
 * layouts/*Layout*.vue、router/index.*。hintRels 只打分，不替代证据。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'

export type ProjectLayout = {
  workspace: string
  /** 含 Vite 的前端根（绝对路径） */
  frontendRoots: string[]
  /** 含 FastAPI 入口的后端根（绝对路径） */
  backendRoots: string[]
  viteConfigs: string[]
  frontendDevPort: number | null
  backendProxyPort: number | null
  signals: string[]
}

const SKIP_DIR = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.output',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.tox',
  '.idea',
  '.vscode',
  'target',
  'vendor',
  'Pods',
  'DerivedData',
])

const VITE_NAMES = [
  'vite.config.ts',
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.cjs',
  'vite.config.mts',
  'vite.config.cts',
] as const

const MAX_DEPTH = 5
const MAX_DIRS = 240

function normRel(raw: string): string {
  // 与 pathScope 一致：拒绝 ..，避免 hint 路径逃出 workspace
  let text = String(raw || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^删除\s*/, '')
    .trim()
  if (!text || text.includes('\x00') || text.includes('~') || text.includes(':')) return ''
  while (text.startsWith('./')) text = text.slice(2)
  text = text.replace(/^\/+/, '')
  const parts = text.split('/').filter((p) => p && p !== '.')
  if (!parts.length || parts.includes('..')) return ''
  return parts.join('/')
}

function readText(path: string, limit = 120_000): string {
  try {
    if (!existsSync(path)) return ''
    return readFileSync(path, 'utf8').slice(0, limit)
  } catch {
    return ''
  }
}

function isDir(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory()
  } catch {
    return false
  }
}

function toPosixRel(from: string, abs: string): string {
  return relative(from, abs).split(sep).join('/')
}

function underRoot(absFile: string, root: string): boolean {
  const a = resolve(absFile)
  const r = resolve(root)
  return a === r || a.startsWith(r + sep)
}

function scoreByHints(absRoot: string, workspace: string, hints: string[]): number {
  if (!hints.length) return 0
  const relRoot = toPosixRel(workspace, absRoot)
  let best = 0
  for (const h of hints) {
    if (!h) continue
    if (h === relRoot || h.startsWith(relRoot + '/')) {
      best = Math.max(best, relRoot.length + 1)
    } else if (relRoot && (relRoot === h || relRoot.startsWith(h + '/'))) {
      best = Math.max(best, h.length)
    }
  }
  return best
}

function sortByHints(roots: string[], workspace: string, hints: string[]): string[] {
  return [...roots].sort((a, b) => {
    const sb = scoreByHints(b, workspace, hints)
    const sa = scoreByHints(a, workspace, hints)
    if (sb !== sa) return sb - sa
    return a.length - b.length
  })
}

function packageHasVite(dir: string): boolean {
  const text = readText(join(dir, 'package.json'), 40_000)
  if (!text) return false
  try {
    const obj = JSON.parse(text) as {
      dependencies?: Record<string, unknown>
      devDependencies?: Record<string, unknown>
    }
    const keys = [
      ...Object.keys(obj.dependencies || {}),
      ...Object.keys(obj.devDependencies || {}),
    ]
    return keys.some((k) => k === 'vite' || k.startsWith('vite/') || k === '@vitejs/plugin-vue' || k === '@vitejs/plugin-react')
  } catch {
    return /"vite"\s*:/.test(text)
  }
}

function looksLikeFastapi(mainPy: string): boolean {
  const body = readText(mainPy, 12_000)
  if (!body) return false
  return /\bFastAPI\b|\bAPIRouter\b|include_router/.test(body)
}

function parsePort(text: string, re: RegExp): number | null {
  const m = text.match(re)
  if (!m) return null
  const port = Number(m[1])
  if (port >= 1024 && port <= 65535) return port
  return null
}

function readPortsFromVite(configPath: string): { frontend: number | null; backend: number | null } {
  const text = readText(configPath)
  if (!text) return { frontend: null, backend: null }
  const frontend = parsePort(text, /(?:^|[,\s{])port\s*:\s*(\d{2,5})\b/m)
  const backend = parsePort(
    text,
    /target\s*:\s*['"]https?:\/\/(?:127\.0\.0\.1|localhost):(\d{2,5})['"]/i,
  )
  return { frontend, backend }
}

function discoverFastapiRoot(dir: string): string | null {
  const nested = join(dir, 'app', 'main.py')
  if (existsSync(nested) && looksLikeFastapi(nested)) return dir
  const flat = join(dir, 'main.py')
  if (!existsSync(flat) || !looksLikeFastapi(flat)) return null
  // …/backend/app/main.py → 根是 backend（uvicorn app.main:app），不是 app 目录本身
  if (/^app$/i.test(basename(dir))) {
    const parent = dirname(dir)
    if (parent && parent !== dir) return parent
  }
  return dir
}

/** 去掉被祖先根覆盖的子根，避免 hint 打分偏爱更深的 app/ 目录 */
function pruneCoveredRoots(roots: string[]): string[] {
  const uniq = [...new Set(roots.map((r) => resolve(r)))]
  return uniq.filter(
    (r) => !uniq.some((other) => other !== r && underRoot(r, other)),
  )
}

const LAYOUT_CACHE_MS = 3000
const layoutCache = new Map<string, { at: number; layout: ProjectLayout }>()

function layoutCacheKey(workspace: string, hints: string[]): string {
  return `${workspace}\0${hints.slice().sort().join('\n')}`
}

/** 测试或强制刷新时清画像缓存 */
export function clearProjectLayoutCache(): void {
  layoutCache.clear()
}

/**
 * 扫描 workspace，产出前后端根与端口。hintRels 用于优先贴近本轮改动的根。
 */
export function detectProjectLayout(workspace: string, hintRels: string[] = []): ProjectLayout {
  const root = resolve(String(workspace || '').trim())
  const hints = hintRels.map(normRel).filter(Boolean)
  const empty: ProjectLayout = {
    workspace: root,
    frontendRoots: [],
    backendRoots: [],
    viteConfigs: [],
    frontendDevPort: null,
    backendProxyPort: null,
    signals: [],
  }
  if (!root || !isDir(root)) return empty
  const ck = layoutCacheKey(root, hints)
  const cached = layoutCache.get(ck)
  if (cached && Date.now() - cached.at < LAYOUT_CACHE_MS) return cached.layout

  const frontendRoots = new Set<string>()
  const backendRoots = new Set<string>()
  const viteConfigs = new Set<string>()
  const signals: string[] = []

  type Node = { dir: string; depth: number }
  const queue: Node[] = [{ dir: root, depth: 0 }]
  const seen = new Set<string>()
  let visited = 0

  while (queue.length && visited < MAX_DIRS) {
    const { dir, depth } = queue.shift()!
    const key = resolve(dir)
    if (seen.has(key)) continue
    seen.add(key)
    visited += 1

    for (const name of VITE_NAMES) {
      const cfg = join(dir, name)
      if (!existsSync(cfg)) continue
      viteConfigs.add(cfg)
      frontendRoots.add(dir)
      if (!signals.includes(name)) signals.push(name)
    }
    if (!frontendRoots.has(dir) && packageHasVite(dir)) {
      frontendRoots.add(dir)
      if (!signals.includes('package.json+vite')) signals.push('package.json+vite')
    }

    const fastapi = discoverFastapiRoot(dir)
    if (fastapi) {
      backendRoots.add(fastapi)
      if (!signals.includes('FastAPI')) signals.push('FastAPI')
    }

    if (depth >= MAX_DEPTH) continue
    let entries: string[] = []
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of entries) {
      if (!name || name.startsWith('.')) continue
      if (SKIP_DIR.has(name)) continue
      const child = join(dir, name)
      if (!isDir(child)) continue
      queue.push({ dir: child, depth: depth + 1 })
    }
  }

  // 本轮路径落在未扫到的深层时：沿 hint 祖先再验一次（不依赖仓名）
  for (const hint of hints) {
    const abs = resolve(root, hint)
    let cur = isDir(abs) ? abs : dirname(abs)
    for (let i = 0; i < 8; i++) {
      if (!underRoot(cur, root)) break
      for (const name of VITE_NAMES) {
        const cfg = join(cur, name)
        if (existsSync(cfg)) {
          viteConfigs.add(cfg)
          frontendRoots.add(cur)
        }
      }
      const fastapi = discoverFastapiRoot(cur)
      if (fastapi) backendRoots.add(fastapi)
      if (cur === root) break
      cur = dirname(cur)
    }
  }

  const frontSorted = sortByHints(pruneCoveredRoots([...frontendRoots]), root, hints)
  const backSorted = sortByHints(pruneCoveredRoots([...backendRoots]), root, hints)
  const configs = sortByHints([...viteConfigs], root, hints)

  let frontendDevPort: number | null = null
  let backendProxyPort: number | null = null
  for (const cfg of configs) {
    const ports = readPortsFromVite(cfg)
    if (frontendDevPort == null && ports.frontend != null) frontendDevPort = ports.frontend
    if (backendProxyPort == null && ports.backend != null) backendProxyPort = ports.backend
    if (frontendDevPort != null && backendProxyPort != null) break
  }

  const layout: ProjectLayout = {
    workspace: root,
    frontendRoots: frontSorted,
    backendRoots: backSorted,
    viteConfigs: configs,
    frontendDevPort,
    backendProxyPort,
    signals,
  }
  layoutCache.set(ck, { at: Date.now(), layout })
  return layout
}

export function describeProjectLayout(layout: ProjectLayout): string {
  const parts: string[] = []
  if (layout.frontendRoots.length) {
    parts.push(
      `前端: ${layout.frontendRoots
        .slice(0, 3)
        .map((p) => toPosixRel(layout.workspace, p) || '.')
        .join(', ')}`,
    )
  }
  if (layout.backendRoots.length) {
    parts.push(
      `后端: ${layout.backendRoots
        .slice(0, 3)
        .map((p) => toPosixRel(layout.workspace, p) || '.')
        .join(', ')}`,
    )
  }
  if (layout.frontendDevPort != null) parts.push(`fe:${layout.frontendDevPort}`)
  if (layout.backendProxyPort != null) parts.push(`be:${layout.backendProxyPort}`)
  if (layout.signals.length) parts.push(`信号: ${layout.signals.join(', ')}`)
  return parts.join(' | ') || '未识别前后端布局'
}

/** 相对路径是否落在任一绝对根下 */
export function relUnderRoots(workspace: string, rel: string, absRoots: string[]): boolean {
  const r = normRel(rel)
  if (!r || !absRoots.length) return false
  const abs = resolve(workspace, r)
  return absRoots.some((root) => underRoot(abs, root))
}

/**
 * 无画像时的路径段兜底：常见目录名，禁止扫正文猜意图。
 * 故意不认单独的 api/（前端 src/api 易误伤）。
 */
export function pathLooksFrontend(rel: string): boolean {
  const r = normRel(rel)
  if (!r) return false
  if (/(^|\/)(frontend|web|client|ui|www)(\/|$)/i.test(r)) return true
  if (/\.(vue|jsx|tsx)$/i.test(r) && /(^|\/)src\//i.test(r)) return true
  return false
}

export function pathLooksBackendRuntime(rel: string): boolean {
  const r = normRel(rel)
  if (!r || !/\.py$/i.test(r)) return false
  if (/(^|\/)tests?\//i.test(r)) return false
  if (/(^|\/)test_[^/]+\.py$/i.test(r)) return false
  if (/_test\.py$/i.test(r)) return false
  if (/(^|\/)conftest\.py$/i.test(r)) return false
  if (/(^|\/)alembic\//i.test(r)) return false
  if (/(^|\/)migrations?\//i.test(r)) return false
  if (/(^|\/)__pycache__\//i.test(r)) return false
  if (/(^|\/)(backend|server)(\/|$)/i.test(r)) return true
  if (/^app\//i.test(r)) return true
  return false
}

/** 相对路径落在画像后端根，或路径段兜底 */
export function isBackendRuntimeRel(rel: string, layout?: ProjectLayout | null): boolean {
  const r = normRel(rel)
  if (!r || !/\.py$/i.test(r)) return false
  if (/(^|\/)tests?\//i.test(r)) return false
  if (/(^|\/)test_[^/]+\.py$/i.test(r)) return false
  if (/_test\.py$/i.test(r)) return false
  if (/(^|\/)conftest\.py$/i.test(r)) return false
  if (/(^|\/)alembic\//i.test(r)) return false
  if (/(^|\/)migrations?\//i.test(r)) return false
  if (/(^|\/)__pycache__\//i.test(r)) return false
  if (layout?.backendRoots?.length) {
    if (relUnderRoots(layout.workspace, r, layout.backendRoots)) return true
  }
  return pathLooksBackendRuntime(r)
}

export function isFrontendTouchRel(rel: string, layout?: ProjectLayout | null): boolean {
  const r = normRel(rel)
  if (!r) return false
  if (layout?.backendRoots?.length && relUnderRoots(layout.workspace, r, layout.backendRoots)) {
    return false
  }
  if (layout?.frontendRoots?.length && relUnderRoots(layout.workspace, r, layout.frontendRoots)) {
    // Vite 常在仓根：仓根也是 frontendRoot，勿把后端 .py 算成前端
    if (/\.py$/i.test(r)) return false
    return true
  }
  return pathLooksFrontend(r)
}

/** 相对前端根的菜单/路由探针（不含 frontend/ 前缀） */
const MENU_PROBE_UNDER_FE = [
  'src/layouts/AppLayout.vue',
  'src/layouts/MainLayout.vue',
  'src/layouts/Layout.vue',
  'src/layout/index.vue',
  'src/layout/MainLayout.vue',
  'src/router/index.js',
  'src/router/index.ts',
  'src/router/routes.js',
  'src/router/routes.ts',
] as const

/**
 * 解析本机可读的菜单/路由探针（相对 workspace）。
 * 按项目画像前端根查找；兼容顶层 frontend/ 与任意嵌套、MainLayout 等命名。
 */
export function resolveMenuProbeRels(workspace: string, hintRels: string[] = []): string[] {
  const root = resolve(String(workspace || '').trim())
  if (!root || !isDir(root)) return []
  const layout = detectProjectLayout(root, hintRels)
  const out: string[] = []
  const seen = new Set<string>()
  const addAbs = (abs: string) => {
    if (!existsSync(abs)) return
    try {
      if (!statSync(abs).isFile()) return
    } catch {
      return
    }
    const rel = toPosixRel(root, abs)
    if (!rel || rel.startsWith('..') || seen.has(rel)) return
    seen.add(rel)
    out.push(rel)
  }

  const allFe = layout.frontendRoots.length ? layout.frontendRoots : [root, join(root, 'frontend')]
  // 有本轮路径时：只认命中的前端根，避免同仓备份目录把验尸误杀
  const hintedFe = hintRels.length
    ? allFe.filter((fe) => scoreByHints(fe, root, hintRels.map(normRel).filter(Boolean)) > 0)
    : []
  const feRoots = hintedFe.length ? hintedFe : allFe

  const collectUnderFe = (fe: string) => {
    for (const sub of MENU_PROBE_UNDER_FE) addAbs(join(fe, sub))
    const layoutsDir = join(fe, 'src', 'layouts')
    if (!isDir(layoutsDir)) return
    try {
      for (const name of readdirSync(layoutsDir)) {
        if (!/layout/i.test(name) || !/\.vue$/i.test(name)) continue
        addAbs(join(layoutsDir, name))
      }
    } catch {
      /* ignore */
    }
  }
  for (const fe of feRoots) collectUnderFe(fe)

  // 无命中时再兜底顶层 frontend/
  if (!out.length) {
    for (const sub of MENU_PROBE_UNDER_FE) addAbs(join(root, 'frontend', sub))
  }

  // 本轮触及的 router/layout 文件若仍在盘上，也纳入探针
  for (const hint of hintRels.map(normRel).filter(Boolean)) {
    if (!/(^|\/)(router|layouts?)\//i.test(hint)) continue
    if (!/\.(vue|js|ts|jsx|tsx)$/i.test(hint)) continue
    addAbs(join(root, hint))
  }

  return out
}

/**
 * 把「frontend/src/...」类目录约定路径映射到画像前端根下的真实相对路径。
 * 约定表可以仍写 frontend/ 前缀；解析时剥掉再挂到任意深度的前端根。
 */
export function resolveFrontendConventionRels(
  workspace: string,
  conventionRels: string[],
  hintRels: string[] = [],
): string[] {
  const root = resolve(String(workspace || '').trim())
  if (!root || !isDir(root)) return []
  const layout = detectProjectLayout(root, hintRels)
  const feRoots = layout.frontendRoots.length ? layout.frontendRoots : [join(root, 'frontend'), root]
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of conventionRels) {
    const conv = normRel(raw)
    if (!conv) continue
    const underFe = conv.replace(/^(frontend|web|client|ui)\//i, '')
    const candidates = [
      join(root, conv),
      ...feRoots.map((fe) => join(fe, underFe)),
      ...feRoots.map((fe) => join(fe, conv)),
    ]
    for (const abs of candidates) {
      if (!existsSync(abs)) continue
      const rel = toPosixRel(root, abs)
      if (!rel || rel.startsWith('..') || seen.has(rel)) continue
      seen.add(rel)
      out.push(rel)
      break
    }
  }
  return out
}

/** 相对后端根的 FastAPI 挂载语料 */
const MOUNT_UNDER_BACKEND = [
  'app/main.py',
  'main.py',
  'app/api/__init__.py',
  'app/api/router.py',
  'app/router.py',
  'app/api.py',
  'app/routers/__init__.py',
] as const

/**
 * 把「backend/app/...」约定路径映射到画像后端根下的真实相对路径。
 */
export function resolveBackendConventionRels(
  workspace: string,
  conventionRels: string[],
  hintRels: string[] = [],
): string[] {
  const root = resolve(String(workspace || '').trim())
  if (!root || !isDir(root)) return []
  const layout = detectProjectLayout(root, hintRels)
  const beRoots = layout.backendRoots.length
    ? layout.backendRoots
    : [join(root, 'backend'), join(root, 'server'), root]
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of conventionRels) {
    const conv = normRel(raw)
    if (!conv) continue
    const underBe = conv.replace(/^(backend|server)\//i, '')
    const candidates = [
      join(root, conv),
      ...beRoots.map((be) => join(be, underBe)),
      ...beRoots.map((be) => join(be, conv)),
    ]
    for (const abs of candidates) {
      if (!existsSync(abs)) continue
      const rel = toPosixRel(root, abs)
      if (!rel || rel.startsWith('..') || seen.has(rel)) continue
      seen.add(rel)
      out.push(rel)
      break
    }
  }
  return out
}

/** 本机可读的 FastAPI 挂载文件（相对 workspace） */
export function resolveBackendMountRels(workspace: string, hintRels: string[] = []): string[] {
  return resolveBackendConventionRels(
    workspace,
    MOUNT_UNDER_BACKEND.map((p) => `backend/${p}`),
    hintRels,
  )
}

/**
 * 菜单/路由/报表目录等「接线」文件：按路径段识别，不认死 AppLayout 或顶层 frontend/。
 */
export function isUiShellWiringRel(rel: string): boolean {
  const r = normRel(rel)
  if (!r) return false
  if (/(^|\/)(layouts?|router)\//i.test(r)) return true
  if (/(^|\/)src\/config\//i.test(r)) return true
  if (/reportFeatures\.(js|ts|mjs|cjs)$/i.test(r)) return true
  if (/(^|\/)(backend|server)\/(?:app\/)?(?:main\.py$|api\/|routers\/)/i.test(r)) return true
  if (
    /(^|\/)app\/(?:main\.py$|api\/|routers\/)/i.test(r) &&
    !/(^|\/)(frontend|web|client|ui)\//i.test(r)
  ) {
    return true
  }
  return false
}
