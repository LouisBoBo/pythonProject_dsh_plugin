/**
 * 工作区 Git 只读检视：供 Git 交付出口确认卡默认展示仓库地址与当前分支。
 * 不执行 commit/push；敏感路径只列、默认不勾选。
 */
import { execFile } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { isSensitiveRel, normalizeRel } from './pathScope.js'

/** 未跟踪目录最多展开多少个文件进确认卡 / 审码名单（防巨树拖垮） */
const MAX_UNTRACKED_DIR_EXPAND = 200

export type GitStatusEntry = {
  rel: string
  /** porcelain XY 前两字符 */
  code: string
  /** 是否默认纳入提交（敏感文件默认否） */
  selected: boolean
  sensitive: boolean
}

export type GitInspectOk = {
  ok: true
  workspace: string
  is_git: true
  /** 展示用远程地址（优先 origin） */
  remote_url: string
  remote_name: string
  /** 当前检出分支；detached 时为空串并写 head_detached */
  current_branch: string
  head_detached: boolean
  /** 合并目标：远端默认分支。PR 是「提交分支 → 这个分支」 */
  base_branch: string
  /** 有 upstream 时的远端跟踪名，如 origin/main */
  upstream: string
  dirty: boolean
  entries: GitStatusEntry[]
  /** 默认可提交（非敏感）路径 */
  selected_files: string[]
  held_sensitive_files: string[]
  detail: string
}

export type GitInspectFail = {
  ok: false
  workspace: string
  is_git: boolean
  code: 'not_dir' | 'not_git' | 'git_error' | 'no_changes'
  detail: string
}

export type GitInspectResult = GitInspectOk | GitInspectFail

const DEFAULT_BASES = ['main', 'master', 'develop', 'dev']

export function runGit(
  cwd: string,
  args: string[],
  opts?: { timeoutMs?: number },
): Promise<{ ok: boolean; stdout: string; stderr: string; code: number }> {
  const timeout = Math.max(3_000, Math.min(120_000, opts?.timeoutMs ?? 30_000))
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const out = String(stdout || '')
        const errText = String(stderr || '')
        if (!err) {
          resolve({ ok: true, stdout: out, stderr: errText, code: 0 })
          return
        }
        const e = err as NodeJS.ErrnoException & { code?: string | number; killed?: boolean }
        const code = typeof e.code === 'number' ? e.code : 1
        resolve({ ok: false, stdout: out, stderr: errText || String(err.message || err), code })
      },
    )
  })
}

/** 把 git@host:path / ssh URL 收成可读 https 展示；剥掉嵌入凭据，禁止 UI/结论泄漏 token */
export function displayRemoteUrl(raw: string): string {
  const s = String(raw || '').trim()
  if (!s) return ''
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s)
      u.username = ''
      u.password = ''
      return u.toString().replace(/\.git$/i, '').replace(/\/$/, '')
    } catch {
      // 解析失败仍剥 userinfo，避免 https://token@host 进结论
      return s.replace(/^(https?:\/\/)[^/@]+@/i, '$1').replace(/\.git$/i, '')
    }
  }
  const m = s.match(/^git@([^:]+):(.+)$/i)
  if (m) {
    const host = m[1]
    const path = m[2].replace(/\.git$/i, '')
    return `https://${host}/${path}`
  }
  const ssh = s.match(/^ssh:\/\/(?:[^/@]+@)?([^/]+)\/(.+)$/i)
  if (ssh) {
    return `https://${ssh[1]}/${ssh[2].replace(/\.git$/i, '')}`
  }
  return s
}

/**
 * 解开 `git status --porcelain` 的 C 引用路径。
 * 非 ASCII（如「审码报告.md」）默认是 `"...\345\256\241..."` 字节转义。
 * 必须先按字节还原成 UTF-8，再交给 normalizeRel。
 * 若先把 `\` 换成 `/`，八进制会被拆成不存在的目录，审码会误报「未能纳入」。
 * 未加引号的路径原样返回（Windows 反斜杠仍由 normalizeRel 处理）。
 */
