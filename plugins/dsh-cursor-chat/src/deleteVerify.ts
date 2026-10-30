/**
 * 删除验尸 + 功能白名单元数据
 *
 * 从 Python mom 源码 delete_verify.py 移植。
 * 依赖 deleteIntent.ts（extractDeleteFeatures, isDeleteIntent, extractClaimedDeletedPaths）。
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import {
  extractDeleteFeatures,
  extractClaimedDeletedPaths,
  isDeleteIntent,
} from './deleteIntent.js'

/** 各功能的页面/API 孤立文件（删功能必须清掉这些） */
export const FEATURE_ORPHAN_FILES: Record<string, readonly string[]> = {
  '检验方案': [
    'frontend/src/views/quality-management/InspectionPlansView.vue',
    'frontend/src/api/qualityInspectionPlans.js',
  ],
  '检验任务': [
    'frontend/src/views/quality-management/InspectionTasksView.vue',
    'frontend/src/views/production/InspectionTasksView.vue',
    'frontend/src/api/qualityInspectionTasks.js',
  ],
  '检验记录': [
    'frontend/src/views/quality-management/InspectionRecordsView.vue',
    'frontend/src/views/production/InspectionRecordsView.vue',
  ],
  '品质概览': [
    'frontend/src/views/quality-management/Index.vue',
    'frontend/src/views/quality-management/QualityOverviewView.vue',
    'frontend/src/views/quality-management/Overview.vue',
  ],
  '生产排产': [
    'frontend/src/views/production/ProductionSchedulingView.vue',
    'frontend/src/api/productionScheduling.js',
    'frontend/src/api/scheduling.js',
  ],
  '请假管理': [
    'frontend/src/views/attendance/LeaveView.vue',
    'frontend/src/api/attendanceLeave.js',
    'frontend/src/api/leave.js',
  ],
  '仓储看板': ['frontend/src/views/board/WarehouseDashboard.vue'],
  '生产看板': [
    'frontend/src/views/board/ProductionDashboard.vue',
    'frontend/src/views/kanban/ProductionKanbanView.vue',
  ],
  '品质看板': [
    'frontend/src/views/board/QualityDashboard.vue',
    'frontend/src/views/kanban/QualityKanbanView.vue',
  ],
  '设备看板': [
    'frontend/src/views/board/DeviceDashboard.vue',
    'frontend/src/views/kanban/EquipmentKanbanView.vue',
  ],
  '综合看板': [
    'frontend/src/views/board/GeneralDashboard.vue',
    'frontend/src/views/kanban/ComprehensiveKanbanView.vue',
  ],
} as const

/** 各功能在路由/菜单里的标记字符串（用于识别残留） */
export const FEATURE_ROUTE_MARKERS: Record<string, readonly string[]> = {
  '检验方案': ['quality-management/inspection-plans', 'InspectionPlansView'],
  '检验任务': [
    'quality-management/inspection-tasks', 'quality-inspection-tasks',
    'InspectionTasksView', 'qualityInspectionTasks',
  ],
  '检验记录': [
    'quality-management/inspection-records', 'quality-inspection-records', 'InspectionRecordsView',
  ],
  '品质概览': ['QualityOverview', 'quality-overview', 'quality-management/index', 'QualityManagementIndex'],
  '生产排产': ['production/scheduling', 'production-scheduling', 'ProductionScheduling', 'ProductionSchedulingView'],
  '请假管理': ['attendance/leave', 'attendance-leave', 'AttendanceLeave', 'LeaveView'],
  '仓储看板': ['kanban/warehouse', 'WarehouseDashboard', 'warehouse-dashboard'],
  '生产看板': ['kanban/production', 'ProductionDashboard', 'ProductionKanban'],
  '品质看板': ['quality/dashboard', 'QualityDashboard', 'QualityKanban'],
  '设备看板': ['kanban/equipment', 'DeviceDashboard', 'EquipmentKanban'],
  '综合看板': ['kanban/general', 'GeneralDashboard', 'ComprehensiveKanban'],
} as const

const MENU_PROBE_FILES = [
  'frontend/src/layouts/AppLayout.vue',
  'frontend/src/router/index.js',
] as const

const RUNTIME_HINT =
  '【界面刷新】本机源码已写入；若本机 Vite 在跑，已自动软重启前端热更新服务。' +
  '请硬刷新浏览器（Cmd+Shift+R）即可看到菜单/路由变化。'
const BACKEND_HINT =
  '【后端重启】本次改了接口或路由挂载文件。请重启本机后端后再打开页面，' +
  '否则仍是旧进程，页面会弹出 Not Found（接口 404）。'

