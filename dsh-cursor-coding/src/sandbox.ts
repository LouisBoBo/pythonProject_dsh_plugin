/**
 * 沙箱：受限拷贝、快照 diff、同步回真工程（改编自 WorkBuddy sandbox/fs_snapshot）。
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { isSensitiveRel, normalizeRel, shouldSkipDirname } from './pathScope.js'

export const MAX_FILE_BYTES = 2 * 1024 * 1024
export const COPY_MAX_FILES = 4000
export const COPY_MAX_TOTAL_BYTES = 80 * 1024 * 1024
export const MAX_TOTAL_WRITE_BYTES = 40 * 1024 * 1024

/** 稀疏沙箱：只读上下文锚点（不扩大 write_scope / 同步权限） */
export const SPARSE_CONTEXT_ANCHORS = [
  'package.json',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'tsconfig.json',
  'tsconfig.base.json',
  'pyproject.toml',
  'requirements.txt',
  'Cargo.toml',
  'go.mod',
  'README.md',
  'README.zh-CN.md',
  'AGENTS.md',
] as const

/** 沿写范围父目录向上查找的锚点名 */
const SPARSE_PARENT_ANCHORS = [
  'package.json',
  'pyproject.toml',
  'tsconfig.json',
  'Cargo.toml',
  'go.mod',
  '__init__.py',
] as const

/** 每个写范围文件所在目录最多再拷多少同级文件 */
export const SPARSE_SIBLING_MAX_PER_DIR = 40
/** 相对写范围，额外只读上下文文件上限 */
export const SPARSE_CONTEXT_MAX_EXTRA = 120

export type PrepareResult = {
  sandbox: string
  copied_files: number
  mode: 'copy' | 'sparse' | 'reuse'
  total_bytes: number
  /** 稀疏模式：写范围内文件数 */
  scope_files?: number
  /** 稀疏模式：额外只读上下文文件数 */
  context_files?: number
  /** reuse：从父沙箱克隆的文件数 */
  parent_files?: number
  /** reuse：从真工程刷新的写范围/上下文文件数 */
  refreshed_files?: number
  /** reuse：父沙箱路径（审计） */
  reused_from?: string
}

function safeJobDirName(jobId: string): string {
  const safe = jobId.replace(/[^a-zA-Z0-9_-]/g, '')
  if (!safe || safe !== jobId) throw new Error('invalid job_id')
  return safe
}

export function sandboxRoot(dataRoot: string, jobId: string): string {
  const root = join(dataRoot, 'sandboxes', safeJobDirName(jobId))
  mkdirSync(root, { recursive: true })
  return resolve(root)
}

function walkFiles(root: string): string[] {
  const out: string[] = []
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()!
    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const ent of entries) {
      const name = String(ent.name)
      const full = join(dir, name)
      if (ent.isDirectory()) {
        if (shouldSkipDirname(name)) continue
        stack.push(full)
        continue
      }
      if (!ent.isFile()) continue
      const rel = relative(root, full).split(sep).join('/')
      if (!rel || isSensitiveRel(rel)) continue
      out.push(rel)
    }
  }
  return out
}

function copyOneFile(src: string, dest: string, totalBytes: number): { ok: boolean; total: number } {
  let st
  try {
    st = statSync(src)
  } catch {
    return { ok: false, total: totalBytes }
  }
  if (!st.isFile() || st.size > MAX_FILE_BYTES) return { ok: false, total: totalBytes }
  if (totalBytes + st.size > COPY_MAX_TOTAL_BYTES) {
    throw new Error('工程体积过大，无法完整拷入沙箱')
  }
  mkdirSync(dirname(dest), { recursive: true })
  try {
    copyFileSync(src, dest)
  } catch {
    return { ok: false, total: totalBytes }
  }
  return { ok: true, total: totalBytes + st.size }
}

function clearDir(root: string): void {
  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true })
    return
  }
  for (const name of readdirSync(root)) {
    rmSync(join(root, name), { recursive: true, force: true })
  }
}

export function prepareSandboxCopy(
  dataRoot: string,
  jobId: string,
  targetWorkspace: string,
  onProgress?: (msg: string) => void,
): PrepareResult {
  const target = resolve(targetWorkspace)
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    throw new Error('目标工程目录无效')
  }
  const root = sandboxRoot(dataRoot, jobId)
  clearDir(root)
  onProgress?.('正在将目标工程受限拷贝到沙箱…')
  let copied = 0
  let totalBytes = 0
  for (const rel of walkFiles(target)) {
    if (copied >= COPY_MAX_FILES) {
      throw new Error(`工程文件过多（>${COPY_MAX_FILES}），请缩小目录或配置 write_scope 稀疏拷贝`)
    }
    const r = copyOneFile(join(target, rel), join(root, rel), totalBytes)
    if (r.ok) {
      copied += 1
      totalBytes = r.total
    }
  }
  onProgress?.(`沙箱拷贝完成：${copied} 个文件`)
  return { sandbox: root, copied_files: copied, mode: 'copy', total_bytes: totalBytes }
}

