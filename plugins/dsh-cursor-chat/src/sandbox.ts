/**
 * 沙箱：受限拷贝、快照 diff、同步回真工程（改编自 WorkBuddy sandbox/fs_snapshot）。
 *
 * 拷贝必须异步：Desktop/iCloud 等慢盘上 copyFileSync 会堵死事件循环，
 * HTTP/SSE 与宿主工具全部假死（表现为聊天「深度搜索中」数分钟无输出）。
 */
import {
  closeSync,
  constants as fsConstants,
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, relative, resolve, sep } from 'node:path'
import {
  isLocalDbRel,
  isSensitiveRel,
  normalizeRel,
  pathInScope,
  shouldSkipDirname,
} from './pathScope.js'

export const MAX_FILE_BYTES = 2 * 1024 * 1024
export const COPY_MAX_FILES = 4000
export const COPY_MAX_TOTAL_BYTES = 80 * 1024 * 1024
export const MAX_TOTAL_WRITE_BYTES = 40 * 1024 * 1024
/** 单文件拷贝超时（毫秒）；超时跳过该文件，避免整 job 卡死 */
export const COPY_FILE_TIMEOUT_MS = 8_000

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
  /** 拷贝超时/失败而未进入沙箱的文件（相对路径） */
  skipped_files?: string[]
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

function yieldEventLoop(): Promise<void> {
  return new Promise((r) => setImmediate(r))
}

/**
 * 流式拷贝 + 超时销毁流：不阻塞主线程；慢盘/云盘文件超时后跳过。
 * 导出供自测：可用 FIFO 验证超时不会堵死事件循环。
 */
export function copyFileStreaming(src: string, dest: string, timeoutMs: number): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const rs = createReadStream(src)
    const ws = createWriteStream(dest)
    let settled = false
    const fail = (err: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        rs.destroy()
      } catch {
        /* ignore */
      }
      try {
        ws.destroy()
      } catch {
        /* ignore */
      }
      // FIFO：destroy 后读端仍可能挂住 UV handle，非阻塞打开写端唤醒
      try {
        const fd = openSync(src, fsConstants.O_WRONLY | fsConstants.O_NONBLOCK)
        closeSync(fd)
      } catch {
        /* ignore — 普通文件无此必要 */
      }
      try {
        if (existsSync(dest)) unlinkSync(dest)
      } catch {
        /* ignore */
      }
      reject(err)
    }
    const timer = setTimeout(() => fail(new Error(`copy timeout ${timeoutMs}ms`)), timeoutMs)
    rs.on('error', (e) => fail(e instanceof Error ? e : new Error(String(e))))
    ws.on('error', (e) => fail(e instanceof Error ? e : new Error(String(e))))
    ws.on('finish', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise()
    })
    rs.pipe(ws)
  })
}

async function copyOneFileAsync(
  src: string,
  dest: string,
  totalBytes: number,
): Promise<{ ok: boolean; total: number; skipped?: string }> {
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
    await copyFileStreaming(src, dest, COPY_FILE_TIMEOUT_MS)
  } catch (err) {
    try {
      if (existsSync(dest)) unlinkSync(dest)
    } catch {
      /* ignore */
    }
    return { ok: false, total: totalBytes, skipped: String(err).slice(0, 120) }
  }
  await yieldEventLoop()
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

