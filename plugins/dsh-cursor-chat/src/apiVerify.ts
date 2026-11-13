/**
 * 新增后端路由模块后验尸：APIRouter 必须挂进 FastAPI main.py / api/__init__.py。
 *
 * 挂载语料与后端根一律走项目画像，不写死顶层 backend/。
 */

import { existsSync, readFileSync } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'
import { isDeleteIntent } from './deleteIntent.js'
import {
  detectProjectLayout,
  resolveBackendMountRels,
} from './projectLayout.js'

const SKIP_MODULE = new Set([
  '__init__', 'deps', 'errors', 'auth', 'common', 'utils', 'router', 'base',
])

function normRel(raw: string): string {
  return String(raw || '').trim().replace(/\\/g, '/').replace(/^\.\/?/, '')
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

function looksLikeRouterFile(path: string): boolean {
  if (!existsSync(path)) return false
  try {
    const text = readFileSync(path, 'utf8')
    return text.includes('APIRouter') || text.includes('APIRoute')
  } catch {
    return false
  }
}

/** 路径段兜底：任意深度的 …/(backend|server)/app/(api|routers)/x.py */
function isRouterModuleRel(rel: string): boolean {
  return /(?:^|\/)(?:backend|server)\/app\/(?:api|routers)\/[^/]+\.py$/i.test(rel)
}

function underAbs(fileAbs: string, rootAbs: string): boolean {
  const f = resolve(fileAbs)
  const r = resolve(rootAbs)
  return f === r || f.startsWith(r + sep)
}

function relFromRoot(rootAbs: string, fileAbs: string): string {
  return relative(rootAbs, fileAbs).split(sep).join('/')
}

function newRouterModules(target: string, synced: string[]): { rel: string; name: string }[] {
  const layout = detectProjectLayout(target, synced)
  const found: { rel: string; name: string }[] = []
  for (const rel of synced) {
    if (!rel.endsWith('.py')) continue
    const name = basename(rel).replace(/\.py$/, '')
    if (!name || SKIP_MODULE.has(name) || name.startsWith('_')) continue
    const full = join(target, rel)
    if (!existsSync(full) || !looksLikeRouterFile(full)) continue

    let accepted = isRouterModuleRel(rel)
    if (!accepted && layout.backendRoots.length) {
      for (const br of layout.backendRoots) {
        if (!underAbs(full, br)) continue
        const sub = relFromRoot(br, full)
        if (/^app\/(?:api|routers)\/[^/]+\.py$/i.test(sub)) {
          accepted = true
          break
        }
      }
    }
    if (!accepted) continue
    found.push({ rel, name })
  }
  return found
}

function mountCorpus(target: string, synced: string[]): string {
  const mountRels = resolveBackendMountRels(target, synced)
  const chunks: string[] = []
  for (const rel of mountRels) {
    const path = join(target, rel)
    if (!existsSync(path)) continue
    try {
      chunks.push(readFileSync(path, 'utf8'))
    } catch {
      /* skip */
    }
  }
  // 本轮同步的挂载文件也并入语料（画像漏扫时）
  for (const rel of synced) {
    if (!/(?:^|\/)(?:main\.py|__init__\.py|router\.py|api\.py)$/i.test(rel)) continue
    if (mountRels.includes(rel)) continue
    const path = join(target, rel)
    if (!existsSync(path)) continue
    try {
      chunks.push(readFileSync(path, 'utf8'))
    } catch {
      /* skip */
    }
  }
  return chunks.join('\n')
}

function moduleMounted(corpus: string, name: string): boolean {
  if (!corpus || !name) return false
  if (corpus.includes(name)) return true
  const dashed = name.replace(/_/g, '-')
  if (dashed !== name && corpus.includes(dashed)) return true
  return false
}

export type ApiVerifyResult = { ok: boolean; detail: string }

/**
 * 同步后的本机工程：新 APIRouter 模块必须出现在挂载文件里。
 * 删除类任务跳过（阶段 1 已处理）。
 */
export function verifyApiMountedOnTarget(
  targetRoot: string,
  requirement: string,
  opts?: { synced_files?: string[] },
): ApiVerifyResult {
  if (isDeleteIntent(requirement)) return { ok: true, detail: '' }
  const target = resolve(targetRoot)
  const synced = syncedRels(opts?.synced_files)
  const modules = newRouterModules(target, synced)
  if (!modules.length) return { ok: true, detail: '' }
  const corpus = mountCorpus(target, synced)
  const missing = modules.filter((m) => !moduleMounted(corpus, m.name))
  if (!missing.length) return { ok: true, detail: '本机接口挂载验尸通过' }
  const sample = missing.slice(0, 6).map((m) => m.rel).join('、')
  return {
    ok: false,
    detail:
      `${sample} 已同步但未挂进 FastAPI（main.py / api/__init__.py 无 include_router）。` +
      '页面会弹出英文 Not Found（接口 404），禁止报成功。' +
      '请把新 router 注册进挂载文件后重试，并重启本机后端。',
  }
}