export function unquoteGitPath(raw: string): string {
  const s0 = String(raw || '').trim()
  if (!(s0.length >= 2 && s0.startsWith('"') && s0.endsWith('"'))) return s0
  const s = s0.slice(1, -1)
  const bytes: number[] = []
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch !== '\\') {
      const c = s.charCodeAt(i)
      if (c <= 0x7f) bytes.push(c)
      else for (const b of Buffer.from(ch, 'utf8')) bytes.push(b)
      continue
    }
    const n = s[i + 1]
    if (n === undefined) break
    if (n >= '0' && n <= '7') {
      const oct = s.slice(i + 1, i + 4)
      if (/^[0-7]{3}$/.test(oct)) {
        bytes.push(parseInt(oct, 8))
        i += 3
        continue
      }
    }
    const simple: Record<string, number> = {
      '\\': 0x5c,
      '"': 0x22,
      n: 0x0a,
      t: 0x09,
      r: 0x0d,
      a: 0x07,
      b: 0x08,
      f: 0x0c,
      v: 0x0b,
    }
    if (Object.prototype.hasOwnProperty.call(simple, n)) {
      bytes.push(simple[n])
      i += 1
      continue
    }
    bytes.push(n.charCodeAt(0) & 0xff)
    i += 1
  }
  return Buffer.from(bytes).toString('utf8')
}

/** 解析 `git status --porcelain` 行（非 -z） */
export function parsePorcelainLines(text: string): { rel: string; code: string }[] {
  const out: { rel: string; code: string }[] = []
  const seen = new Set<string>()
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line || line.length < 4) continue
    const code = line.slice(0, 2)
    let pathPart = line.slice(3)
    // rename: "R  old -> new"；只取新路径，且先解 C 引用再规范化
    if (pathPart.includes(' -> ')) {
      pathPart = pathPart.split(' -> ').pop() || pathPart
    }
    const rel = normalizeRel(unquoteGitPath(pathPart.trim()))
    if (!rel || seen.has(rel)) continue
    seen.add(rel)
    out.push({ rel, code })
  }
  return out
}

function listFilesUnderDir(workspace: string, dirRel: string, limit: number): string[] {
  const absDir = join(workspace, dirRel)
  const out: string[] = []
  const walk = (dir: string) => {
    if (out.length >= limit) return
    let names: string[] = []
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    names.sort()
    for (const name of names) {
      if (out.length >= limit) return
      if (name === '.git' || name === 'node_modules' || name === '__pycache__') continue
      const full = join(dir, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        walk(full)
        continue
      }
      if (!st.isFile()) continue
      const rel = normalizeRel(relative(workspace, full).replace(/\\/g, '/'))
      if (rel) out.push(rel)
    }
  }
  walk(absDir)
  return out
}

/**
 * 把 porcelain 里的未跟踪目录（如 ``?? MOM/``）展开为内部文件。
 * 目录本身不是可审码/可精确勾选的文件；若不展开，审码会因 is_file 失败误报引擎不可用。
 * 仅展开存在且为目录的路径；空目录丢弃；已是文件的行原样保留。
 */
export function expandDirStatusRows(
  workspace: string,
  rows: { rel: string; code: string }[],
): { rel: string; code: string }[] {
  const abs = String(workspace || '').trim()
  const out: { rel: string; code: string }[] = []
  const seen = new Set<string>()
  const push = (rel: string, code: string) => {
    const r = normalizeRel(rel)
    if (!r || seen.has(r)) return
    seen.add(r)
    out.push({ rel: r, code })
  }
  for (const row of rows) {
    if (!abs) {
      push(row.rel, row.code)
      continue
    }
    const full = join(abs, row.rel)
    let isDir = false
    try {
      isDir = existsSync(full) && statSync(full).isDirectory()
    } catch {
      isDir = false
    }
    if (!isDir) {
      push(row.rel, row.code)
      continue
    }
    const children = listFilesUnderDir(abs, row.rel, MAX_UNTRACKED_DIR_EXPAND)
    if (!children.length) continue
    for (const child of children) push(child, row.code)
  }
  return out
}

export function buildStatusEntries(
  rows: { rel: string; code: string }[],
): { entries: GitStatusEntry[]; selected_files: string[]; held_sensitive_files: string[] } {
  const entries: GitStatusEntry[] = []
  const selected_files: string[] = []
  const held_sensitive_files: string[] = []
  for (const row of rows) {
    const sensitive = isSensitiveRel(row.rel)
    const selected = !sensitive
    entries.push({ rel: row.rel, code: row.code, selected, sensitive })
    if (sensitive) held_sensitive_files.push(row.rel)
    else selected_files.push(row.rel)
  }
  return { entries, selected_files, held_sensitive_files }
}

/** `git ls-remote --symref origin HEAD` 的第一行：`ref: refs/heads/hebo HEAD` */
export function parseRemoteHeadSymref(stdout: string): string {
  const m = String(stdout || '').match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD/m)
  return m ? m[1] : ''
}

