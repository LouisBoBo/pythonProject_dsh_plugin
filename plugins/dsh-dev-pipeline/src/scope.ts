/** 变更范围：路径净化、库/二进制过滤、写码前后基线对齐。 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

import { gitStatus, git, isGitRepo } from './exec.js'
import type { ScopeBaseline } from './types.js'
import { insideWorkspace } from './workspace.js'

const DB_NAMES = new Set(['erp.db', 'data.db', 'app.db'])
const DB_SUFFIXES = ['.db', '.sqlite', '.sqlite3', '.db-journal', '.db-wal', '.db-shm']
const BLOCKED_SEGMENTS = new Set(['.venv', 'node_modules', '__pycache__', 'dist', '.git'])

/** 数据库/缓存/依赖目录都不属于源码交付面。 */
export function isDbOrBinaryPath(raw: string): boolean {
  const p = String(raw || '').replace(/\\/g, '/').toLowerCase().trim()
  if (!p) return true
  if (DB_SUFFIXES.some((x) => p.endsWith(x))) return true
  const name = p.split('/').pop() || ''
  if (DB_NAMES.has(name)) return true
  return p.split('/').some((seg) => BLOCKED_SEGMENTS.has(seg))
}

/**
 * 相对路径净化：拒绝绝对路径、`..`、NUL/换行、git pathspec magic（`:` 开头）
 * 和 `.git` 目录，防止插件回传的路径把 `git add` 带到工程外或扩大范围。
 */
export function sanitizeRelPath(workspace: string, raw: unknown): string {
  let p = String(raw || '').trim().replace(/\\/g, '/')
  if (!p || p.length > 400) return ''
  if (p.includes('\u0000') || /[\r\n]/.test(p)) return ''
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.startsWith('~')) return ''
  if (p.startsWith(':')) return ''
  while (p.startsWith('./')) p = p.slice(2)
  if (!p || p === '.' || p === '..') return ''
  const segments = p.split('/').filter(Boolean)
  if (!segments.length) return ''
  if (segments.some((s) => s === '.' || s === '..')) return ''
  if (segments.some((s) => s.toLowerCase() === '.git')) return ''
  const rel = segments.join('/')
  return insideWorkspace(workspace, rel) ? rel : ''
}

/** 净化 + 去重 + 过滤数据库/二进制路径。 */
export function filterScopePaths(workspace: string, paths: unknown): string[] {
  if (!Array.isArray(paths)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of paths) {
    if (typeof raw !== 'string') continue
    const rel = sanitizeRelPath(workspace, raw)
    if (!rel || isDbOrBinaryPath(rel) || seen.has(rel)) continue
    seen.add(rel)
    out.push(rel)
    if (out.length >= 500) break
  }
  return out
}

function hashPath(abs: string): string {
  try {
    const st = statSync(abs)
    if (!st.isFile()) return 'nonfile'
    if (st.size > 8 * 1024 * 1024) {
      return `big:${st.size}:${Math.floor(st.mtimeMs)}`
    }
    return createHash('sha1').update(readFileSync(abs)).digest('hex')
  } catch {
    return 'missing'
  }
}

/** git status 默认把整目录未跟踪收敛成 `dir/`；展开成文件才能做基线对齐。 */
async function expandStatusPaths(
  workspace: string,
  rel: string,
  code: string,
  signal?: AbortSignal,
): Promise<string[]> {
  if (code !== '??') return [rel]
  try {
    if (!statSync(resolve(workspace, rel)).isDirectory()) return [rel]
  } catch {
    return []
  }
  const out = await git(['ls-files', '--others', '--exclude-standard', '-z', '--', rel], workspace, {
    timeoutMs: 30_000,
    signal,
  })
  if (out.exit_code !== 0) return []
  return out.stdout.split('\u0000').filter(Boolean).slice(0, 500)
}

/** 记录写码前工作区脏文件及内容指纹；干净路径不入基线。 */
export async function snapshotScope(
  workspace: string,
  signal?: AbortSignal,
): Promise<ScopeBaseline> {
  const baseline: ScopeBaseline = {
    git: await isGitRepo(workspace),
    paths: {},
    created_at: new Date().toISOString(),
  }
  if (!baseline.git) return baseline
  for (const row of await gitStatus(workspace, signal)) {
    const baseRel = sanitizeRelPath(workspace, row.path)
    if (!baseRel) continue
    for (const rel of await expandStatusPaths(workspace, baseRel, row.code, signal)) {
      if (!sanitizeRelPath(workspace, rel)) continue
      baseline.paths[rel] = hashPath(resolve(workspace, rel))
    }
  }
  return baseline
}

export interface ScopeDelta {
  /** 本次写码真正落盘的变更（含原脏文件被继续修改）。 */
  changed: string[]
  deleted: string[]
  /** changed + deleted，已净化过滤。 */
  all: string[]
  /** 基线里已存在、内容未变的脏文件，不计入本次改动。 */
  untouched_baseline: string[]
}

/**
 * 当前工作区相对基线的增量。
 * 基线内且内容指纹未变的文件视为用户原有改动，不进入本次审码/提交范围。
 */
export async function deltaSinceBaseline(
  workspace: string,
  baseline: ScopeBaseline | undefined,
  signal?: AbortSignal,
): Promise<ScopeDelta> {
  const delta: ScopeDelta = {
    changed: [],
    deleted: [],
    all: [],
    untouched_baseline: [],
  }
  if (!baseline?.git) return delta
  const rows = await gitStatus(workspace, signal)
  for (const row of rows) {
    const baseRel = sanitizeRelPath(workspace, row.path)
    if (!baseRel) continue
    for (const rel of await expandStatusPaths(workspace, baseRel, row.code, signal)) {
      if (!sanitizeRelPath(workspace, rel) || isDbOrBinaryPath(rel)) continue
      const before = baseline.paths[rel]
      const now = hashPath(resolve(workspace, rel))
      if (before !== undefined && before === now) {
        delta.untouched_baseline.push(rel)
        continue
      }
      const exists = existsSync(resolve(workspace, rel))
      const deleted = row.code.includes('D') || !exists
      if (deleted) delta.deleted.push(rel)
      else delta.changed.push(rel)
    }
  }
  delta.all = [...new Set([...delta.changed, ...delta.deleted])]
  return delta
}