/**
 * 在写范围 planned 之外，收集只读上下文（锚点 / 父链锚点 / 同级文件）。
 * 仅用于拷贝进沙箱，不改变同步权限。
 */
export function collectSparseContextRels(targetWorkspace: string, scopePlanned: Set<string>): Set<string> {
  const target = resolve(targetWorkspace)
  const extra = new Set<string>()
  const tryAdd = (rel: string) => {
    const n = normalizeRel(rel)
    if (!n || isSensitiveRel(n) || scopePlanned.has(n) || extra.has(n)) return
    if (extra.size >= SPARSE_CONTEXT_MAX_EXTRA) return
    if (!existsSync(join(target, n))) return
    try {
      if (!statSync(join(target, n)).isFile()) return
    } catch {
      return
    }
    extra.add(n)
  }

  for (const a of SPARSE_CONTEXT_ANCHORS) tryAdd(a)

  const siblingDirs = new Set<string>()
  for (const rel of scopePlanned) {
    const parent = dirname(rel)
    if (parent && parent !== '.') siblingDirs.add(parent)
    else siblingDirs.add('')

    let cur = parent
    while (cur && cur !== '.') {
      for (const name of SPARSE_PARENT_ANCHORS) {
        tryAdd([cur, name].join('/'))
      }
      const next = dirname(cur)
      if (next === cur) break
      cur = next
    }
    for (const name of SPARSE_PARENT_ANCHORS) tryAdd(name)
  }

  for (const dir of siblingDirs) {
    if (extra.size >= SPARSE_CONTEXT_MAX_EXTRA) break
    const absDir = dir ? join(target, dir) : target
    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSync(absDir, { withFileTypes: true })
    } catch {
      continue
    }
    let added = 0
    for (const ent of entries) {
      if (added >= SPARSE_SIBLING_MAX_PER_DIR) break
      if (extra.size >= SPARSE_CONTEXT_MAX_EXTRA) break
      if (!ent.isFile()) continue
      const name = String(ent.name)
      const rel = dir ? [dir, name].join('/') : name
      const before = extra.size
      tryAdd(rel)
      if (extra.size > before) added += 1
    }
  }

  return extra
}

export function prepareSandboxSparse(
  dataRoot: string,
  jobId: string,
  targetWorkspace: string,
  includeRels: string[],
  onProgress?: (msg: string) => void,
): PrepareResult {
  const target = resolve(targetWorkspace)
  const root = sandboxRoot(dataRoot, jobId)
  clearDir(root)
  onProgress?.(`按写范围稀疏拷贝沙箱（${includeRels.length} 条）…`)
  const planned = new Set<string>()
  for (const raw of includeRels) {
    const wantDir = String(raw).trim().endsWith('/')
    const rel = normalizeRel(raw)
    if (!rel || isSensitiveRel(rel)) continue
    if (wantDir) {
      const dirAbs = join(target, rel)
      if (!existsSync(dirAbs)) continue
      for (const f of walkFiles(dirAbs)) {
        planned.add([rel, f].join('/'))
      }
    } else if (existsSync(join(target, rel))) {
      planned.add(rel)
    }
  }
  const context = collectSparseContextRels(target, planned)
  const toCopy = new Set<string>([...planned, ...context])
  let copied = 0
  let totalBytes = 0
  for (const rel of toCopy) {
    const r = copyOneFile(join(target, rel), join(root, rel), totalBytes)
    if (r.ok) {
      copied += 1
      totalBytes = r.total
    }
  }
  const scopeFiles = [...planned].filter((rel) => existsSync(join(root, rel))).length
  const contextFiles = Math.max(0, copied - scopeFiles)
  onProgress?.(
    contextFiles > 0
      ? `稀疏沙箱就绪：${copied} 个文件（写范围 ${scopeFiles} + 只读上下文 ${contextFiles}）`
      : `稀疏沙箱就绪：${copied} 个文件`,
  )
  return {
    sandbox: root,
    copied_files: copied,
    mode: 'sparse',
    total_bytes: totalBytes,
    scope_files: scopeFiles,
    context_files: contextFiles,
  }
}