export async function prepareSandboxCopy(
  dataRoot: string,
  jobId: string,
  targetWorkspace: string,
  onProgress?: (msg: string) => void,
): Promise<PrepareResult> {
  const target = resolve(targetWorkspace)
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    throw new Error('目标工程目录无效')
  }
  const root = sandboxRoot(dataRoot, jobId)
  clearDir(root)
  onProgress?.('正在将目标工程受限拷贝到沙箱…')
  let copied = 0
  let skipped = 0
  const skippedFiles: string[] = []
  let totalBytes = 0
  const rels = walkFiles(target)
  for (let i = 0; i < rels.length; i++) {
    const rel = rels[i]!
    if (copied >= COPY_MAX_FILES) {
      throw new Error(`工程文件过多（>${COPY_MAX_FILES}），请缩小目录或配置 write_scope 稀疏拷贝`)
    }
    const r = await copyOneFileAsync(join(target, rel), join(root, rel), totalBytes)
    if (r.ok) {
      copied += 1
      totalBytes = r.total
    } else if (r.skipped) {
      skipped += 1
      skippedFiles.push(rel)
    }
    if (i > 0 && i % 20 === 0) {
      onProgress?.(`沙箱拷贝中… ${copied}/${rels.length} 文件` + (skipped ? `（跳过 ${skipped}）` : ''))
    }
  }
  onProgress?.(
    skipped
      ? `沙箱拷贝完成：${copied} 个文件（跳过超时/失败 ${skipped}）`
      : `沙箱拷贝完成：${copied} 个文件`,
  )
  return {
    sandbox: root,
    copied_files: copied,
    mode: 'copy',
    total_bytes: totalBytes,
    skipped_files: skippedFiles,
  }
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

export async function prepareSandboxSparse(
  dataRoot: string,
  jobId: string,
  targetWorkspace: string,
  includeRels: string[],
  onProgress?: (msg: string) => void,
): Promise<PrepareResult> {
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
  const toCopy = [...new Set<string>([...planned, ...context])]
  let copied = 0
  let skipped = 0
  const skippedFiles: string[] = []
  let totalBytes = 0
  for (let i = 0; i < toCopy.length; i++) {
    const rel = toCopy[i]!
    const r = await copyOneFileAsync(join(target, rel), join(root, rel), totalBytes)
    if (r.ok) {
      copied += 1
      totalBytes = r.total
    } else if (r.skipped) {
      skipped += 1
      skippedFiles.push(rel)
    }
    if (i > 0 && i % 10 === 0) {
      onProgress?.(
        `稀疏拷贝中… ${i + 1}/${toCopy.length}` + (skipped ? `（跳过超时 ${skipped}）` : ''),
      )
    }
  }
  const scopeFiles = [...planned].filter((rel) => existsSync(join(root, rel))).length
  const contextFiles = Math.max(0, copied - scopeFiles)
  const skipNote = skipped ? `；跳过超时/失败 ${skipped}` : ''
  onProgress?.(
    contextFiles > 0
      ? `稀疏沙箱就绪：${copied} 个文件（写范围 ${scopeFiles} + 只读上下文 ${contextFiles}${skipNote}）`
      : `稀疏沙箱就绪：${copied} 个文件${skipNote}`,
  )
  return {
    sandbox: root,
    copied_files: copied,
    mode: 'sparse',
    total_bytes: totalBytes,
    scope_files: scopeFiles,
    context_files: contextFiles,
    skipped_files: skippedFiles,
  }
}

export async function prepareSandbox(
  dataRoot: string,
  jobId: string,
  targetWorkspace: string,
  writeScope: string[],
  onProgress?: (msg: string) => void,
): Promise<PrepareResult> {
  if (writeScope.length) {
    return prepareSandboxSparse(dataRoot, jobId, targetWorkspace, writeScope, onProgress)
  }
  return prepareSandboxCopy(dataRoot, jobId, targetWorkspace, onProgress)
}

/**
 * 父沙箱复用开关。默认开启；回退设 CURSOR_CHAT_REUSE_PARENT=0。
 */