function readRel(root: string, rel: string, limit = 500_000): string | null {
  const p = join(root, rel.replace(/\\/g, '/').replace(/^\//, ''))
  if (!existsSync(p)) return null
  try { return readFileSync(p, 'utf8').slice(0, limit) } catch { return null }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function menuStillHasFeature(text: string, feature: string): boolean {
  if (!text || !feature) return false
  if (new RegExp(`title:\\s*['"]${escapeRegex(feature)}['"]`).test(text)) return true
  if (new RegExp(`meta:\\s*\\{[^}]*title:\\s*['"]${escapeRegex(feature)}['"]`).test(text)) return true
  if (text.includes(feature) && text.includes('children:')) {
    if (new RegExp(`['"][^'"]*${escapeRegex(feature)}[^'"]*['"]`).test(text)) return true
  }
  for (const marker of FEATURE_ROUTE_MARKERS[feature] || []) {
    if (text.toLowerCase().includes(marker.toLowerCase())) return true
  }
  return false
}

export type VerifyResult = {
  ok: boolean
  detail: string
  runtime_hint: string
  features: string[]
  inconclusive?: boolean
}

/**
 * 同步后在目标工程读盘验尸。
 * ok=false 表示磁盘上仍可检出待删菜单/路由/页面。
 */
export function verifyDeleteOnTarget(
  targetRoot: string,
  requirement: string,
  opts?: { synced_files?: string[]; deleted_files?: string[] },
): VerifyResult {
  if (!isDeleteIntent(requirement)) {
    return { ok: true, detail: '', runtime_hint: '', features: [] }
  }
  const root = resolve(targetRoot)
  const features = extractDeleteFeatures(requirement)
  if (!features.length) {
    return {
      ok: false,
      detail: '无法从诉求解析待删菜单/功能名，禁止判定已删除',
      runtime_hint: '', features: [], inconclusive: true,
    }
  }

  const errors: string[] = []
  let probesOk = 0
  for (const rel of MENU_PROBE_FILES) {
    const body = readRel(root, rel)
    if (!body) continue
    probesOk++
    for (const feat of features) {
      if (menuStillHasFeature(body, feat)) {
        errors.push(`${rel} 仍含「${feat}」菜单或路由`)
      }
    }
  }

  if (probesOk < 1) {
    return {
      ok: false,
      detail: '无法读取菜单/路由探针文件，禁止判定已删除',
      runtime_hint: '', features, inconclusive: true,
    }
  }

  for (const feat of features) {
    for (const rel of FEATURE_ORPHAN_FILES[feat] || []) {
      if (existsSync(join(root, rel.replace(/\\/g, '/')))) {
        errors.push(`页面/API 文件仍存在：${rel}`)
      }
    }
  }

  if (errors.length) {
    const uniq = [...new Set(errors)]
    return { ok: false, detail: uniq.slice(0, 10).join('；'), runtime_hint: '', features }
  }

  const label = features.map(f => `「${f}」`).join('、')
  return {
    ok: true,
    detail: `${label}相关菜单、页面与路由已清除`,
    runtime_hint: maybeRuntimeHint(opts?.synced_files, opts?.deleted_files),
    features,
  }
}

/** 前端运行时提示（删完后告诉用户要不要重启 Vite / 后端） */
export function maybeRuntimeHint(
  syncedFiles?: string[],
  deletedFiles?: string[],
): string {
  const feMarkers = ['frontend/src/layouts/', 'frontend/src/router/', 'frontend/src/views/']
  const beMarkers = ['backend/app/main.py', 'backend/main.py', 'backend/app/api/', 'backend/app/routers/']
  let fe = false, be = false
  for (const raw of [...(syncedFiles || []), ...(deletedFiles || [])]) {
    const rel = String(raw || '').replace(/删除 /g, '').replace(/\\/g, '/').trim()
    if (feMarkers.some(m => rel.startsWith(m))) fe = true
    if (beMarkers.some(m => rel.startsWith(m) || rel === m.replace(/\/$/, ''))) be = true
  }
  return (fe ? RUNTIME_HINT : '') + (be ? BACKEND_HINT : '')
}

export function runtimeHintAlways(): string {
  return RUNTIME_HINT
}

/** 删除类任务完成后：终稿声称删掉的文件仍在本机则判失败 */
export function validateDeleteCompletion(
  requirement: string,
  assistantText: string,
  deletedFiles: string[],
  opts?: { target_root?: string; forced_deletes?: string[] },
): string {
  if (!isDeleteIntent(requirement)) return ''
  const claimed = extractClaimedDeletedPaths(assistantText)
  const deletedNorm = new Set([
    ...(deletedFiles || []).map(p => String(p).replace(/删除 /g, '').replace(/\\/g, '/').trim().replace(/^\.\/?/, '')),
    ...(opts?.forced_deletes || []).map(p => String(p).replace(/\\/g, '/').trim().replace(/^\.\/?/, '')),
  ])
  const root = opts?.target_root ? resolve(opts.target_root) : null
  const orphans: string[] = []
  for (const rel of claimed) {
    if (deletedNorm.has(rel)) continue
    if (root && existsSync(join(root, rel))) orphans.push(rel)
  }
  if (orphans.length) {
    return `删除未完成：以下文件仍在本机工程中：${orphans.slice(0, 8).join('、')}。` +
      'Cursor 须在沙箱内物理删除这些文件（不可只在文案写「已删除」）；请核对需求后重新开工。'
  }
  if (claimed.length && !deletedNorm.size) {
    if (root && verifyDeleteOnTarget(root, requirement).ok) return ''
    return `沙箱未产生文件删除（0 个），但终稿声称已删 ${claimed.length} 个文件，` +
      '本机页面/API 不会被自动清理。请重新开工并确认 Cursor 执行了 rm/Delete。'
  }
  if (!deletedNorm.size && /页面|功能|模块|视图|组件|子项/.test(requirement)) {
    if (root && verifyDeleteOnTarget(root, requirement).ok) return ''
    return '删除类任务须在沙箱内物理删除页面/组件文件（当前 0 个删除）。' +
      '仅改菜单或路由不够，请重新开工。'
  }
  return ''
}