export function pickDefaultBaseBranch(opts: {
  currentBranch: string
  remoteHead?: string
  localBranches?: string[]
}): string {
  const remoteHead = String(opts.remoteHead || '')
    .trim()
    .replace(/^refs\/heads\//, '')
  if (remoteHead && DEFAULT_BASES.includes(remoteHead)) return remoteHead
  if (remoteHead) return remoteHead
  const locals = new Set((opts.localBranches || []).map((b) => String(b || '').trim()).filter(Boolean))
  for (const b of DEFAULT_BASES) {
    if (locals.has(b)) return b
  }
  const cur = String(opts.currentBranch || '').trim()
  return cur || 'main'
}

/** 在默认主干上才建议新建 dsh/ 分支；已在功能分支则默认沿用当前分支 */
export function proposeDeliverBranch(opts: {
  currentBranch: string
  baseBranch: string
  headDetached?: boolean
  now?: Date
  slug?: string
}): { branch: string; create_new: boolean } {
  const current = String(opts.currentBranch || '').trim()
  const base = String(opts.baseBranch || '').trim() || 'main'
  if (opts.headDetached || !current) {
    return { branch: defaultDshBranchName(opts.now, opts.slug), create_new: true }
  }
  if (current === base || DEFAULT_BASES.includes(current)) {
    return { branch: defaultDshBranchName(opts.now, opts.slug), create_new: true }
  }
  return { branch: current, create_new: false }
}

export function defaultDshBranchName(now?: Date, slug?: string): string {
  const d = now || new Date()
  const stamp = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
    '-',
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0'),
  ].join('')
  const raw = String(slug || 'change')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  const safe = raw || 'change'
  return `dsh/${stamp}-${safe}`
}

/** 解析 `git diff --shortstat` / `git diff HEAD --shortstat` 输出 */
export function parseGitShortstat(text: string): { files: number; add: number; del: number } {
  const s = String(text || '').trim()
  if (!s) return { files: 0, add: 0, del: 0 }
  const files = Number((s.match(/(\d+)\s+files?\s+changed/i) || [])[1] || 0) || 0
  const add = Number((s.match(/(\d+)\s+insertions?\(\+\)/i) || [])[1] || 0) || 0
  const del = Number((s.match(/(\d+)\s+deletions?\(-\)/i) || [])[1] || 0) || 0
  return { files, add, del }
}

export type WorkspaceSummary = {
  ok: true
  workspace: string
  is_git: boolean
  current_branch: string
  head_detached: boolean
  remote_url: string
  base_branch: string
  dirty: boolean
  shortstat: { files: number; add: number; del: number }
  entries: { rel: string; code: string; sensitive: boolean; selected: boolean }[]
  selected_files: string[]
  held_sensitive_files: string[]
  detail: string
  code?: string
}

/**
 * 任务上下文侧栏只读摘要：干净仓也返回分支；不进入交付、不创建 Job。
 * 与 inspectGitWorkspace 分离：后者「无改动」为 ok:false，侧栏仍要展示环境。
 */
/** 侧栏每 4s 轮询工作区摘要，ls-remote 走网络，不能每次真打 */
const REMOTE_HEAD_TTL_MS = 60_000
const remoteHeadCache = new Map<string, { head: string; at: number }>()

/** 远端默认分支；fresh=true 给交付前的 inspect 取实时值 */
async function resolveRemoteHead(abs: string, remoteName: string, fresh = false): Promise<string> {
  const key = `${abs}\u0000${remoteName}`
  if (!fresh) {
    const hit = remoteHeadCache.get(key)
    if (hit && Date.now() - hit.at < REMOTE_HEAD_TTL_MS) return hit.head
  }
  const liveHead = await runGit(abs, ['ls-remote', '--symref', remoteName, 'HEAD'], { timeoutMs: 8_000 })
  let remoteHead = liveHead.ok ? parseRemoteHeadSymref(liveHead.stdout) : ''
  if (!remoteHead) {
    const symRes = await runGit(abs, ['symbolic-ref', `refs/remotes/${remoteName}/HEAD`])
    if (symRes.ok) {
      const prefix = `refs/remotes/${remoteName}/`
      const s = String(symRes.stdout || '').trim()
      if (s.startsWith(prefix)) remoteHead = s.slice(prefix.length)
    }
  }
  remoteHeadCache.set(key, { head: remoteHead, at: Date.now() })
  return remoteHead
}