export function prepareSandbox(
  dataRoot: string,
  jobId: string,
  targetWorkspace: string,
  writeScope: string[],
  onProgress?: (msg: string) => void,
): PrepareResult {
  if (writeScope.length) {
    return prepareSandboxSparse(dataRoot, jobId, targetWorkspace, writeScope, onProgress)
  }
  return prepareSandboxCopy(dataRoot, jobId, targetWorkspace, onProgress)
}

/**
 * 父沙箱复用开关。默认开启；回退设 CURSOR_CODING_REUSE_PARENT=0。
 */
export function isReuseParentSandboxEnabled(): boolean {
  const raw = String(process.env.CURSOR_CODING_REUSE_PARENT || '').trim().toLowerCase()
  if (!raw) return true
  return !(raw === '0' || raw === 'false' || raw === 'off' || raw === 'no')
}

export function canReuseParentSandbox(parentSandbox: string | null | undefined): boolean {
  const p = String(parentSandbox || '').trim()
  if (!p) return false
  try {
    const abs = resolve(p)
    return existsSync(abs) && statSync(abs).isDirectory()
  } catch {
    return false
  }
}

function planScopeRels(target: string, includeRels: string[]): Set<string> {
  const planned = new Set<string>()
  for (const raw of includeRels) {
    const wantDir = String(raw).trim().endsWith('/')
    const rel = normalizeRel(raw)
    if (!rel || isSensitiveRel(rel)) continue
    if (wantDir) {
      const dirAbs = join(target, rel)
      if (!existsSync(dirAbs)) continue
      for (const f of walkFiles(dirAbs)) {
        planned.add([rel, f].join('/'))
      }
    } else if (existsSync(join(target, rel))) {
      planned.add(rel)
    }
  }
  return planned
}

/**
 * 复用父 Job 沙箱：克隆父目录 → 用真工程写范围(+只读上下文)增量覆盖。
 * 同步权限仍只认 write_scope；失败应由调用方回退 prepareSandbox。
 */
export function prepareSandboxReuse(
  dataRoot: string,
  jobId: string,
  targetWorkspace: string,
  writeScope: string[],
  parentSandbox: string,
  onProgress?: (msg: string) => void,
): PrepareResult {
  const parent = resolve(parentSandbox)
  if (!canReuseParentSandbox(parent)) {
    throw new Error('父沙箱不可用')
  }
  const target = resolve(targetWorkspace)
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    throw new Error('目标工程目录无效')
  }
  const root = sandboxRoot(dataRoot, jobId)
  if (resolve(root) === parent) {
    throw new Error('禁止与父沙箱同路径复用')
  }
  clearDir(root)
  onProgress?.('复用父沙箱：克隆上下文…')

  let totalBytes = 0
  let parentFiles = 0
  for (const rel of walkFiles(parent)) {
    if (parentFiles >= COPY_MAX_FILES) {
      throw new Error(`父沙箱文件过多（>${COPY_MAX_FILES}），放弃复用`)
    }
    const r = copyOneFile(join(parent, rel), join(root, rel), totalBytes)
    if (r.ok) {
      parentFiles += 1
      totalBytes = r.total
    }
  }

  onProgress?.('复用父沙箱：按写范围从真工程刷新…')
  const planned = writeScope.length
    ? planScopeRels(target, writeScope)
    : new Set<string>() // 空 scope：仅克隆父沙箱，不强制全量刷新
  const context = writeScope.length ? collectSparseContextRels(target, planned) : new Set<string>()
  let refreshed = 0
  for (const rel of new Set<string>([...planned, ...context])) {
    const src = join(target, rel)
    if (!existsSync(src) || !statSync(src).isFile()) continue
    // 覆盖拷贝：忽略当前 total 上限检查中「已有体积」——用 copyOneFile 需重置策略
    try {
      const st = statSync(src)
      if (st.size > MAX_FILE_BYTES) continue
      mkdirSync(dirname(join(root, rel)), { recursive: true })
      copyFileSync(src, join(root, rel))
      refreshed += 1
    } catch {
      /* skip one */
    }
  }

  // 空 writeScope 时从真工程补一层受限全量可能过重；保持父克隆即可。
  // 有 writeScope 但父很瘦时，刷新已含加厚上下文。

  const all = walkFiles(root).length
  const scopeFiles = [...planned].filter((rel) => existsSync(join(root, rel))).length
  onProgress?.(
    `父沙箱复用就绪：${all} 个文件（父克隆 ${parentFiles} · 真工程刷新 ${refreshed}）`,
  )
  return {
    sandbox: root,
    copied_files: all,
    mode: 'reuse',
    total_bytes: totalBytes,
    scope_files: scopeFiles,
    context_files: Math.max(0, refreshed - scopeFiles),
    parent_files: parentFiles,
    refreshed_files: refreshed,
    reused_from: parent,
  }
}

