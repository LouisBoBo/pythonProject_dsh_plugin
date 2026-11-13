/**
 * 删除类任务预检：本机已达成目标时跳过 Cursor，避免 10+ 分钟空读盘。
 *
 * 从 Python mom 源码 delete_preflight.py 移植。
 * 依赖 deleteIntent + deleteVerify。
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { extractDeleteFeatures, isDeleteIntent } from './deleteIntent.js'
import { FEATURE_ORPHAN_FILES } from './deleteVerify.js'
import {
  resolveBackendConventionRels,
  resolveFrontendConventionRels,
  resolveMenuProbeRels,
} from './projectLayout.js'

const DEFAULT_PROBE_CONVENTIONS = [
  'frontend/src/api/quality.js',
  'frontend/src/api/qualityInspectionPlans.js',
  'backend/app/routers/quality.py',
  'backend/app/permissions.py',
] as const

const OVERVIEW_VIEW_CANDIDATES = [
  'frontend/src/views/quality-management/Index.vue',
  'frontend/src/views/quality-management/QualityOverviewView.vue',
  'frontend/src/views/quality-management/Overview.vue',
] as const

function readRel(root: string, rel: string, limit = 400_000): string | null {
  const p = join(root, rel.replace(/\\/g, '/').replace(/^\//, ''))
  if (!existsSync(p)) return null
  try { return readFileSync(p, 'utf8').slice(0, limit) } catch { return null }
}

function probePaths(workspace: string, requirement: string): string[] {
  const paths: string[] = []
  const seen = new Set<string>()
  const add = (rel: string) => {
    const r = String(rel || '').replace(/\\/g, '/').trim().replace(/^\//, '')
    if (!r || seen.has(r)) return
    seen.add(r)
    paths.push(r)
  }
  for (const p of resolveMenuProbeRels(workspace)) add(p)
  const feConventions = DEFAULT_PROBE_CONVENTIONS.filter((p) => /^(frontend|web)\//i.test(p))
  const beConventions = DEFAULT_PROBE_CONVENTIONS.filter((p) => /^(backend|server)\//i.test(p))
  for (const p of resolveFrontendConventionRels(workspace, [...feConventions])) add(p)
  for (const p of resolveBackendConventionRels(workspace, [...beConventions])) add(p)
  for (const p of resolveFrontendConventionRels(workspace, [...OVERVIEW_VIEW_CANDIDATES])) add(p)
  for (const feat of extractDeleteFeatures(requirement)) {
    for (const p of resolveFrontendConventionRels(workspace, [...(FEATURE_ORPHAN_FILES[feat] || [])])) {
      add(p)
    }
  }
  return paths.slice(0, 40)
}

export type PreflightResult = {
  skip_cursor: boolean
  delivery: string
  checks: { kind: string; path: string; detail: string }[]
  feature: string
  reason?: string
}

/**
 * 扫描本机工程是否仍含待删功能痕迹。
 * skip_cursor=True 表示无需再跑 Cursor（通常 <2s）。
 */
export function auditDeleteTarget(
  targetRoot: string,
  requirement: string,
): PreflightResult {
  const root = resolve(targetRoot)
  if (!isDeleteIntent(requirement)) {
    return { skip_cursor: false, delivery: '', checks: [], feature: '' }
  }
  const features = extractDeleteFeatures(requirement)
  const feature = features[0] || ''
  if (!feature) {
    return { skip_cursor: false, delivery: '', checks: [], feature: '', reason: 'feature_unresolved' }
  }

  // 未知功能没有专属探针文件：默认探针全是质量模块文件，读它们“没命中”不能证明目标已删除
  const unknown = features.filter((f) => (FEATURE_ORPHAN_FILES[f] || []).length === 0)
  if (unknown.length) {
    return {
      skip_cursor: false,
      delivery: '',
      checks: [],
      feature,
      reason: `feature_unknown:${unknown.join('、')}`,
    }
  }

  const checks: { kind: string; path: string; detail: string }[] = []
  let probesRead = 0

  for (const feat of features) {
    for (const rel of resolveFrontendConventionRels(root, [...(FEATURE_ORPHAN_FILES[feat] || [])])) {
      checks.push({ kind: 'orphan_file', path: rel, detail: `「${feat}」页面/API 仍存在` })
    }
    if (feat === '品质概览' || feat.includes('概览')) {
      for (const rel of resolveFrontendConventionRels(root, [...OVERVIEW_VIEW_CANDIDATES])) {
        checks.push({ kind: 'orphan_file', path: rel, detail: '页面/占位文件仍存在' })
      }
    }
  }

  for (const rel of probePaths(root, requirement)) {
    const text = readRel(root, rel)
    if (text === null) continue
    probesRead++
    for (const feat of features) {
      if (feat && text.includes(feat)) {
        checks.push({ kind: 'text_hit', path: rel, detail: `仍含「${feat}」` })
      }
    }
    if (feature.includes('概览')) {
      if (text.includes('fetchQualityOverview')) {
        checks.push({ kind: 'api_fn', path: rel, detail: '仍含 fetchQualityOverview' })
      }
      if (/\/api\/quality\/overview|quality\/overview/i.test(text)) {
        checks.push({ kind: 'api_route', path: rel, detail: '仍含 overview 接口' })
      }
      if (/QualityManagementIndex|quality-management['"]?\s*,\s*component/.test(text)) {
        checks.push({ kind: 'route', path: rel, detail: '仍含概览路由组件' })
      }
    }
  }

  // 菜单/路由探针一个都读不到 → 无法证明已删干净（画像后至少应能读到 1 个）
  if (probesRead < 1) {
    return { skip_cursor: false, delivery: '', checks: [], feature, reason: 'probe_insufficient' }
  }

  // 去重
  const seenK = new Set<string>()
  const uniq = checks.filter(c => {
    const key = `${c.path}|${c.kind}`
    if (seenK.has(key)) return false
    seenK.add(key); return true
  })

  if (uniq.length) {
    return { skip_cursor: false, delivery: '', checks: uniq, feature }
  }

  const label = feature || '目标功能'
  const delivery = [
    '## 说明方案', '',
    '**结论**',
    `经引擎预检本机工程，${label}相关菜单、路由、页面与 API 引用均已不存在，目标状态已达成，本次无需再调用 Cursor 改码。`, '',
    '**改动文件**',
    '- 无：预检通过，未产生代码 diff', '',
    '**行为约定**',
    `- 已删除（此前已完成）：「${label}」相关菜单入口、路由与页面`,
    '- 保留：同模块其余子功能与其 API 未改动',
    '- 未改动：其它业务模块', '',
    '**验收**',
    '1. 打开系统，在对应模块菜单中确认该项已消失',
    '2. 原先功能页地址不应再进入该功能',
    '3. 同模块其它功能仍可正常使用',
    `4. 本机代码已核对：「${label}」相关菜单、页面与路由已清除`,
  ].join('\n')

  return { skip_cursor: true, delivery, checks: [], feature }
}

/** Cursor 终稿表明「已达成 / 无需再改」 */
export function deliveryIndicatesAlreadyDone(assistantText: string): boolean {
  const t = String(assistantText || '').trim()
  if (!t) return false
  if (!t.includes('说明方案') && !t.includes('结论') && !t.includes('一句话结论')) return false
  const markers = [
    '目标状态已达成', '此前已完成', '未产生代码 diff', '未产生任何文件变更',
    '无需再', '无需额外', '本次未产生', '无：目标', '已无', '不存在', '未改动',
  ]
  return markers.some(m => t.includes(m))
}
