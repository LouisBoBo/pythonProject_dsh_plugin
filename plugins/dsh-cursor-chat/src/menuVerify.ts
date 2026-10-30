/**
 * 新增菜单/报表：同步后本机验尸。
 *
 * 从 Python mom menu_verify.py 移植。
 * 禁止假成功：「交付写已上菜单 / 视图已同步，但 catalog 仍 menu:false
 * 或接线文件仍在 deferred」。
 *
 * 意图收紧：仅「新增/添加…菜单|报表」类诉求触发 catalog 可见性检查，
 * 避免「修复日产报表」误杀 menu:false 的隐藏项。
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

const CATALOG_RELS = [
  'frontend/src/config/reportFeatures.js',
  'frontend/src/config/reportFeatures.ts',
] as const

const ADD_EXPLICIT = ['新增', '添加', '加上', '开通'] as const
const MENU_CTX = ['菜单', '报表', '侧栏', '侧边栏', '导航', '路由'] as const
const EXCLUDE = ['删除', '移除', '去掉', '隐藏', '下线', '修复', '重构', 'bugfix'] as const

function normRel(raw: string): string {
  return String(raw || '').trim().replace(/\\/g, '/').replace(/^\.\/?/, '')
}

/** 判断一个 rel 是否属于"接线文件"（不同步则写完了但刷新看不到） */
export function isUiShellWiring(rel: string): boolean {
  const r = normRel(rel)
  if (!r) return false
  if (
    r === 'frontend/src/layouts/AppLayout.vue' ||
    r.endsWith('/layouts/AppLayout.vue') ||
    r.includes('/layouts/')
  ) return true
  if (
    r === 'frontend/src/router/index.js' ||
    r === 'frontend/src/router/index.ts' ||
    r.includes('/router/')
  ) return true
  if (
    r.startsWith('frontend/src/config/')
  ) return true
  if (
    r === 'backend/app/main.py' ||
    r === 'backend/main.py' ||
    r.includes('/backend/app/api/') ||
    r.includes('/backend/app/routers/')
  ) return true
  return false
}

function syncedRels(syncedFiles?: string[]): string[] {
  const out: string[] = []
  for (const raw of syncedFiles || []) {
    const s = normRel(raw)
    if (!s || s.startsWith('删除 ')) continue
    out.push(s)
  }
  return out
}

/** 仍 deferred 的接线文件 → 禁止任务报成功 */
export function deferredWiringBlockers(deferredFiles?: string[]): string[] {
  const bad: string[] = []
  for (const raw of deferredFiles || []) {
    const rel = normRel(raw)
    if (!rel) continue
    if (isUiShellWiring(rel) || rel.startsWith('frontend/src/config/')) bad.push(rel)
  }
  return bad
}

function isAddMenuIntent(requirement: string): boolean {
  const text = String(requirement || '').trim()
  if (!text) return false
  if (EXCLUDE.some(k => text.includes(k))) return false
  const hasAdd = ADD_EXPLICIT.some(k => text.includes(k))
  const hasCtx = MENU_CTX.some(k => text.includes(k))
  return hasAdd && hasCtx
}

type CatalogEntry = { id: string; viewFile: string; menu: boolean | null; title: string }

/** 从 reportFeatures 风格 catalog 抽出 id / viewFile / menu / title */
function parseCatalogBlocks(text: string): CatalogEntry[] {
  const entries: CatalogEntry[] = []
  const viewFileRe = /\bviewFile\s*:\s*['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = viewFileRe.exec(text)) !== null) {
    const viewFile = m[1].trim()
    // 向前找最近的 {
    const start = text.lastIndexOf('{', m.index)
    if (start < 0) continue
    // 向后找配对 }
    let depth = 0, end = -1
    for (let i = start; i < text.length; i++) {
      const ch = text[i]
      if (ch === '{') depth++
      else if (ch === '}') { depth--; if (depth === 0) { end = i; break } }
    }
    if (end < 0) continue
    const block = text.slice(start, end + 1)
    const idM = block.match(/\bid\s*:\s*['"]([^'"]+)['"]/)
    const menuM = block.match(/\bmenu\s*:\s*(true|false)/i)
    const titleM = block.match(/\btitle\s*:\s*['"]([^'"]+)['"]/)
    entries.push({
      id: idM ? idM[1].trim() : '',
      viewFile,
      menu: menuM ? menuM[1].toLowerCase() === 'true' : null,
      title: titleM ? titleM[1].trim() : '',
    })
  }
  return entries
}

