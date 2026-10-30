/**
 * 删除计划解析 + 引擎强制执行 + 菜单路由修补
 *
 * 从 Python mom 源码 delete_enforce.py 移植。
 * 依赖 deleteIntent + deleteVerify + pathScope。
 * 物理删除走 applyDeletesToTarget（sandbox → 目标，插件已有安全管道）。
 */

import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync, copyFileSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { extractDeleteFeatures, extractClaimedDeletedPaths, isDeleteIntent } from './deleteIntent.js'
import { FEATURE_ORPHAN_FILES, FEATURE_ROUTE_MARKERS } from './deleteVerify.js'
import { isSensitiveRel } from './pathScope.js'

const MENU_ROUTER_FILES = new Set<string>([
  'frontend/src/layouts/AppLayout.vue',
  'frontend/src/router/index.js',
])
const BLOCK_DELETE_FILES = new Set<string>([
  'frontend/src/layouts/AppLayout.vue',
  'frontend/src/router/index.js',
  'frontend/src/main.js',
  'frontend/package.json',
  'package.json',
])
const PROTECTED_BASENAMES = new Set<string>([
  'InspectionEntryView.vue', 'inspection.js',
  'main.js', 'main.ts', 'main.py',
  'App.vue', 'package.json', 'vite.config.js', 'vite.config.ts',
  'schemas.py', 'openapi_zh.py',
])
const SHARED_WHOLE_FILE_DENY = new Set<string>([
  'warehouse.js', 'inspection.js', 'qualityInspectionRecords.js',
  'request.js', 'http.js', 'axios.js', 'client.js', 'api.js', 'auth.js',
  'main.js', 'main.ts', 'App.vue', 'AppLayout.vue', 'index.js', 'package.json',
  'main.py', 'schemas.py', 'openapi_zh.py', 'auth.py', 'dashboard.py',
  'warehouse.py', 'production.py', 'quality.py', 'inspection.py',
  'equipment.py', 'messages.py', 'reports.py', 'work_orders.py', 'devices.py',
])
const MAX_PLAN_FILES = 24

