/**
 * 写范围「连带」与审后提升：预判 FastAPI / 前端报表类半套契约问题。
 * 例：改了 routers/ 却漏 schemas.py → 写入成功、接口请求失败。
 */
import { normalizeRel, normalizeWriteScope, pathInScope } from './pathScope.js'

const ROUTER_COMPANION_FILES = [
  'schemas.py',
  'models.py',
  'database.py',
  'openapi_zh.py',
  'openapi.py',
] as const

/** 从 routers 路径推出 app 根：backend/app/routers/x.py → backend/app */
export function appRootFromRouterPath(rel: string): string | null {
  const p = normalizeRel(rel)
  if (!p) return null
  const idx = p.indexOf('/routers/')
  if (idx >= 0) return p.slice(0, idx)
  if (p === 'routers' || p.startsWith('routers/')) return ''
  return null
}

function pushUnique(out: string[], seen: Set<string>, item: string) {
  if (seen.has(item)) return
  seen.add(item)
  out.push(item)
}

/**
 * 配置层连带：scope 含 routers/ 时自动纳入同包 schemas/models 等。
 * 空 scope = 全开，不追加。
 */
export function expandWriteScopeWithCompanions(scope: string[] | null | undefined): string[] {
  const base = normalizeWriteScope(scope)
  if (!base.length) return []
  const seen = new Set(base)
  const extra: string[] = []

  for (const s of base) {
    const asPath = s.endsWith('/') ? s.slice(0, -1) : s
    if (asPath === 'routers' || asPath.endsWith('/routers')) {
      const root = asPath === 'routers' ? '' : asPath.slice(0, -'/routers'.length)
      const prefix = root ? root + '/' : ''
      for (const f of ROUTER_COMPANION_FILES) {
        pushUnique(extra, seen, prefix + f)
      }
      pushUnique(extra, seen, prefix + 'schemas/')
    }
    if (/\/views(\/|$)/.test(s) || asPath.endsWith('/views') || asPath === 'views') {
      const m = asPath.match(/^(.*?)(?:\/views.*)?$/)
      const feSrc = (m && m[1]) || ''
      let srcRoot = ''
      if (/\/src$/.test(feSrc)) srcRoot = feSrc
      else if (feSrc.includes('/src/')) srcRoot = feSrc.slice(0, feSrc.indexOf('/src/') + 4)
      else if (asPath.includes('/src/')) srcRoot = asPath.slice(0, asPath.indexOf('/src/') + 4)
      if (srcRoot) {
        const p = srcRoot.endsWith('/') ? srcRoot : srcRoot + '/'
        pushUnique(extra, seen, p + 'api/')
        pushUnique(extra, seen, p + 'router/')
        pushUnique(extra, seen, p + 'config/')
      }
    }
  }

  return normalizeWriteScope([...base, ...extra])
}

function routerRootsFromPaths(paths: string[]): Set<string> {
  const roots = new Set<string>()
  for (const p of paths) {
    const root = appRootFromRouterPath(p)
    if (root !== null) roots.add(root)
    const asPath = p.endsWith('/') ? p.slice(0, -1) : p
    if (asPath === 'routers' || asPath.endsWith('/routers')) {
      roots.add(asPath === 'routers' ? '' : asPath.slice(0, -'/routers'.length))
    }
  }
  return roots
}

function isCompanionUnderRoot(deferred: string, root: string): boolean {
  const prefix = root ? root + '/' : ''
  for (const f of ROUTER_COMPANION_FILES) {
    if (deferred === prefix + f) return true
  }
  if (deferred.startsWith(prefix + 'schemas/')) return true
  return false
}

/**
 * 审后提升：范围内已改 routers，或写范围含 routers/，范围外却有同包 schemas/models → 提升。
 */
export function selectCompanionPromotions(
  inScope: string[],
  deferred: string[],
  writeScope: string[] = [],
): string[] {
  const scopeForExpand = writeScope.length ? writeScope : inScope
  const expanded = expandWriteScopeWithCompanions(scopeForExpand)
  const roots = routerRootsFromPaths([...inScope, ...writeScope])
  const out: string[] = []
  const seen = new Set<string>()
  for (const d of deferred) {
    const rel = normalizeRel(d)
    if (!rel || seen.has(rel)) continue
    if (/\.(db|sqlite|sqlite3)$/i.test(rel)) continue
    if (expanded.length && pathInScope(rel, expanded)) {
      seen.add(rel)
      out.push(rel)
      continue
    }
    for (const root of roots) {
      if (isCompanionUnderRoot(rel, root)) {
        seen.add(rel)
        out.push(rel)
        break
      }
    }
  }
  return out
}

/** 仍 defer 的「高危」契约文件（结论里要醒目提示） */
export function criticalDeferredFiles(deferred: string[]): string[] {
  return deferred
    .map(normalizeRel)
    .filter(Boolean)
    .filter((d) => {
      const base = d.split('/').pop() || ''
      return (
        /^(schemas|models|database)(\.py)?$/i.test(base) ||
        /\/schemas\//.test(d) ||
        /openapi/i.test(base)
      )
    })
}

/**
 * 卡死的空范围 pending_review（FINISHED 却永久转圈）——可治愈为终态。
 * 优先认 review_gate；无 gate 的旧账本才用 inScopeLen + 编排器固定 detail 全等（不扫用户正文）。
 */
export function isStuckEmptyPendingReview(
  detail: string,
  inScopeLen: number,
  reviewGate?: string | null,
): boolean {
  const gate = String(reviewGate || '').trim()
  // 自动同步进行中 / 失败待手工：禁止当「卡死空范围」治愈成 succeeded
  if (gate === 'auto_applying' || gate === 'auto_failed') return false
  if (gate === 'await_user') return inScopeLen <= 0
  // 旧账本：仅认编排器写入的固定 detail，禁止宽正则扫用户可见长文
  const d = String(detail || '')
  if (d === '自动同步中…') return false
  if (d === '自动同步失败，请手动同步') return false
  if (inScopeLen > 0) return false
  return inScopeLen === 0
}

/** @deprecated 使用 isStuckEmptyPendingReview；保留别名避免旧引用 */
export function isIdlePendingReview(
  detail: string,
  inScopeLen: number,
  reviewGate?: string | null,
): boolean {
  return isStuckEmptyPendingReview(detail, inScopeLen, reviewGate)
}