/**
 * 续改优先复用父沙箱；开关关闭 / 父不可用 / 复用抛错 → 回退新建。
 */
export function prepareSandboxForJob(opts: {
  dataRoot: string
  jobId: string
  targetWorkspace: string
  writeScope: string[]
  parentSandbox?: string | null
  onProgress?: (msg: string) => void
}): PrepareResult {
  const { dataRoot, jobId, targetWorkspace, writeScope, parentSandbox, onProgress } = opts
  if (isReuseParentSandboxEnabled() && canReuseParentSandbox(parentSandbox)) {
    try {
      return prepareSandboxReuse(
        dataRoot,
        jobId,
        targetWorkspace,
        writeScope,
        parentSandbox!,
        onProgress,
      )
    } catch (err) {
      onProgress?.(`父沙箱复用失败，回退新建：${String(err)}`)
    }
  }
  return prepareSandbox(dataRoot, jobId, targetWorkspace, writeScope, onProgress)
}

function fingerprintFile(path: string): string {
  try {
    const st = statSync(path)
    if (st.size <= 256_000) {
      const h = createHash('sha256')
      h.update(readFileSync(path))
      return `h:${h.digest('hex')}`
    }
    return `m:${st.size}:${Math.trunc(st.mtimeMs)}`
  } catch {
    return ''
  }
}

export function snapshotSandbox(sandbox: string): Map<string, string> {
  const root = resolve(sandbox)
  const map = new Map<string, string>()
  if (!existsSync(root)) return map
  for (const rel of walkFiles(root)) {
    map.set(rel, fingerprintFile(join(root, rel)))
  }
  return map
}

export function diffSnapshots(
  before: Map<string, string>,
  after: Map<string, string>,
): { changed: string[]; deleted: string[] } {
  const changed: string[] = []
  const deleted: string[] = []
  for (const [rel, fp] of after) {
    if (before.get(rel) !== fp) changed.push(rel)
  }
  for (const rel of before.keys()) {
    if (!after.has(rel)) deleted.push(rel)
  }
  return { changed, deleted }
}

function assertInside(root: string, candidate: string): void {
  const r = resolve(root)
  const c = resolve(candidate)
  if (c !== r && !c.startsWith(r + sep)) {
    throw new Error(`路径逃逸：${candidate}`)
  }
}

export function syncChangedToTarget(
  sandbox: string,
  target: string,
  changedRels: string[],
): string[] {
  const sb = resolve(sandbox)
  const tg = resolve(target)
  if (!existsSync(tg) || !statSync(tg).isDirectory()) {
    throw new Error('目标目录无效')
  }
  const planned: { rel: string; src: string; dest: string }[] = []
  let totalBytes = 0
  for (const raw of changedRels) {
    const rel = normalizeRel(raw)
    if (!rel || isSensitiveRel(rel)) continue
    const src = join(sb, rel)
    assertInside(sb, src)
    if (!existsSync(src) || !statSync(src).isFile()) {
      throw new Error(`沙箱中缺少待同步文件：${rel}`)
    }
    const st = statSync(src)
    if (st.size > MAX_FILE_BYTES) throw new Error(`文件过大，拒绝同步：${rel}`)
    if (totalBytes + st.size > MAX_TOTAL_WRITE_BYTES) {
      throw new Error(`本任务同步字节超限（>${MAX_TOTAL_WRITE_BYTES}）`)
    }
    const dest = join(tg, rel)
    assertInside(tg, dest)
    planned.push({ rel, src, dest })
    totalBytes += st.size
  }
  if (!planned.length) throw new Error('没有可同步的有效文件')
  const written: string[] = []
  for (const item of planned) {
    mkdirSync(dirname(item.dest), { recursive: true })
    const tmp = item.dest + '.cc-sync-tmp'
    try {
      if (existsSync(tmp)) unlinkSync(tmp)
      copyFileSync(item.src, tmp)
      renameSync(tmp, item.dest)
      written.push(item.rel)
    } catch (err) {
      try {
        if (existsSync(tmp)) unlinkSync(tmp)
      } catch {
        /* ignore */
      }
      throw new Error(`同步写入失败：${item.rel}（${String(err)}）`)
    }
  }
  return written
}

export function applyDeletesToTarget(target: string, deletedRels: string[]): string[] {
  const tg = resolve(target)
  const removed: string[] = []
  for (const raw of deletedRels) {
    const rel = normalizeRel(raw)
    if (!rel || isSensitiveRel(rel)) continue
    const dest = join(tg, rel)
    assertInside(tg, dest)
    if (!existsSync(dest)) continue
    try {
      unlinkSync(dest)
      removed.push(rel)
    } catch {
      /* skip */
    }
  }
  return removed
}