export async function summarizeGitWorkspace(workspace: string): Promise<WorkspaceSummary> {
  const abs = String(workspace || '').trim()
  if (!abs) {
    return {
      ok: true,
      workspace: abs,
      is_git: false,
      current_branch: '',
      head_detached: false,
      remote_url: '',
      base_branch: '',
      dirty: false,
      shortstat: { files: 0, add: 0, del: 0 },
      entries: [],
      selected_files: [],
      held_sensitive_files: [],
      detail: '缺少工作区路径',
      code: 'not_dir',
    }
  }
  try {
    if (!existsSync(abs) || !statSync(abs).isDirectory()) {
      return {
        ok: true,
        workspace: abs,
        is_git: false,
        current_branch: '',
        head_detached: false,
        remote_url: '',
        base_branch: '',
        dirty: false,
        shortstat: { files: 0, add: 0, del: 0 },
        entries: [],
        selected_files: [],
        held_sensitive_files: [],
        detail: `工程路径无效：${abs}`,
        code: 'not_dir',
      }
    }
  } catch {
    return {
      ok: true,
      workspace: abs,
      is_git: false,
      current_branch: '',
      head_detached: false,
      remote_url: '',
      base_branch: '',
      dirty: false,
      shortstat: { files: 0, add: 0, del: 0 },
      entries: [],
      selected_files: [],
      held_sensitive_files: [],
      detail: `无法读取工程路径：${abs}`,
      code: 'not_dir',
    }
  }

  const gitDir = join(abs, '.git')
  if (!existsSync(gitDir)) {
    return {
      ok: true,
      workspace: abs,
      is_git: false,
      current_branch: '',
      head_detached: false,
      remote_url: '',
      base_branch: '',
      dirty: false,
      shortstat: { files: 0, add: 0, del: 0 },
      entries: [],
      selected_files: [],
      held_sensitive_files: [],
      detail: '当前工作区不是 Git 仓库',
      code: 'not_git',
    }
  }

  const rev = await runGit(abs, ['rev-parse', '--is-inside-work-tree'])
  if (!rev.ok || !String(rev.stdout).trim().toLowerCase().includes('true')) {
    return {
      ok: true,
      workspace: abs,
      is_git: false,
      current_branch: '',
      head_detached: false,
      remote_url: '',
      base_branch: '',
      dirty: false,
      shortstat: { files: 0, add: 0, del: 0 },
      entries: [],
      selected_files: [],
      held_sensitive_files: [],
      detail: rev.stderr || '当前目录不是 Git 工作树',
      code: 'not_git',
    }
  }

  const branchRes = await runGit(abs, ['branch', '--show-current'])
  const current_branch = String(branchRes.stdout || '').trim()
  const head_detached = !current_branch

  const remoteName = 'origin'
  const remoteRes = await runGit(abs, ['remote', 'get-url', remoteName])
  let remote_url = ''
  if (remoteRes.ok) {
    remote_url = displayRemoteUrl(String(remoteRes.stdout || '').trim())
  } else {
    const remotes = await runGit(abs, ['remote', '-v'])
    const first = String(remotes.stdout || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => /\s\(fetch\)$/.test(l))
    if (first) {
      const parts = first.split(/\s+/)
      if (parts.length >= 2) remote_url = displayRemoteUrl(parts[1])
    }
  }

  const remoteHead = await resolveRemoteHead(abs, remoteName)
  const localBr = await runGit(abs, ['branch', '--format=%(refname:short)'])
  const localBranches = String(localBr.stdout || '')
    .split(/\r?\n/)
    .map((b) => b.trim())
    .filter(Boolean)
  const base_branch = pickDefaultBaseBranch({
    currentBranch: current_branch,
    remoteHead,
    localBranches,
  })

  const st = await runGit(abs, ['status', '--porcelain'])
  const rows = st.ok ? expandDirStatusRows(abs, parsePorcelainLines(st.stdout)) : []
  const { entries, selected_files, held_sensitive_files } = buildStatusEntries(rows)

  // 相对 HEAD：含已暂存 + 未暂存的已跟踪改动；未跟踪无行数，只进 entries
  const diffStat = await runGit(abs, ['diff', 'HEAD', '--shortstat'])
  const shortstat = parseGitShortstat(diffStat.ok ? diffStat.stdout : '')

  return {
    ok: true,
    workspace: abs,
    is_git: true,
    current_branch: current_branch || (head_detached ? '（detached HEAD）' : ''),
    head_detached,
    remote_url: remote_url || '',
    base_branch,
    dirty: rows.length > 0,
    shortstat,
    entries,
    selected_files,
    held_sensitive_files,
    detail: rows.length
      ? `工作区未提交改动：${rows.length} 个路径` +
        (shortstat.add || shortstat.del ? `（+${shortstat.add} -${shortstat.del}）` : '')
      : '工作区干净',
    code: rows.length ? undefined : 'clean',
  }
}