function readCatalog(target: string): { path: string | null; text: string; entries: CatalogEntry[] } {
  for (const rel of CATALOG_RELS) {
    const path = join(target, rel)
    if (existsSync(path)) {
      try {
        const text = readFileSync(path, 'utf8')
        return { path, text, entries: parseCatalogBlocks(text) }
      } catch {
        return { path, text: '', entries: [] }
      }
    }
  }
  return { path: null, text: '', entries: [] }
}

function corpusMentionsEntry(corpus: string, entry: CatalogEntry): boolean {
  const c = corpus.replace(/\s/g, '')
  const eid = entry.id
  const title = entry.title
  if (eid) {
    const compact = eid.replace(/-/g, '').replace(/_/g, '')
    if (corpus.includes(eid)) return true
    if (compact && c.replace(/-/g, '').replace(/_/g, '').includes(compact)) return true
  }
  if (title && corpus.includes(title)) return true
  if (corpus.includes('日产') && (eid === 'daily-output' || eid === 'daily_output')) return true
  if (corpus.includes('工时') && eid.replace(/-/g, '').includes('employee')) return true
  if (corpus.includes('在制品') && eid === 'wip') return true
  return false
}

export type MenuVerifyResult = { ok: boolean; detail: string }

/**
 * 新增菜单/报表后验尸。
 *
 * 失败条件：
 * 1. 接线/config 仍在 deferred（任意任务）
 * 2. 明确「新增菜单/报表」且已同步视图，但 catalog 未注册或 menu:false
 * 3. 无 catalog 文件 → 跳过 catalog 检查，不算失败
 */
export function verifyAddMenuOnTarget(
  targetRoot: string,
  requirement: string,
  opts?: { synced_files?: string[]; deferred_files?: string[] },
): MenuVerifyResult {
  // 1) deferred 接线文件 → 直接 blocker
  const blockers = deferredWiringBlockers(opts?.deferred_files)
  if (blockers.length) {
    return {
      ok: false,
      detail: `菜单/路由配置未同步到本机（仍 deferred）：${blockers.slice(0, 8).join('、')}。` +
        '禁止报成功；请扩大写范围或重新开工。',
    }
  }

  // 非新增菜单 intent → 直接 ok
  if (!isAddMenuIntent(requirement)) return { ok: true, detail: '' }

  const target = resolve(targetRoot)
  const synced = syncedRels(opts?.synced_files)
  const reportViews = synced.filter(r =>
    /\.(vue|tsx|jsx)$/.test(r) && r.includes('/views/'),
  )
  const catalogTouched = synced.some(
    r => CATALOG_RELS.includes(r as any) || r.startsWith('frontend/src/config/'),
  )

  if (!reportViews.length && !catalogTouched) {
    return { ok: true, detail: '' }
  }

  // 2) 读 catalog
  const { path: catalogPath, entries } = readCatalog(target)
  if (catalogPath === null) {
    return { ok: true, detail: '未找到菜单注册文件，已跳过 catalog 可见性检查' }
  }

  const byView = new Map<string, CatalogEntry>()
  for (const e of entries) if (e.viewFile) byView.set(e.viewFile, e)

  const problems: string[] = []
  for (const rel of reportViews) {
    const viewFile = rel.split('/').pop()!
    const entry = byView.get(viewFile)
    if (!entry) {
      // catalog 有 viewFile 字段但没有这个 view → 未注册
      if (entries.some(e => 'viewFile' in e)) {
        problems.push(`${viewFile} 已同步但 ${catalogPath.split('/').pop()} 未注册`)
      }
      continue
    }
    if (entry.menu === false) {
      const eid = entry.id || viewFile
      problems.push(`${catalogPath.split('/').pop()} 中「${eid}」仍为 menu:false（侧栏不会出现）`)
    }
  }

  // catalog 被改但没同步视图 → 按 requirement 正文点名检查
  if (catalogTouched && !reportViews.length) {
    for (const e of entries) {
      if (corpusMentionsEntry(String(requirement || ''), e) && e.menu === false) {
        const eid = e.id || e.viewFile || '?'
        problems.push(`${catalogPath.split('/').pop()} 中「${eid}」仍为 menu:false（侧栏不会出现）`)
      }
    }
  }

  if (problems.length) {
    return { ok: false, detail: problems.slice(0, 8).join('；') + '。禁止假成功，请修好 catalog 后重试。' }
  }
  return { ok: true, detail: '本机菜单验尸通过' }
}
