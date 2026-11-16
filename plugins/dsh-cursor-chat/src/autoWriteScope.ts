/**
 * 本机可写范围：默认按项目画像自动推导，用户无需配置。
 *
 * 口径（宁宽勿窄）：
 * - 配置里显式 writeScope → 硬边界（source=config）
 * - 画像认出嵌套前后端根 → 用这些前缀做沙箱/初筛（source=auto）
 * - 根上就是 Vite/FastAPI、或认不出 → 整仓开放（source=open，等同空 scope）
 * - source=auto 时：范围外但仍可交付的改动会软放行，避免挡真写码
 * - 敏感路径 / 本机库 / Mock 标记：任何 source 都硬拒绝
 */
import { relative, sep } from 'node:path'
import { detectProjectLayout } from './projectLayout.js'
import {
  COPY_SKIP_DIR_NAMES,
  isNonDeliverableRel,
  normalizeRel,
  normalizeWriteScope,
  shouldSkipDirname,
} from './pathScope.js'
import { expandWriteScopeWithCompanions } from './scopeCompanions.js'

export type WriteScopeSource = 'config' | 'auto' | 'open'

export type ResolvedWriteScope = {
  scope: string[]
  source: WriteScopeSource
}

/** 画像根 → 相对工作区前缀（目录以 / 结尾）。工作区自身为根时返回 null（表示应整仓开放）。 */
export function rootAbsToScopePrefix(workspace: string, absRoot: string): string | null {
  const ws = String(workspace || '').trim()
  const abs = String(absRoot || '').trim()
  if (!ws || !abs) return null
  let rel = relative(ws, abs).split(sep).join('/')
  if (!rel || rel === '.') return null
  if (rel.startsWith('..')) return null
  if (!rel.endsWith('/')) rel += '/'
  return normalizeWriteScope([rel])[0] || null
}

/**
 * 仅按项目画像推导可写前缀（不含配置覆盖、不含契约连带）。
 * 任一前后端根落在工作区根上 → 返回 []（整仓开放，避免把 monorepo 根 Vite 误收窄）。
 */
export function resolveAutoWriteScope(workspace: string, hintRels: string[] = []): string[] {
  const ws = String(workspace || '').trim()
  if (!ws) return []
  const layout = detectProjectLayout(ws, hintRels)
  const absRoots = [...(layout.frontendRoots || []), ...(layout.backendRoots || [])]
  if (!absRoots.length) return []

  const prefixes: string[] = []
  let wholeWorkspace = false
  for (const abs of absRoots) {
    const prefix = rootAbsToScopePrefix(ws, abs)
    if (prefix == null) {
      // 根即工作区：再收窄只会误伤同仓其它合法路径
      wholeWorkspace = true
      break
    }
    prefixes.push(prefix)
  }
  if (wholeWorkspace) return []
  return normalizeWriteScope(prefixes)
}

/** 生效写范围：显式配置优先；否则画像自动；再否则整仓开放。 */
export function resolveEffectiveWriteScope(opts: {
  workspace: string
  configScope?: string[] | null
  hintRels?: string[]
}): ResolvedWriteScope {
  const cfg = normalizeWriteScope(opts.configScope)
  if (cfg.length) {
    return { scope: expandWriteScopeWithCompanions(cfg), source: 'config' }
  }
  const auto = resolveAutoWriteScope(opts.workspace, opts.hintRels || [])
  if (!auto.length) {
    return { scope: [], source: 'open' }
  }
  return { scope: expandWriteScopeWithCompanions(auto), source: 'auto' }
}

/** 自动范围下，不同步的噪音路径（构建产物、依赖、编辑器目录等）。 */
export function isAutoScopeNoiseRel(rel: string): boolean {
  const r = normalizeRel(rel)
  if (!r) return true
  const parts = r.split('/').filter(Boolean)
  for (const part of parts) {
    if (shouldSkipDirname(part) || COPY_SKIP_DIR_NAMES.has(part)) return true
  }
  const base = parts[parts.length - 1] || ''
  if (base === '.DS_Store' || base === 'Thumbs.db') return true
  return false
}

/**
 * auto 模式下：把「范围外但可交付」的改动软放行，避免画像略窄挡真写码。
 * 仍拒绝敏感/库文件/噪音目录。
 */
export function selectAutoScopePromotions(deferred: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of deferred) {
    const rel = normalizeRel(raw)
    if (!rel || seen.has(rel)) continue
    if (isNonDeliverableRel(rel)) continue
    if (isAutoScopeNoiseRel(rel)) continue
    seen.add(rel)
    out.push(rel)
  }
  return out
}

/** 旧账本无 source：有范围当硬配置，无范围当开放。 */
export function coerceWriteScopeSource(
  source: WriteScopeSource | null | undefined,
  scope: string[] | null | undefined,
): WriteScopeSource {
  if (source === 'config' || source === 'auto' || source === 'open') return source
  return normalizeWriteScope(scope).length ? 'config' : 'open'
}