export async function inspectGitWorkspace(workspace: string): Promise<GitInspectResult> {
  const abs = String(workspace || '').trim()
  if (!abs) {
    return { ok: false, workspace: abs, is_git: false, code: 'not_dir', detail: '缺少工作区路径' }
  }
  try {
    if (!existsSync(abs) || !statSync(abs).isDirectory()) {
      return { ok: false, workspace: abs, is_git: false, code: 'not_dir', detail: `工程路径无效：${abs}` }
    }
  } catch {
    return { ok: false, workspace: abs, is_git: false, code: 'not_dir', detail: `无法读取工程路径：${abs}` }
  }

  const gitDir = join(abs, '.git')
  if (!existsSync(gitDir)) {
    return { ok: false, workspace: abs, is_git: false, code: 'not_git', detail: '当前工作区不是 Git 仓库（未找到 .git）' }
  }

  const rev = await runGit(abs, ['rev-parse', '--is-inside-work-tree'])
  if (!rev.ok || !String(rev.stdout).trim().toLowerCase().includes('true')) {
    return {
      ok: false,
      workspace: abs,
      is_git: false,
      code: 'not_git',
      detail: rev.stderr || '当前目录不是 Git 工作树',
    }
  }

  const branchRes = await runGit(abs, ['branch', '--show-current'])
  const current_branch = String(branchRes.stdout || '').trim()
  const head_detached = !current_branch

  const remoteName = 'origin'
  const remoteRes = await runGit(abs, ['remote', 'get-url', remoteName])
  let remote_url = ''
  if (remoteRes.ok) {
    remote_url = displayRemoteUrl(String(remoteRes.stdout || '').trim())
  } else {
    const remotes = await runGit(abs, ['remote', '-v'])
    const first = String(remotes.stdout || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => /\s\(fetch\)$/.test(l))
    if (first) {
      const parts = first.split(/\s+/)
      if (parts.length >= 2) remote_url = displayRemoteUrl(parts[1])
    }
  }

  const upstreamRes = await runGit(abs, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  const upstream = upstreamRes.ok ? String(upstreamRes.stdout || '').trim() : ''

  // 本机 origin/HEAD 可能还停在旧的 main。合并目标以远端当前默认分支为准。
  const remoteHead = await resolveRemoteHead(abs, remoteName, true)

  const localBr = await runGit(abs, ['branch', '--format=%(refname:short)'])
  const localBranches = String(localBr.stdout || '')
    .split(/\r?\n/)
    .map((b) => b.trim())
    .filter(Boolean)

  const base_branch = pickDefaultBaseBranch({
    currentBranch: current_branch,
    remoteHead,
    localBranches,
  })

  const st = await runGit(abs, ['status', '--porcelain'])
  if (!st.ok) {
    return {
      ok: false,
      workspace: abs,
      is_git: true,
      code: 'git_error',
      detail: st.stderr || 'git status 失败',
    }
  }
  const rows = expandDirStatusRows(abs, parsePorcelainLines(st.stdout))
  if (!rows.length) {
    return {
      ok: false,
      workspace: abs,
      is_git: true,
      code: 'no_changes',
      detail: '工作区没有未提交改动，无需 Git 交付',
    }
  }
  const { entries, selected_files, held_sensitive_files } = buildStatusEntries(rows)
  if (!selected_files.length) {
    return {
      ok: false,
      workspace: abs,
      is_git: true,
      code: 'no_changes',
      detail:
        held_sensitive_files.length > 0
          ? `仅有敏感文件未提交（已排除）：${held_sensitive_files.slice(0, 8).join(', ')}`
          : '没有可安全提交的改动',
    }
  }

  return {
    ok: true,
    workspace: abs,
    is_git: true,
    remote_url: remote_url || '（未配置 remote）',
    remote_name: remote_url ? remoteName : '',
    current_branch: current_branch || '（detached HEAD）',
    head_detached,
    base_branch,
    upstream,
    dirty: true,
    entries,
    selected_files,
    held_sensitive_files,
    detail: `已读取 Git 状态：${selected_files.length} 个可提交文件` +
      (held_sensitive_files.length ? `，${held_sensitive_files.length} 个敏感已排除` : ''),
  }
}
