/**
 * 新增菜单/报表：同步后本机验尸。
 *
 * 从 Python mom menu_verify.py 移植。
 * 禁止假成功：「交付写已上菜单 / 视图已同步，但 catalog 仍 menu:false
 * 或接线文件仍在 deferred」。
 *
 * 意图收紧：仅「新增/添加…菜单|报表」类诉求触发可见性检查，
 * 避免「修复日产报表」误杀 menu:false 的隐藏项。
 *
 * 只读这一轮同步过的注册文件（路由、侧栏、报表目录）。
 * 没改到的文件不打开，也不拿它们的内容判这一轮未完成。
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

function fileBase(raw: string): string {
  const n = normRel(raw)
  const i = n.lastIndexOf('/')
  return i >= 0 ? n.slice(i + 1) : n
}

function isReportViewRel(rel: string): boolean {
  const r = normRel(rel)
  return r.includes('/views/reports/') || r.includes('/views/report/')
}

function isShellPageRel(rel: string): boolean {
  const r = normRel(rel)
  if (!/\.(vue|tsx|jsx)$/.test(r) || !r.includes('/views/')) return false
  if (isReportViewRel(r) || r.includes('/components/')) return false
  return true
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

type CatalogEntry = {
  id: string
  viewFile: string
  menu: boolean | null
  enabled: boolean | null
  title: string
}

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
    const enabledM = block.match(/\benabled\s*:\s*(true|false)/i)
    const titleM = block.match(/\btitle\s*:\s*['"]([^'"]+)['"]/)
    entries.push({
      id: idM ? idM[1].trim() : '',
      viewFile,
      menu: menuM ? menuM[1].toLowerCase() === 'true' : null,
      enabled: enabledM ? enabledM[1].toLowerCase() === 'true' : null,
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

export type MenuVerifyResult = { ok: boolean; detail: string }

function braceBlockAt(text: string, indexInside: number): string | null {
  const start = text.lastIndexOf('{', indexInside)
  if (start < 0) return null
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

function escapeReg(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

type ShellFile = { rel: string; text: string }

function listShellFiles(target: string, synced: string[]): { routers: ShellFile[]; layouts: ShellFile[] } {
  const rels = new Set<string>()
  for (const rel of synced) {
    const r = normRel(rel)
    if (r.includes('/router/') || r.includes('/layouts/')) rels.add(r)
  }
  const routers: ShellFile[] = []
  const layouts: ShellFile[] = []
  for (const rel of rels) {
    const path = join(target, rel)
    if (!existsSync(path)) continue
    let text = ''
    try { text = readFileSync(path, 'utf8') } catch { continue }
    const item = { rel, text }
    if (rel.includes('/layouts/')) layouts.push(item)
    else if (rel.includes('/router/')) routers.push(item)
  }
  return { routers, layouts }
}

/** 路由里把该页面挂到了哪些路径（含 `前缀/${path}` 拼出来的路径） */
function routeKeysForComponent(text: string, component: string, viewFile: string): string[] {
  const keys = new Set<string>()
  const name = escapeReg(component)
  const tern = new RegExp(`['"]([^'"]+)['"]\\s*\\?\\s*${name}\\b`, 'g')
  let m: RegExpExecArray | null
  while ((m = tern.exec(text)) !== null) keys.add(m[1].replace(/^\//, ''))
  const directRes = [
    new RegExp(`\\bcomponent\\s*:\\s*${name}\\b`, 'g'),
    new RegExp(`import\\s*\\([^)]*${escapeReg(viewFile)}[^)]*\\)`, 'g'),
  ]
  for (const re of directRes) {
    while ((m = re.exec(text)) !== null) {
      const block = braceBlockAt(text, m.index)
      const pathM = block?.match(/\bpath\s*:\s*['"`]([^'"`$]+)['"`]/)
      if (pathM) keys.add(pathM[1].replace(/^\//, ''))
    }
  }
  const affixes: { pre: string; post: string }[] = []
  const prefRe = /path\s*:\s*`([^`$]*)\$\{path\}([^`]*)`/g
  while ((m = prefRe.exec(text)) !== null) affixes.push({ pre: m[1], post: m[2] })
  const composed = new Set<string>()
  for (const key of keys) {
    if (!key || key.includes('${')) continue
    composed.add(key)
    if (!key.includes('/')) {
      for (const affix of affixes) {
        const full = `${affix.pre}${key}${affix.post}`.replace(/^\/+/, '').replace(/\/{2,}/g, '/')
        if (full && !full.includes('${')) composed.add(full)
      }
    }
  }
  return [...composed]
}

function layoutMenus(text: string): { path: string }[] {
  const out: { path: string }[] = []
  const re = /\bpath\s*:\s*['"`]([^'"`$]+)['"`]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const block = braceBlockAt(text, m.index)
    if (!block || !/\btitle\s*:/.test(block)) continue
    out.push({ path: m[1] })
  }
  return out
}

function menuPathMatches(menuPath: string, routeKey: string): boolean {
  const p = menuPath.replace(/\\/g, '/').replace(/^\/+/, '')
  const k = routeKey.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!k || k.includes('${')) return false
  return p === k || p.endsWith('/' + k)
}

type ViewVerdict = {
  ok: boolean
  passNote: string
  failNote: string
  /** 报表目录明确说不可见。有这条时，不能因为别的页面挂了路由就放过。 */
  catalogBlocked: boolean
  /** 唯一的问题是路由没引用。同轮已有页面挂上菜单时，这多半是子组件。 */
  unreferenced: boolean
}

function judgeView(
  rel: string,
  catalog: { path: string | null; entries: CatalogEntry[] },
  shell: { routers: ShellFile[]; layouts: ShellFile[] },
  routerText: string,
  menus: { path: string }[],
): ViewVerdict {
  const viewFile = fileBase(rel)
  const component = viewFile.replace(/\.(vue|tsx|jsx)$/i, '')
  const byView = new Map<string, CatalogEntry>()
  for (const entry of catalog.entries) if (entry.viewFile) byView.set(entry.viewFile, entry)
  const catalogApplies = Boolean(catalog.path) && (isReportViewRel(rel) || byView.has(viewFile))
  const catalogName = catalog.path ? fileBase(catalog.path) : ''
  let catalogOk = false
  let catalogNote = ''
  if (catalogApplies) {
    const entry = byView.get(viewFile)
    if (!entry) catalogNote = `${catalogName} 未登记该页面`
    else {
      const blocked = catalogEntryProblems(catalogName, entry, viewFile)
      if (blocked.length) catalogNote = blocked[0]
      else {
        catalogOk = true
        catalogNote = `${viewFile} 已在报表目录中可见`
      }
    }
  }
  const shellApplies = shell.routers.length > 0 || shell.layouts.length > 0
  let shellOk = false
  let shellNote = ''
  let unreferenced = false
  if (shellApplies && component) {
    const mentioned = routerText.includes(component) || routerText.includes(viewFile)
    if (!mentioned) {
      unreferenced = true
      shellNote = '路由没有引用该页面'
    } else {
      const keys = routeKeysForComponent(routerText, component, viewFile)
      if (!keys.length) shellNote = '路由没有把它挂到可访问路径'
      else if (shell.layouts.length) {
        const hit = menus.some((menu) => keys.some((key) => menuPathMatches(menu.path, key)))
        if (!hit) shellNote = '路由已挂上，侧栏没有对应入口'
        else {
          shellOk = true
          shellNote = `${viewFile} 已由路由和侧栏挂上`
        }
      } else {
        shellOk = true
        shellNote = `${viewFile} 已挂到路由`
      }
    }
  }
  const neither = !catalogApplies && !shellApplies
  const ok = neither || catalogOk || shellOk
  const failParts = [
    catalogApplies && !catalogOk ? catalogNote : '',
    shellApplies && !shellOk ? shellNote : '',
  ].filter(Boolean)
  return {
    ok,
    passNote: shellOk ? shellNote : catalogNote,
    failNote: failParts.length ? `${viewFile}：${failParts.join('；')}` : '',
    catalogBlocked: catalogApplies && !catalogOk,
    unreferenced,
  }
}

function catalogEntryProblems(catalogName: string, entry: CatalogEntry, viewFile: string): string[] {
  const eid = entry.id || viewFile
  if (entry.menu === false) {
    return [`${catalogName} 中「${eid}」仍为 menu:false（侧栏不会出现）`]
  }
  if (entry.enabled === false) {
    return [`${catalogName} 中「${eid}」仍为 enabled:false（菜单不会出现）`]
  }
  return []
}

/**
 * 新增菜单/报表后验尸。
 *
 * 只核对本轮改过的路由、侧栏、报表目录。这些文件里有一路把页面挂上即通过。
 * 本轮没改注册文件时不翻工程里的旧目录，也不因此判未完成。
 */
export function verifyAddMenuOnTarget(
  targetRoot: string,
  requirement: string,
  opts?: { synced_files?: string[]; deferred_files?: string[] },
): MenuVerifyResult {
  const blockers = deferredWiringBlockers(opts?.deferred_files)
  if (blockers.length) {
    return {
      ok: false,
      detail: `菜单/路由配置未同步到本机（仍 deferred）：${blockers.slice(0, 8).join('、')}。` +
        '禁止报成功；请扩大写范围或重新开工。',
    }
  }

  if (!isAddMenuIntent(requirement)) return { ok: true, detail: '' }

  const target = resolve(targetRoot)
  const synced = syncedRels(opts?.synced_files)
  const reportViews = synced.filter(isReportViewRel)
  const shellViews = synced.filter(isShellPageRel)
  const catalogTouched = synced.some((r) =>
    (CATALOG_RELS as readonly string[]).includes(r) || fileBase(r).startsWith('reportFeatures.'),
  )

  if (!reportViews.length && !shellViews.length && !catalogTouched) {
    return { ok: true, detail: '' }
  }

  const pageViews = [...reportViews, ...shellViews]
  const registration = synced.some((r) =>
    r.includes('/router/') || r.includes('/layouts/') || catalogTouched && (
      (CATALOG_RELS as readonly string[]).includes(r) || fileBase(r).startsWith('reportFeatures.')
    ),
  )
  if (!pageViews.length || !registration) return { ok: true, detail: '' }

  const catalog = catalogTouched
    ? readCatalog(target)
    : { path: null, text: '', entries: [] as CatalogEntry[] }
  if (catalogTouched && catalog.path === null && !synced.some((r) => r.includes('/router/') || r.includes('/layouts/'))) {
    return { ok: true, detail: '未找到菜单注册文件，已跳过 catalog 可见性检查' }
  }

  const problems: string[] = []

  const shell = listShellFiles(target, synced)
  const routerText = shell.routers.map((s) => s.text).join('\n')
  const menus = shell.layouts.flatMap((s) => layoutMenus(s.text))
  const verdicts = pageViews.map((rel) => judgeView(rel, catalog, shell, routerText, menus))
  const someWired = verdicts.some(
    (v) => v.passNote.includes('已由路由') || v.passNote.includes('已挂到路由'),
  )
  for (const verdict of verdicts) {
    if (verdict.ok) continue
    if (someWired && verdict.unreferenced && !verdict.catalogBlocked) continue
    if (verdict.failNote) problems.push(verdict.failNote)
  }

  if (problems.length) {
    return {
      ok: false,
      detail: problems.slice(0, 8).join('；') + '。以上几路都没有把菜单挂上。',
    }
  }
  const notes = verdicts.map((v) => v.passNote).filter(Boolean)
  const suffix = notes.length ? `：${notes.slice(0, 4).join('；')}` : ''
  return { ok: true, detail: `本机菜单验尸通过${suffix}` }
}
