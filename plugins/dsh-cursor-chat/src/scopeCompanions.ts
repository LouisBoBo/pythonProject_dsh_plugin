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

/** 卡死的空范围 pending_review（FINISHED 却永久转圈）——可治愈为终态 */
export function isStuckEmptyPendingReview(detail: string, inScopeLen: number): boolean {
  const d = String(detail || '')
  if (/自动同步中|同步中…|正在同步/.test(d) && !/无可同步|均在范围外|自动同步失败|写码已结束/.test(d)) {
    return false
  }
  // 人工待审（有范围内文件需勾选）不是卡死，禁止自动改成 succeeded
  if (inScopeLen > 0 && /请勾选后同步/.test(d)) return false
  return (
    /无可同步项|均在范围外|契约文件未进范围|写码已结束|自动同步失败/.test(d) ||
    (inScopeLen === 0 && /待审|范围外/.test(d))
  )
}

/** @deprecated 使用 isStuckEmptyPendingReview；保留别名避免旧引用 */
export function isIdlePendingReview(detail: string, inScopeLen: number): boolean {
  return isStuckEmptyPendingReview(detail, inScopeLen)
}