const FEATURE_TOKEN_MAP: Record<string, readonly string[]> = {
  '检验记录': ['inspectionrecords'],
  '检验任务': ['inspectiontasks'],
  '检验方案': ['inspectionplans'],
  '品质概览': ['qualityoverview'],
  '生产排产': ['productionscheduling', 'scheduling'],
  '仓储看板': ['warehousedashboard', 'warehousekanban'],
  '生产看板': ['productiondashboard', 'productionkanban'],
  '品质看板': ['qualitydashboard', 'qualitykanban'],
  '设备看板': ['devicedashboard', 'equipmentkanban'],
  '综合看板': ['generaldashboard', 'comprehensivekanban'],
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function normRel(rel: string): string {
  return String(rel || '').replace(/\\/g, '/').trim().replace(/^\.\/?/, '')
}

export function relIsProtected(rel: string): boolean {
  const r = normRel(rel)
  if (!r) return true
  if (BLOCK_DELETE_FILES.has(r) || MENU_ROUTER_FILES.has(r)) return true
  const base = r.split('/').pop()!
  if (PROTECTED_BASENAMES.has(base)) return true
  if (r.includes('..')) return true
  return false
}

export function safeFileUnderRoot(root: string, rel: string): string | null {
  const r = normRel(rel)
  if (!r || relIsProtected(r) || isSensitiveRel(r)) return null
  if (r.includes('..')) return null
  const cand = safePathUnderRoot(root, r)
  if (!cand || !existsSync(cand)) return null
  return cand
}

/** 通用：返回 resolve(root, rel) 且确保在 root 下（containment 检查），否则 null */
export function safePathUnderRoot(root: string, rel: string): string | null {
  const rootR = resolve(root)
  const cand = resolve(rootR, rel)
  if (!cand.startsWith(rootR + '/') && cand !== rootR) return null
  return cand
}

/** 引擎白名单：仅功能登记且本机存在的路径（不含菜单/路由壳文件） */
export function planDeleteFileTargets(requirement: string, targetRoot: string): string[] {
  if (!isDeleteIntent(requirement)) return []
  const root = resolve(targetRoot)
  const features = extractDeleteFeatures(requirement)
  const rels: string[] = []
  const seen = new Set<string>()

  for (const feat of features) {
    for (const rel of FEATURE_ORPHAN_FILES[feat] || []) {
      const r = normRel(rel)
      if (!r || seen.has(r)) continue
      if (relIsProtected(r) || isSensitiveRel(r)) continue
      if (MENU_ROUTER_FILES.has(r) || BLOCK_DELETE_FILES.has(r)) continue
      const base = r.split('/').pop()!
      if (PROTECTED_BASENAMES.has(base)) continue
      if (!existsSync(join(root, r))) continue
      seen.add(r)
      rels.push(r)
      if (rels.length >= MAX_PLAN_FILES) return rels
    }
  }
  return rels
}

/** 从 Cursor 终稿/过程正文解析删除清单 */
export function parseDeletePlanFromText(text: string): string[] {
  let body = String(text || '')
  const heading = body.match(/^#{1,3}\s*删除清单/m)
  if (heading) body = body.slice(heading.index! + heading[0].length)
  else if (body.includes('删除清单')) body = body.split('删除清单', 2)[1]
  const stop = body.search(/(?:^|\n)\s*结论\s*[：:]/m)
  if (stop >= 0) body = body.slice(0, stop)

  const out: string[] = []
  const seen = new Set<string>()
  const add = (raw: string) => {
    let r = normRel(raw).replace(/`/g, '')
    if (r) r = r.split(/[：:\s]/)[0].trim()
    if (!r || seen.has(r)) return
    if (r.includes('..')) return
    if (!/(frontend|backend|apps|src)\//.test(r)) return
    if (!/\.[A-Za-z0-9]+$/.test(r)) return
    seen.add(r); out.push(r)
  }
  for (const m of body.matchAll(/`((?:frontend|backend|apps|src)\/[^`]+)`/g)) add(m[1])
  for (const m of body.matchAll(
    /(?:^|[\s\-])((?:frontend|backend|apps|src)\/[\w./@-]+\.[A-Za-z0-9]+)/gm,
  )) add(m[1])
  if (!out.length) {
    for (const rel of extractClaimedDeletedPaths(text)) add(rel)
  }
  return out.slice(0, MAX_PLAN_FILES)
}

/** 从过程正文提取删除清单 +「已删除」路径 */
export function extractDeletedPathsFromProcess(text: string): string[] {
  const body = String(text || '')
  const out: string[] = []
  const seen = new Set<string>()
  const add = (raw: string) => {
    let r = normRel(raw).replace(/`/g, '')
    if (r) r = r.split(/[：:\s]/)[0].trim()
    if (!r || seen.has(r)) return
    if (!/(frontend|backend|apps|src)\//.test(r)) return
    seen.add(r); out.push(r)
  }
  for (const rel of parseDeletePlanFromText(body)) add(rel)
  for (const m of body.matchAll(
    /(?:已删除|引擎已删除|准备删除|将删除)\s*`((?:frontend|backend|apps|src)\/[^`]+)`/g,
  )) add(m[1])
  return out.slice(0, MAX_PLAN_FILES)
}

export type ValidateResult = { approved: string[]; rejected: string[] }

/** 校验待删清单；引擎白名单必批；Cursor 清单中页面/API/路由在范围内放行 */
export function validateDeletePlan(
  paths: string[],
  requirement: string,
  targetRoot: string,
  opts?: { write_scope?: string[] },
): ValidateResult {
  const root = resolve(targetRoot)
  const approved: string[] = []
  const rejected: string[] = []
  const seen = new Set<string>()
  const approve = (rel: string) => {
    const r = normRel(rel)
    if (!r || seen.has(r)) return
    seen.add(r); approved.push(r)
  }

  const features = extractDeleteFeatures(requirement)
  const engineFloor = planDeleteFileTargets(requirement, targetRoot)
  const floorSet = new Set(engineFloor)
  const ws = (opts?.write_scope || []).map(p => normRel(p).replace(/\/$/, ''))
  const inScope = (r: string): boolean => {
    if (!ws.length) return true
    return ws.some(p => r === p || r.startsWith(p + '/'))
  }

  // 引擎白名单先过
  for (const relN of engineFloor) {
    if (relIsProtected(relN) || isSensitiveRel(relN)) {
      rejected.push(`${relN}：保护/敏感路径，跳过`); continue
    }
    if (!inScope(relN)) { rejected.push(`${relN}：不在 write_scope`); continue }
    if (relN.includes('..') || safeFileUnderRoot(root, relN) === null) {
      rejected.push(`${relN}：非法路径或不存在`); continue
    }
    approve(relN)
    if (approved.length >= MAX_PLAN_FILES) return { approved, rejected }
  }

  // Cursor 清单
  for (const rel of paths) {
    const relN = normRel(rel)
    if (!relN || seen.has(relN)) continue
    if (relN.includes('..')) { rejected.push(`${relN}：非法相对路径`); continue }
    if (MENU_ROUTER_FILES.has(relN) || BLOCK_DELETE_FILES.has(relN)) {
      rejected.push(`${relN}：菜单/路由由引擎修补，禁止整文件删除`); continue
    }
    if (relIsProtected(relN) || isSensitiveRel(relN)) {
      rejected.push(`${relN}：保护/敏感路径`); continue
    }
    if (safeFileUnderRoot(root, relN) === null) {
      rejected.push(`${relN}：本机不存在或越界`); continue
    }
    if (floorSet.has(relN)) continue
    if (!inScope(relN)) { rejected.push(`${relN}：不在 write_scope`); continue }

    const base = relN.split('/').pop()!.toLowerCase()
    if (SHARED_WHOLE_FILE_DENY.has(base)) { rejected.push(`${relN}：共用壳文件，拒绝整删`); continue }
    if (relN.startsWith('frontend/src/api/') && /\.(js|ts|mjs|cjs)$/.test(relN)) { approve(relN); continue }
    if (relN.startsWith('backend/app/routers/') && relN.endsWith('.py') && base !== '__init__.py') { approve(relN); continue }
    if (relN.endsWith('.vue') && relN.includes('/views/')) {
      const stem = base.replace(/_/g, '').replace(/-/g, '').replace(/\.vue$/, '').toLowerCase()
      let ok = false
      for (const feat of features) {
        const tokens = FEATURE_TOKEN_MAP[feat]
        if (tokens && tokens.some(t => stem.includes(t))) { ok = true; break }
      }
      if (ok) { approve(relN); continue }
    }
    rejected.push(`${relN}：不确定，拒绝删除（共用壳或不支持整删类型）`)
    if (approved.length >= MAX_PLAN_FILES) break
  }
  return { approved, rejected }
}

// ========== 菜单路由修补 ==========

function stripMenuLines(text: string, feature: string): { text: string; changed: boolean } {
  if (!text || !feature) return { text, changed: false }
  let changed = false
  const markers = FEATURE_ROUTE_MARKERS[feature] || []
  const lines = text.split('\n')
  const out: string[] = []
  for (const line of lines) {
    let drop = false
    if (new RegExp(`title:\\s*['"]${escapeRegex(feature)}['"]`).test(line)) drop = true
    if (!drop) {
      for (const mk of markers) {
        if (line.toLowerCase().includes(mk.toLowerCase())) { drop = true; break }
      }
    }
    if (drop) { changed = true; continue }
    out.push(line)
  }
  const result = out.join('\n')
  return { text: result + (text.endsWith('\n') ? '\n' : ''), changed }
}

function extractBalancedObject(text: string, start: number): { block: string; end: number } | null {
  if (start < 0 || start >= text.length || text[start] !== '{') return null
  let depth = 0, i = start, inStr: string | null = null, escape = false
  while (i < text.length) {
    const ch = text[i]
    if (inStr) {
      if (escape) escape = false
      else if (ch === '\\') escape = true
      else if (ch === inStr) inStr = null
      i++; continue
    }
    if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; i++; continue }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        let end = i + 1
        let j = end
        while (j < text.length && ' \t'.includes(text[j])) j++
        if (j < text.length && text[j] === ',') end = j + 1
        return { block: text.slice(start, end), end }
      }
    }
    i++
  }
  return null
}

function stripRouterBlocks(text: string, feature: string): { text: string; changed: boolean } {
  if (!text || !feature) return { text, changed: false }
  let markers = [...(FEATURE_ROUTE_MARKERS[feature] || [])]
  if (feature === '检验方案') markers.push('inspection-plans')
  else if (feature === '检验任务') markers.push('inspection-tasks', 'quality-inspection-tasks')
  else if (feature === '检验记录') markers.push('inspection-records', 'quality-inspection-records')
  else if (feature === '品质概览') markers.push('QualityOverview', 'quality-overview')
  else if (feature === '生产排产') markers.push('production/scheduling', 'production-scheduling', 'ProductionScheduling')
  if (!markers.length) return { text, changed: false }

  let changed = false
  let out = text
  for (let iter = 0; iter < 12; iter++) {
    let removed = false
    const lower = out.toLowerCase()
    for (const mk of markers) {
      const key = mk.toLowerCase()
      let pos = 0
      while (true) {
        const hit = lower.indexOf(key, pos)
        if (hit < 0) break
        // 向前找最近的左括号（lastIndexOf 会跳过当前对象内部的嵌套 { 抓父级）
        const brace = out.lastIndexOf('{', hit)
        if (brace < 0) { pos = hit + key.length; continue }
        // 上下文校验：marker 附近 80 字符内必须出现 route 特征，
        // 避免 marker 出现在共享常量/注释里误抓整个对象
        const nearby = out.slice(Math.max(0, hit - 30), Math.min(out.length, hit + 80))
        if (!/path\s*:|name\s*:|component\s*:|redirect\s*:|title\s*:/i.test(nearby)) {
          pos = hit + key.length; continue
        }
        const extracted = extractBalancedObject(out, brace)
        if (!extracted) { pos = hit + key.length; continue }
        const { block, end } = extracted
        if (!/path|name|component|redirect|title/i.test(block)) { pos = hit + key.length; continue }
        out = out.slice(0, brace) + out.slice(end)
        changed = true; removed = true; break
      }
      if (removed) break
    }
    if (!removed) break
  }
  return { text: out, changed }
}

function jsSyntaxOk(text: string): boolean {
  if (!text.trim()) return false
  if (/component:\s*\w+\s*,?\s*\n\s*\{/.test(text)) return false
  let depth = 0, inStr: string | null = null, escape = false
  for (const ch of text) {
    if (inStr) {
      if (escape) escape = false
      else if (ch === '\\') escape = true
      else if (ch === inStr) inStr = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue }
    if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth < 0) return false }
  }
  return depth === 0
}

/**
 * 在 sandbox 里修补菜单/路由文件。
 *
 * target 参数用途：当 sandbox 里还没有该接线文件时，从 target 复制一份过来。
 * rel 值来自硬编码 MENU_ROUTER_FILES，安全无遍历风险；writeFileSync 前再加 sandbox containment 双重校验。
 *
 * 返回被改动的相对路径列表。
 */
export function patchMenuRouterInSandbox(
  sandbox: string,
  target: string,
  features: string[],
): string[] {
  const patched: string[] = []
  const sandboxR = resolve(sandbox)
  for (const rel of [...MENU_ROUTER_FILES]) {
    if (relIsProtected(rel)) continue // 绝不允许整删菜单路由壳文件
    // sandbox containment 双重校验
    const sbPath = safePathUnderRoot(sandboxR, rel)
    if (!sbPath) continue
    const tgPath = join(resolve(target), rel)
    if (!existsSync(sbPath) && existsSync(tgPath)) {
      mkdirSync(dirname(sbPath), { recursive: true })
      copyFileSync(tgPath, sbPath)
    }
    if (!existsSync(sbPath)) continue
    let body = readFileSync(sbPath, 'utf8')
    let anyChange = false
    for (const feat of features) {
      const r1 = stripMenuLines(body, feat)
      body = r1.text; if (r1.changed) anyChange = true
      if (rel.endsWith('router/index.js')) {
        const r2 = stripRouterBlocks(body, feat)
        body = r2.text; if (r2.changed) anyChange = true
      }
    }
    if (anyChange && body !== readFileSync(sbPath, 'utf8')) {
      if (rel.endsWith('router/index.js') && !jsSyntaxOk(body)) {
        if (!body.trim() || !jsSyntaxOk(readFileSync(sbPath, 'utf8'))) {
          body = 'const routes = []\nexport default routes\n'
        } else { continue }
      }
      // cleanup
      body = body.replace(/\n\s*\{\s*\},?\s*(?=\n)/g, '\n')
      body = body.replace(/\n{3,}/g, '\n\n')
      writeFileSync(sbPath, body)
      patched.push(rel)
    }
  }
  return patched
}

function ensureFileInSandbox(sandbox: string, target: string, rel: string): boolean {
  const r = normRel(rel).replace(/^\//, '')
  if (relIsProtected(r) || isSensitiveRel(r)) return false
  const sb = join(sandbox, r)
  const tg = join(target, r)
  if (existsSync(sb)) return true
  if (!existsSync(tg)) return false
  mkdirSync(dirname(sb), { recursive: true })
  try { copyFileSync(tg, sb); return true } catch { return false }
}

// ========== 主入口 ==========

export type ReconcileResult = {
  /** 已经在 sandbox 里物理删除的相对路径（不含菜单路由壳） */
  forced_deletes: string[]
  /** sandbox 里被修补的菜单/路由文件（内容已改，待同步到 target） */
  patched: string[]
  detail: string
}

/**
 * 引擎强制执行删除 + 修补菜单路由。
 * 安全约束：
 *   - forced_deletes 仅涉及 sandbox 内的孤儿文件（不碰 target）
 *   - patched 仅涉及 sandbox 内的菜单/路由壳（走 applyJobReview 同步）
 *   - 所有路径过 relIsProtected + isSensitiveRel + safeFileUnderRoot
 */
export function reconcileDeleteArtifacts(
  opts: {
    sandbox: string
    target: string
    requirement: string
    assistant_text?: string
    explicit_planned?: string[]
    onStatus?: (msg: string) => void
  },
): ReconcileResult {
  if (!isDeleteIntent(opts.requirement)) return { forced_deletes: [], patched: [], detail: '' }

  const emit = (text: string) => opts.onStatus?.(text)
  const features = extractDeleteFeatures(opts.requirement)
  const sandbox = resolve(opts.sandbox)
  const target = resolve(opts.target)

  let planned: string[]
  if (opts.explicit_planned !== undefined) {
    planned = opts.explicit_planned.map(normRel)
  } else {
    planned = planDeleteFileTargets(opts.requirement, opts.target)
    const claimed = extractClaimedDeletedPaths(opts.assistant_text || '')
    for (const rel of claimed) {
      const r = normRel(rel)
      if (!r || planned.includes(r)) continue
      if (safeFileUnderRoot(target, r)) planned.push(r)
    }
  }

  const forced: string[] = []
  for (const rel of planned) {
    const r = normRel(rel).replace(/^\//, '')
    // 全部安全检查（target containment + sandbox containment 双重）
    if (r.includes('..')) continue
    if (relIsProtected(r) || isSensitiveRel(r)) continue
    const sbPath = safePathUnderRoot(sandbox, r)
    if (!sbPath) continue
    ensureFileInSandbox(sandbox, target, r)
    let removed = false
    if (existsSync(sbPath)) { try { rmSync(sbPath); removed = true } catch {} }
    if (removed) { forced.push(r); emit(`引擎已删除：${r}`) }
  }

  const patched = patchMenuRouterInSandbox(sandbox, target, features)
  if (patched.length) emit('引擎已修补菜单/路由：' + [...new Set(patched)].join('、'))

  const detail = forced.length || patched.length
    ? `引擎强制执行：删除 ${forced.length} 个文件${patched.length ? `；修补 ${[...new Set(patched)].length} 个接线文件` : ''}`
    : ''
  return { forced_deletes: forced, patched: [...new Set(patched)], detail }
}

// ========== 终稿生成 ==========

export function buildEngineDeleteDelivery(
  requirement: string,
  rec: ReconcileResult,
  opts?: { mode?: 'engine_first' | 'cursor_plan' | 'already_done' },
): string {
  const features = extractDeleteFeatures(requirement)
  const label = features.map(f => `「${f}」`).join('、') || '目标功能'
  const dels = [...new Set(rec.forced_deletes)]
  const pats = [...new Set(rec.patched)]
  const mode = opts?.mode || 'engine_first'
  const parts: string[] = []
  if (dels.some(r => r.includes('.vue') || r.includes('/views/'))) parts.push('页面')
  if (dels.some(r => r.includes('/api/'))) parts.push('API')
  if (dels.some(r => r.includes('/routers/'))) parts.push('后端路由')
  if (pats.some(r => r.includes('layouts/') || r.includes('/router/'))) parts.push('菜单与前端路由')
  const what = parts.length ? parts.join('、') : '相关入口'

  let intro = ''
  if (mode === 'cursor_plan') {
    intro = `已由 Cursor 只读定位清单、引擎在本机工程下线${label}：已处理${what}（改盘仅引擎执行，避免误删与 CRUD 误实现）。`
  } else if (mode === 'already_done') {
    intro = `本机代码已核对：${label}相关菜单、页面与路由已清除，目标状态已达成，本次无需再删文件。`
  } else {
    intro = `已由引擎在本机工程下线${label}：已处理${what}（未调用 Cursor，避免超时与误实现 CRUD）。`
  }

  const lines = [
    '## 说明方案', '', '**结论**', intro, '', '**改动文件**',
  ]
  const noteFor = (r: string, deleted: boolean): string => {
    if (deleted) {
      if (r.includes('.vue') || r.includes('/views/')) return '已删除（页面）'
      if (r.includes('/api/')) return '已删除（API 封装）'
      if (r.includes('/routers/')) return '已删除（后端路由）'
      return '已删除'
    }
    if (r.includes('/layouts/')) return '已移除相关菜单项'
    if (r.includes('/router/')) return '已移除相关路由项'
    return '已修补接线'
  }
  if (dels.length) for (const r of dels) lines.push(`- \`${r}\`：${noteFor(r, true)}`)
  if (pats.length) for (const r of pats) lines.push(`- \`${r}\`：${noteFor(r, false)}`)
  if (!dels.length && !pats.length) lines.push('- 无额外 diff：本机已无相关入口或此前已完成')
  lines.push('', '**行为约定**',
    `- 已下线：${label}相关菜单、路由、页面与 API`,
    '- 保留：同模块其余子功能',
    '- 未改动：其它业务模块', '',
    '**验收**',
    '1. 打开系统，在对应模块菜单中确认该项已消失',
    '2. 原先功能页地址不应再进入该功能',
    '3. 同模块其它功能仍可正常使用',
    `4. 本机代码已核对：${label}相关菜单、页面与路由已清除`,
  )
  return lines.join('\n') + '\n'
}
