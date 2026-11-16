/**
 * 工作区 Git 只读检视：供 Git 交付出口确认卡默认展示仓库地址与当前分支。
 * 不执行 commit/push；敏感路径只列、默认不勾选。
 */
import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { isSensitiveRel, normalizeRel } from './pathScope.js'

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
  /** 推断的 PR 基线分支（main/master 等） */
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

/** 解析 `git status --porcelain` 行（非 -z） */
export function parsePorcelainLines(text: string): { rel: string; code: string }[] {
  const out: { rel: string; code: string }[] = []
  const seen = new Set<string>()
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line || line.length < 4) continue
    const code = line.slice(0, 2)
    let pathPart = line.slice(3)
    // rename: "R  old -> new"
    if (pathPart.includes(' -> ')) {
      pathPart = pathPart.split(' -> ').pop() || pathPart
    }
    const rel = normalizeRel(pathPart.trim().replace(/^"|"$/g, ''))
    if (!rel || seen.has(rel)) continue
    seen.add(rel)
    out.push({ rel, code })
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

  const symRes = await runGit(abs, ['symbolic-ref', 'refs/remotes/origin/HEAD'])
  let remoteHead = ''
  if (symRes.ok) {
    remoteHead = String(symRes.stdout || '')
      .trim()
      .replace(/^refs\/remotes\/origin\//, '')
  }

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
  const rows = parsePorcelainLines(st.stdout)
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