export function isReuseParentSandboxEnabled(): boolean {
  const raw = String(process.env.CURSOR_CHAT_REUSE_PARENT || '').trim().toLowerCase()
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
export async function prepareSandboxReuse(
  dataRoot: string,
  jobId: string,
  targetWorkspace: string,
  writeScope: string[],
  parentSandbox: string,
  onProgress?: (msg: string) => void,
): Promise<PrepareResult> {
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
    const r = await copyOneFileAsync(join(parent, rel), join(root, rel), totalBytes)
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
  let refreshBytes = 0
  for (const rel of new Set<string>([...planned, ...context])) {
    const src = join(target, rel)
    if (!existsSync(src) || !statSync(src).isFile()) continue
    try {
      const st = statSync(src)
      if (st.size > MAX_FILE_BYTES) continue
      const dest = join(root, rel)
      // 先写临时文件再改名：刷新超时不能把父沙箱已克隆的同名文件删掉
      const tmp = join(root, '.cc-tmp', rel + '.refresh')
      mkdirSync(dirname(dest), { recursive: true })
      mkdirSync(dirname(tmp), { recursive: true })
      const r = await copyOneFileAsync(src, tmp, refreshBytes)
      if (r.ok) {
        renameSync(tmp, dest)
        refreshBytes = r.total
        refreshed += 1
      }
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
export async function prepareSandboxForJob(opts: {
  dataRoot: string
  jobId: string
  targetWorkspace: string
  writeScope: string[]
  parentSandbox?: string | null
  onProgress?: (msg: string) => void
}): Promise<PrepareResult> {
  const { dataRoot, jobId, targetWorkspace, writeScope, parentSandbox, onProgress } = opts
  if (isReuseParentSandboxEnabled() && canReuseParentSandbox(parentSandbox)) {
    try {
      return await prepareSandboxReuse(
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

/**
 * 同步后验尸：清单内文件须在目标存在，且与沙箱指纹一致。
 * 跳过敏感路径与本地库（故意不同步）。
 */
export function verifySyncedFingerprints(
  sandbox: string,
  target: string,
  rels: string[],
): { ok: boolean; missing: string[]; mismatched: string[]; detail: string } {
  const sb = resolve(String(sandbox || ''))
  const tg = resolve(String(target || ''))
  const missing: string[] = []
  const mismatched: string[] = []
  if (!sb || !tg || !existsSync(sb) || !existsSync(tg)) {
    return {
      ok: false,
      missing: [],
      mismatched: [],
      detail: '交付审计失败：沙箱或目标工程路径无效',
    }
  }
  for (const raw of rels || []) {
    const r = normalizeRel(raw)
    if (!r || isSensitiveRel(r) || isLocalDbRel(r)) continue
    const src = join(sb, r)
    const dst = join(tg, r)
    let srcFp = ''
    try {
      if (existsSync(src) && statSync(src).isFile()) srcFp = fingerprintFile(src)
    } catch {
      srcFp = ''
    }
    if (!srcFp) continue
    let dstFp = ''
    try {
      if (existsSync(dst) && statSync(dst).isFile()) dstFp = fingerprintFile(dst)
    } catch {
      dstFp = ''
    }
    if (!dstFp) {
      missing.push(r)
      continue
    }
    if (dstFp !== srcFp) mismatched.push(r)
  }
  if (!missing.length && !mismatched.length) {
    return { ok: true, missing, mismatched, detail: '落盘指纹与沙箱一致' }
  }
  const parts: string[] = []
  if (missing.length) parts.push(`目标缺失：${missing.slice(0, 6).join('、')}`)
  if (mismatched.length) parts.push(`内容不一致：${mismatched.slice(0, 6).join('、')}`)
  return {
    ok: false,
    missing,
    mismatched,
    detail: `同步落盘验尸失败（${parts.join('；')}）`,
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

/** 按写范围给真工程做指纹快照（目录会展开）。 */
export function snapshotScope(root: string, scope: string[]): Map<string, string> {
  const map = new Map<string, string>()
  const r = resolve(root)
  if (!existsSync(r)) return map
  for (const raw of scope || []) {
    const rel0 = normalizeRel(raw).replace(/\/$/, '')
    if (!rel0) continue
    const p = join(r, rel0)
    if (!existsSync(p)) continue
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isFile()) {
      map.set(rel0, fingerprintFile(p))
      continue
    }
    if (!st.isDirectory()) continue
    for (const child of walkFiles(p)) {
      const rel = normalizeRel(rel0 + '/' + child)
      map.set(rel, fingerprintFile(join(p, child)))
    }
  }
  return map
}

/**
 * 进程崩溃后无法拿到开工前快照时：用沙箱现存文件推断 before。
 * 只认「沙箱里现在有的文件」：被删掉的文件没有可信证据。
 *
 * 不能按「同目录真工程有、沙箱里没有」推断删除：拷贝阶段会跳过超时或超大文件，
 * 这些文件从未进过沙箱，崩溃收口时会被误判为删除并自动 unlink 真实工程文件。
 * allowInferredDeletes 仅保留给单测/显式调用，正常收口一律传 false。
 */
export function inferSparseBeforeAfter(
  workspace: string,
  sandbox: string,
  writeScope: string[],
  allowInferredDeletes = true,
): { before: Map<string, string>; after: Map<string, string> } {
  const after = snapshotSandbox(sandbox)
  const before = new Map<string, string>()
  const ws = resolve(workspace)
  for (const [rel] of after) {
    const p = join(ws, rel)
    try {
      if (existsSync(p) && statSync(p).isFile()) before.set(rel, fingerprintFile(p))
      else before.set(rel, '__absent__')
    } catch {
      before.set(rel, '__absent__')
    }
  }
  if (!allowInferredDeletes) return { before, after }
  const sandboxParents = new Set<string>()
  for (const rel of after.keys()) {
    const d = dirname(rel).replace(/\\/g, '/')
    if (d && d !== '.') sandboxParents.add(d)
  }
  const scoped = snapshotScope(ws, writeScope)
  for (const [rel, fp] of scoped) {
    if (after.has(rel)) continue
    const d = dirname(rel).replace(/\\/g, '/')
    if (sandboxParents.has(d)) before.set(rel, fp)
  }
  return { before, after }
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

/**
 * 沙箱相对目标工程的内容漂移（写范围内）。
 * 用于「相对开工快照无 diff」时仍可能沙箱≠目标（父沙箱复用/拷贝不全）——补同步，杜绝空跑。
 */
export function listSandboxTargetDrift(
  sandbox: string,
  target: string,
  writeScope: string[],
  maxItems = 200,
): string[] {
  const sb = resolve(String(sandbox || ''))
  const tg = resolve(String(target || ''))
  if (!sb || !tg || !existsSync(sb) || !existsSync(tg)) return []
  const scope = Array.isArray(writeScope) ? writeScope : []
  const sbMap = scope.length ? snapshotScope(sb, scope) : snapshotSandbox(sb)
  const out: string[] = []
  for (const [rel, fp] of sbMap) {
    const r = normalizeRel(rel)
    if (!r || isSensitiveRel(r) || isLocalDbRel(r)) continue
    if (scope.length && !pathInScope(r, scope)) continue
    const dest = join(tg, r)
    let tFp = '__absent__'
    try {
      if (existsSync(dest) && statSync(dest).isFile()) tFp = fingerprintFile(dest)
    } catch {
      tFp = '__absent__'
    }
    if (tFp !== fp) out.push(r)
    if (out.length >= maxItems) break
  }
  return out
}

/** 有效代码变更：去掉本地库等噪音 */
export function filterMeaningfulRels(rels: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of rels || []) {
    const r = normalizeRel(raw)
    if (!r || isSensitiveRel(r) || isLocalDbRel(r) || seen.has(r)) continue
    seen.add(r)
    out.push(r)
  }
  return out
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
    if (!rel || isSensitiveRel(rel) || isLocalDbRel(rel)) continue
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
      // 库文件被占用时跳过，不得拖死同批代码落盘
      if (isLocalDbRel(item.rel)) continue
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
