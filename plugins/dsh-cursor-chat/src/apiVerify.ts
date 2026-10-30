/**
 * 新增后端路由模块后验尸：APIRouter 必须挂进 FastAPI main.py / api/__init__.py。
 *
 * 从 Python mom api_verify.py 移植。
 * 历史事故：只同步 backend/app/api/xxx.py 与页面，未改 main.py 的 include_router。
 * 页面能打开，axios 却弹出 FastAPI 原文 Not Found（接口 404）。禁止这种假成功。
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { isDeleteIntent } from './deleteIntent.js'

const SKIP_MODULE = new Set([
  '__init__', 'deps', 'errors', 'auth', 'common', 'utils', 'router', 'base',
])

const MOUNT_RELS = [
  'backend/app/main.py',
  'backend/main.py',
  'backend/app/api/__init__.py',
  'backend/app/api/router.py',
  'backend/app/router.py',
  'backend/app/api.py',
] as const

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
  } catch { return false }
}

function newRouterModules(target: string, synced: string[]): { rel: string; name: string }[] {
  const found: { rel: string; name: string }[] = []
  for (const rel of synced) {
    if (!rel.endsWith('.py')) continue
    if (!rel.startsWith('backend/app/api/') && !rel.startsWith('backend/app/routers/')) continue
    const name = rel.split('/').pop()!.replace(/\.py$/, '')
    if (!name || SKIP_MODULE.has(name) || name.startsWith('_')) continue
    const full = join(target, rel)
    if (!existsSync(full) || !looksLikeRouterFile(full)) continue
    found.push({ rel, name })
  }
  return found
}

function mountCorpus(target: string): string {
  const chunks: string[] = []
  for (const rel of MOUNT_RELS) {
    const path = join(target, rel)
    if (!existsSync(path)) continue
    try { chunks.push(readFileSync(path, 'utf8')) } catch { /* skip */ }
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
  const corpus = mountCorpus(target)
  const missing = modules.filter(m => !moduleMounted(corpus, m.name))
  if (!missing.length) return { ok: true, detail: '本机接口挂载验尸通过' }
  const sample = missing.slice(0, 6).map(m => m.rel).join('、')
  return {
    ok: false,
    detail: `${sample} 已同步但未挂进 FastAPI（main.py / api/__init__.py 无 include_router）。` +
      '页面会弹出英文 Not Found（接口 404），禁止报成功。' +
      '请把新 router 注册进挂载文件后重试，并重启本机后端。',
  }
}
