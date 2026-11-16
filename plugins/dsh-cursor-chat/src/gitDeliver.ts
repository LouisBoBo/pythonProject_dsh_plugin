/**
 * Git 交付出口执行层：确认后人审通过才 commit / push / 尝试开 PR。
 * 与写码沙箱无关；禁止 Cursor 在写码轮次里自行 commit。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { isSensitiveRel, normalizeRel } from './pathScope.js'
import {
  defaultDshBranchName,
  displayRemoteUrl,
  inspectGitWorkspace,
  proposeDeliverBranch,
  runGit,
  type GitInspectOk,
  type GitStatusEntry,
} from './gitInspect.js'

export type GitDeliverPlan = {
  workspace: string
  remote_url: string
  remote_name: string
  current_branch: string
  head_detached: boolean
  /** 将提交到的分支（可能等于当前分支） */
  target_branch: string
  create_new_branch: boolean
  base_branch: string
  commit_message: string
  create_pr: boolean
  entries: GitStatusEntry[]
  selected_files: string[]
  held_sensitive_files: string[]
}

export type GitDeliverStage =
  | 'inspect'
  | 'branch'
  | 'commit'
  | 'push'
  | 'pr'
  | 'done'

export type GitDeliverResult = {
  ok: boolean
  stage: GitDeliverStage
  detail: string
  remote_url: string
  current_branch: string
  target_branch: string
  base_branch: string
  commit_sha: string
  commit_short: string
  pushed: boolean
  pr_url: string
  pr_manual_hint: string
  committed_files: string[]
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}

/**
 * 分支/基线名闸门：禁止 push refspec 注入（如 `HEAD:refs/heads/main`、`+refs/...`）与选项注入。
 * 合法名允许中文（产品分支如 dsh/…-提交代码）。
 */
export function sanitizeGitRef(name: string, fallback = ''): string {
  const t = String(name || '').trim()
  if (!t) return fallback
  if (t.length > 200) return fallback
  if (t.startsWith('-') || t.startsWith('+')) return fallback
  if (t.includes(':') || t.includes('..') || t.includes('\\') || t.includes('\0')) return fallback
  if (/[\s~^?*[\]@{}]/.test(t)) return fallback
  // 允许字母数字、/._- 与常见 Unicode（中文分支）
  if (!/^[\w./\u0080-\uffff-]+$/u.test(t)) return fallback
  return t
}

/** 推送瞬时网络错误：Connection reset / TLS / DNS / 超时等，值得自动重试 */
export function isTransientGitNetworkError(text: string): boolean {
  const t = String(text || '')
  if (!t.trim()) return false
  return /Recv failure|Connection (was )?reset|Connection timed out|Failed to connect|Could not resolve host|SSL_(ERROR|connect)|LibreSSL SSL_connect|gnutls_handshake|timed?\s*out|HTTP\/?\s*5\d\d|Empty reply from server|[Uu]nable to access|The remote end hung up|RPC failed|curl\s*\d+|Could not read from remote/i.test(
    t,
  )
}

/** 「提交代码 / commit / 开 PR」一类口令，不得当 commit message（禁止瞎编成说明） */
export function isGenericDeliverIntent(text: string): boolean {
  const t = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t) return true
  if (t.length > 80) return false
  return /^(提交(代码|一下|吧)?|帮我提交(代码)?|commit(\s+and\s+push)?|push(\s+it)?|开\s*PR|提\s*MR|创建\s*(PR|Pull\s*Request)|推上去(让人审)?)$/i.test(
    t,
  )
}

/**
 * 仅根据真实改动文件与 porcelain 状态总结说明；禁止臆造业务语义。
 * 例：`更新 12 个文件：backend/…、README.md（改 10 / 新 2）`
 */
export function summarizeCommitFromChanges(opts: {
  files: string[]
  entries?: Array<{ rel: string; code?: string }>
}): string {
  const files = Array.from(
    new Set(
      (opts.files || [])
        .map((p) => normalizeRel(String(p || '')))
        .filter(Boolean)
        .filter((p) => !isSensitiveRel(p)),
    ),
  )
  if (!files.length) return 'chore: sync workspace changes'

  const byRel = new Map<string, string>()
  for (const e of opts.entries || []) {
    const rel = normalizeRel(String(e.rel || ''))
    if (rel) byRel.set(rel, String(e.code || ''))
  }

  let added = 0
  let modified = 0
  let deleted = 0
  for (const f of files) {
    const code = (byRel.get(f) || ' M').replace(/\s/g, '')
    if (!code || code === '??' || code[0] === 'A' || code[1] === 'A') added += 1
    else if (code[0] === 'D' || code[1] === 'D') deleted += 1
    else modified += 1
  }

  const tops = new Map<string, number>()
  for (const f of files) {
    const top = f.includes('/') || f.includes('\\') ? f.split(/[/\\]/)[0] : f
    tops.set(top, (tops.get(top) || 0) + 1)
  }
  const topRanked = [...tops.entries()].sort((a, b) => b[1] - a[1])
  const area =
    topRanked.length === 1
      ? topRanked[0][0]
      : topRanked
          .slice(0, 3)
          .map(([k]) => k)
          .join('、')

  const sample = files
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 3)
    .map((p) => (p.length > 42 ? p.slice(0, 39) + '…' : p))
  const more = files.length > sample.length ? ` 等 ${files.length} 个` : ''

  const parts: string[] = []
  if (modified) parts.push(`改 ${modified}`)
  if (added) parts.push(`新 ${added}`)
  if (deleted) parts.push(`删 ${deleted}`)
  const tally = parts.length ? `（${parts.join(' / ')}）` : ''

  const subject =
    files.length === 1
      ? `更新 ${sample[0]}`
      : `更新 ${area}：${sample.join('、')}${more}`
  const line = `${subject}${tally}`.replace(/\s+/g, ' ').trim()
  return line.slice(0, 120)
}

/** @deprecated 保留别名；新逻辑请用 summarizeCommitFromChanges */
export function draftCommitMessage(requirement: string): string {
  const t = String(requirement || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t || isGenericDeliverIntent(t)) return 'chore: sync workspace changes'
  return t.slice(0, 72)
}

function pickCommitMessage(opts: {
  requirement?: string
  commit_message?: string
  files: string[]
  entries: GitStatusEntry[]
}): string {
  const explicit = String(opts.commit_message || '').trim()
  if (explicit && !isGenericDeliverIntent(explicit)) return explicit.slice(0, 120)
  const req = String(opts.requirement || '').trim()
  if (req && !isGenericDeliverIntent(req)) return req.slice(0, 120)
  return summarizeCommitFromChanges({ files: opts.files, entries: opts.entries })
}

export function buildGitDeliverPlan(
  inspected: GitInspectOk,
  opts?: {
    requirement?: string
    commit_message?: string
    target_branch?: string
    base_branch?: string
    create_pr?: boolean
    selected_files?: string[]
  },
): GitDeliverPlan {
  const proposed = proposeDeliverBranch({
    currentBranch: inspected.current_branch,
    baseBranch: inspected.base_branch,
    headDetached: inspected.head_detached,
    slug: String(opts?.requirement || opts?.commit_message || 'change').slice(0, 24),
  })
  const wantBranch = sanitizeGitRef(String(opts?.target_branch || '').trim(), '')
  const target_branch = wantBranch || proposed.branch
  const create_new_branch = wantBranch
    ? wantBranch !== inspected.current_branch
    : proposed.create_new

  let selected = Array.isArray(opts?.selected_files)
    ? opts!.selected_files!.map((p) => normalizeRel(p)).filter(Boolean)
    : inspected.selected_files.slice()
  // 权威：敏感文件禁止进暂存，即使前端误传
  selected = selected.filter((p) => !isSensitiveRel(p))
  const allowed = new Set(inspected.entries.map((e) => e.rel))
  selected = selected.filter((p) => allowed.has(p))

  const entries = inspected.entries.map((e) => ({
    ...e,
    selected: selected.includes(e.rel),
  }))

  const base_branch =
    sanitizeGitRef(
      String(opts?.base_branch || inspected.base_branch || 'main').trim(),
      'main',
    ) || 'main'

  return {
    workspace: inspected.workspace,
    remote_url: inspected.remote_url,
    remote_name: inspected.remote_name,
    current_branch: inspected.current_branch,
    head_detached: inspected.head_detached,
    target_branch,
    create_new_branch,
    base_branch,
    commit_message: pickCommitMessage({
      requirement: opts?.requirement,
      commit_message: opts?.commit_message,
      files: selected,
      entries,
    }),
    create_pr: opts?.create_pr !== false,
    entries,
    selected_files: selected,
    held_sensitive_files: inspected.held_sensitive_files.slice(),
  }
}

export async function prepareGitDeliverPlan(
  workspace: string,
  opts?: {
    requirement?: string
    commit_message?: string
    target_branch?: string
    base_branch?: string
    create_pr?: boolean
  },
): Promise<{ ok: true; plan: GitDeliverPlan } | { ok: false; detail: string; code: string }> {
  const inspected = await inspectGitWorkspace(workspace)
  if (!inspected.ok) {
    return { ok: false, detail: inspected.detail, code: inspected.code }
  }
  return { ok: true, plan: buildGitDeliverPlan(inspected, opts) }
}

function emptyResult(partial: Partial<GitDeliverResult> & { detail: string; stage: GitDeliverStage }): GitDeliverResult {
  return {
    ok: false,
    remote_url: '',
    current_branch: '',
    target_branch: '',
    base_branch: '',
    commit_sha: '',
    commit_short: '',
    pushed: false,
    pr_url: '',
    pr_manual_hint: '',
    committed_files: [],
    ...partial,
  }
}

/** 确认后执行。selected_files / message / branch 以确认卡提交值为准。 */
export async function executeGitDeliver(
  plan: GitDeliverPlan,
  overrides?: {
    selected_files?: string[]
    commit_message?: string
    target_branch?: string
    base_branch?: string
    create_pr?: boolean
  },
  hooks?: {
    onProgress?: (message: string) => void
  },
): Promise<GitDeliverResult> {
  const workspace = plan.workspace
  let selected = (overrides?.selected_files || plan.selected_files)
    .map((p) => normalizeRel(p))
    .filter((p) => p && !isSensitiveRel(p))
  if (!selected.length) {
    return emptyResult({
      stage: 'inspect',
      detail: '未选择任何可提交文件（敏感文件已排除）',
      remote_url: plan.remote_url,
      current_branch: plan.current_branch,
      target_branch: plan.target_branch,
      base_branch: plan.base_branch,
    })
  }

  const target_branch =
    sanitizeGitRef(
      String(overrides?.target_branch || plan.target_branch || '').trim(),
      defaultDshBranchName(undefined, 'change'),
    ) || defaultDshBranchName(undefined, 'change')
  const base_branch =
    sanitizeGitRef(String(overrides?.base_branch || plan.base_branch || 'main').trim(), 'main') ||
    'main'
  const commit_message =
    String(overrides?.commit_message || plan.commit_message || '').trim() ||
    draftCommitMessage('')
  const create_pr = overrides?.create_pr !== undefined ? overrides.create_pr : plan.create_pr
  const progress = (msg: string) => {
    hooks?.onProgress?.(msg)
  }

  progress('正在重新读取工作区 Git 状态…')
  const fresh = await inspectGitWorkspace(workspace)
  if (!fresh.ok) {
    return emptyResult({
      stage: 'inspect',
      detail: fresh.detail,
      remote_url: plan.remote_url,
      current_branch: plan.current_branch,
      target_branch,
      base_branch,
    })
  }

  progress(`正在核对可提交文件（${selected.length} 个）…`)
  const available = new Set(fresh.entries.map((e) => e.rel))
  selected = selected.filter((p) => available.has(p))
  if (!selected.length) {
    return emptyResult({
      stage: 'inspect',
      detail: '确认时工作区已无对应改动，请重新发起 Git 交付',
      remote_url: fresh.remote_url,
      current_branch: fresh.current_branch,
      target_branch,
      base_branch,
    })
  }

  // 1) 分支
  const onTarget = !fresh.head_detached && fresh.current_branch === target_branch
  if (!onTarget) {
    const exists = await runGit(workspace, ['rev-parse', '--verify', '--quiet', target_branch])
    if (exists.ok) {
      progress(`正在切换到分支 ${target_branch}…`)
      const co = await runGit(workspace, ['checkout', target_branch])
      if (!co.ok) {
        return emptyResult({
          stage: 'branch',
          detail: `切换分支失败：${co.stderr || co.stdout || target_branch}`,
          remote_url: fresh.remote_url,
          current_branch: fresh.current_branch,
          target_branch,
          base_branch,
        })
      }
    } else {
      progress(`正在创建分支 ${target_branch}…`)
      const created = await runGit(workspace, ['checkout', '-b', target_branch])
      if (!created.ok) {
        return emptyResult({
          stage: 'branch',
          detail: `创建分支失败：${created.stderr || created.stdout || target_branch}`,
          remote_url: fresh.remote_url,
          current_branch: fresh.current_branch,
          target_branch,
          base_branch,
        })
      }
    }
  } else {
    progress(`已在目标分支 ${target_branch}`)
  }

  // 2) add + commit（仅勾选）
  progress(`正在暂存 ${selected.length} 个文件…`)
  for (const rel of selected) {
    const add = await runGit(workspace, ['add', '--', rel])
    if (!add.ok) {
      return emptyResult({
        stage: 'commit',
        detail: `git add 失败（${rel}）：${add.stderr || add.stdout}`,
        remote_url: fresh.remote_url,
        current_branch: target_branch,
        target_branch,
        base_branch,
        committed_files: [],
      })
    }
  }

  progress('正在创建 commit…')
  const commit = await runGit(workspace, ['commit', '-m', commit_message])
  if (!commit.ok) {
    return emptyResult({
      stage: 'commit',
      detail: `git commit 失败：${commit.stderr || commit.stdout}`,
      remote_url: fresh.remote_url,
      current_branch: target_branch,
      target_branch,
      base_branch,
    })
  }

  const shaRes = await runGit(workspace, ['rev-parse', 'HEAD'])
  const commit_sha = shaRes.ok ? String(shaRes.stdout || '').trim() : ''
  const commit_short = commit_sha.slice(0, 7)
  if (commit_short) progress(`本地已提交 ${commit_short}`)

  // 3) push：瞬时网络错误自动重试；推送过程用心跳，禁止长时间停在「已确认」无输出
  const remoteName = plan.remote_name || 'origin'
  const maxPushAttempts = 3
  const pushBackoffMs = [2000, 5000, 10000]

  async function pushOnce(attemptLabel: string) {
    progress(attemptLabel)
    const startedAt = Date.now()
    const tick = setInterval(() => {
      const sec = Math.round((Date.now() - startedAt) / 1000)
      progress(`正在推送到远端…已等待 ${sec} 秒（网络较慢时属正常）`)
    }, 8000)
    try {
      return await runGit(workspace, ['push', '-u', remoteName, target_branch], {
        timeoutMs: 120_000,
      })
    } finally {
      clearInterval(tick)
    }
  }

  let push = await pushOnce(`正在推送 ${target_branch} 到远端（第 1/${maxPushAttempts} 次）…`)
  for (let attempt = 1; !push.ok && attempt < maxPushAttempts; attempt += 1) {
    const errText = `${push.stderr || ''}\n${push.stdout || ''}`
    if (!isTransientGitNetworkError(errText)) break
    const waitMs = pushBackoffMs[attempt - 1] || 10000
    progress(
      `推送失败（网络瞬断），${Math.round(waitMs / 1000)} 秒后重试（${attempt + 1}/${maxPushAttempts}）…`,
    )
    await sleepMs(waitMs)
    push = await pushOnce(`正在重试推送 ${target_branch}（${attempt + 1}/${maxPushAttempts}）…`)
  }
  if (!push.ok) {
    return {
      ok: false,
      stage: 'push',
      detail: `已提交但推送失败（已重试 ${maxPushAttempts} 次）：${push.stderr || push.stdout}`,
      remote_url: fresh.remote_url,
      current_branch: target_branch,
      target_branch,
      base_branch,
      commit_sha,
      commit_short,
      pushed: false,
      pr_url: '',
      pr_manual_hint: fresh.remote_url
        ? `可在托管平台手动开 PR：${displayRemoteUrl(fresh.remote_url)}（${target_branch} → ${base_branch}）`
        : '请配置 remote 后手动推送并开 PR',
      committed_files: selected,
    }
  }

  // 4) PR（尽力：本机 gh；失败不回滚 commit/push）
  let pr_url = ''
  let pr_manual_hint = ''
  if (create_pr) {
    progress(`推送成功，正在尝试开 PR（${target_branch} → ${base_branch}）…`)
    const pr = await tryCreatePullRequest({
      workspace,
      base: base_branch,
      head: target_branch,
      title: commit_message,
      remoteUrl: fresh.remote_url,
    })
    pr_url = pr.url
    if (!pr.url) {
      pr_manual_hint =
        pr.detail ||
        `推送成功。请手动开 PR：${target_branch} → ${base_branch}` +
          (fresh.remote_url ? `（${fresh.remote_url}）` : '')
    }
  }

  return {
    ok: true,
    stage: pr_url || !create_pr ? 'done' : pr_manual_hint ? 'pr' : 'done',
    detail: pr_url
      ? `已提交并开 PR：${pr_url}`
      : create_pr
        ? `已推送 ${target_branch}（${commit_short}）。${pr_manual_hint}`
        : `已推送 ${target_branch}（${commit_short}）`,
    remote_url: fresh.remote_url,
    current_branch: target_branch,
    target_branch,
    base_branch,
    commit_sha,
    commit_short,
    pushed: true,
    pr_url,
    pr_manual_hint,
    committed_files: selected,
  }
}

/** 从 remote URL 解析托管方与 owner/repo（GitHub / Gitee）。 */
export function parseGitHosting(remoteUrl: string): {
  kind: 'github' | 'gitee' | 'unknown'
  host: string
  owner: string
  repo: string
  compareUrl: string
} | null {
  const https = displayRemoteUrl(remoteUrl)
  const m = https.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/#?]+)/i)
  if (!m) return null
  const host = m[1].toLowerCase()
  const owner = m[2]
  const repo = m[3].replace(/\.git$/i, '')
  const kind: 'github' | 'gitee' | 'unknown' = /github\.com$/i.test(host)
    ? 'github'
    : /gitee\.com$/i.test(host)
      ? 'gitee'
      : 'unknown'
  return {
    kind,
    host,
    owner,
    repo,
    compareUrl: '',
  }
}

export function buildComparePrUrl(remoteUrl: string, base: string, head: string): string {
  const parsed = parseGitHosting(remoteUrl)
  if (!parsed) return ''
  const { kind, host, owner, repo } = parsed
  const b = encodeURIComponent(base)
  const h = encodeURIComponent(head)
  if (kind === 'github') {
    return `https://${host}/${owner}/${repo}/compare/${b}...${h}?expand=1`
  }
  if (kind === 'gitee') {
    return `https://${host}/${owner}/${repo}/compare/${b}...${h}`
  }
  return `https://${host}/${owner}/${repo}`
}

/** 解析本机 gh：旁路安装路径优先（开发机可选，非产品主路径）。 */
function resolveGhExecutable(): string {
  const local = process.env.LOCALAPPDATA || process.env.HOME || ''
  const named = process.platform === 'win32' ? 'gh.exe' : 'gh'
  const candidates = [
    local ? join(local, 'dsh-tools', 'gh', 'bin', named) : '',
    local ? join(local, 'Programs', 'GitHub CLI', named) : '',
  ].filter(Boolean)
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return named
}

async function createPrWithHostToken(opts: {
  token: string
  remoteUrl: string
  base: string
  head: string
  title: string
}): Promise<{ url: string; detail: string }> {
  const parsed = parseGitHosting(opts.remoteUrl)
  if (!parsed || parsed.kind === 'unknown') {
    return { url: '', detail: '未能识别托管平台，无法用 Token 开 PR' }
  }
  const title = opts.title.slice(0, 120)
  const bodyText = `Created by dsh-cursor-chat Git deliver.\n\n${opts.title}`
  try {
    if (parsed.kind === 'github') {
      const res = await fetch(
        `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${opts.token}`,
            'Content-Type': 'application/json',
            'User-Agent': 'dsh-cursor-chat',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          body: JSON.stringify({
            title,
            head: opts.head,
            base: opts.base,
            body: bodyText,
          }),
        },
      )
      const raw = await res.text()
      let json: Record<string, unknown> = {}
      try {
        json = JSON.parse(raw) as Record<string, unknown>
      } catch {
        json = {}
      }
      if (res.ok) {
        const url = String(json.html_url || json.url || '').trim()
        return { url, detail: '' }
      }
      const msg = String(json.message || raw || res.statusText || res.status).slice(0, 240)
      // fine-grained 常见：只勾了 Pull requests Read → 403 Resource not accessible…
      const permHint = /Resource not accessible by personal access token|403/i.test(msg)
        ? '（当前 Token 对 Pull requests 只有读权限。请到 GitHub → Settings → Fine-grained tokens，编辑该 Token：仓库选中本仓，Permissions → Pull requests 改为 Read and write，保存后回「设置 → AI写码」覆盖保存 Token）'
        : ''
      return { url: '', detail: `GitHub API 开 PR 失败：${msg}${permHint}` }
    }
    // Gitee
    const res = await fetch(
      `https://gitee.com/api/v5/repos/${parsed.owner}/${parsed.repo}/pulls`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'dsh-cursor-chat',
        },
        body: JSON.stringify({
          access_token: opts.token,
          title,
          head: opts.head,
          base: opts.base,
          body: bodyText,
        }),
      },
    )
    const raw = await res.text()
    let json: Record<string, unknown> = {}
    try {
      json = JSON.parse(raw) as Record<string, unknown>
    } catch {
      json = {}
    }
    if (res.ok) {
      const url = String(json.html_url || json.url || '').trim()
      return { url, detail: '' }
    }
    const msg = String(json.message || json.error_description || raw || res.statusText).slice(0, 240)
    return { url: '', detail: `Gitee API 开 PR 失败：${msg}` }
  } catch (e) {
    return {
      url: '',
      detail: `用 Token 开 PR 异常：${String((e as Error)?.message || e).slice(0, 200)}`,
    }
  }
}

async function createPrWithGhCli(opts: {
  workspace: string
  base: string
  head: string
  title: string
}): Promise<{ url: string; detail: string }> {
  const { execFile } = await import('node:child_process')
  const ghBin = resolveGhExecutable()
  return new Promise((resolve) => {
    execFile(
      ghBin,
      [
        'pr',
        'create',
        '--base',
        opts.base,
        '--head',
        opts.head,
        '--title',
        opts.title.slice(0, 120),
        '--body',
        `Created by dsh-cursor-chat Git deliver.\n\n${opts.title}`,
      ],
      { cwd: opts.workspace, windowsHide: true, timeout: 120_000, maxBuffer: 2 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const out = String(stdout || '').trim()
        const errText = String(stderr || '').trim()
        if (!err) {
          const m = out.match(/https?:\/\/\S+/)
          resolve({ url: m ? m[0] : out, detail: '' })
          return
        }
        resolve({
          url: '',
          detail: errText || String((err as Error)?.message || err),
        })
      },
    )
  })
}

/**
 * 开 PR 优先级：设置页 Git Token（产品主路径）→ 本机 gh（可选）→ 手动 Compare 链接。
 * 失败不回滚 push。
 */
async function tryCreatePullRequest(opts: {
  workspace: string
  base: string
  head: string
  title: string
  remoteUrl: string
}): Promise<{ url: string; detail: string }> {
  const compare = buildComparePrUrl(opts.remoteUrl, opts.base, opts.head)
  const manualHint =
    `请手动开 PR：${opts.head} → ${opts.base}` +
    (compare ? `（${compare}）` : opts.remoteUrl ? ` @ ${opts.remoteUrl}` : '')

  try {
    const { loadConfig, gitHostTokenReady } = await import('./config.js')
    const cfg = loadConfig()
    if (gitHostTokenReady(cfg)) {
      const viaToken = await createPrWithHostToken({
        token: cfg.gitHostToken.trim(),
        remoteUrl: opts.remoteUrl,
        base: opts.base,
        head: opts.head,
        title: opts.title,
      })
      if (viaToken.url) return viaToken
      // Token 失败再试 gh；最后给手动链接
      const viaGh = await createPrWithGhCli(opts)
      if (viaGh.url) return viaGh
      return {
        url: '',
        detail: `${viaToken.detail || 'Token 开 PR 未成功'}。${manualHint}`,
      }
    }
  } catch {
    /* 读配置失败则继续 gh / 手动 */
  }

  const viaGh = await createPrWithGhCli(opts)
  if (viaGh.url) return viaGh
  const missing = /ENOENT|not found|不是内部或外部命令/i.test(viaGh.detail)
  return {
    url: '',
    detail: missing
      ? `未能自动开 PR：未配置 Git Token（设置 → AI写码），本机也无可用的 gh。${manualHint}`
      : `未能自动开 PR（${viaGh.detail.slice(0, 180)}）。${manualHint}`,
  }
}

/** 工作区干净 / 仅敏感文件：友好空结果，禁止套「未完成/冲突鉴权」失败模板 */
export function isGitDeliverIdleDetail(detail: string, code?: string): boolean {
  if (String(code || '').trim() === 'no_changes') return true
  const t = String(detail || '')
  return /没有未提交改动|无需 Git 交付|没有可安全提交的改动|仅有敏感文件未提交/.test(t)
}

export function formatGitDeliverConclusion(opts: {
  status: 'succeeded' | 'failed' | 'cancelled' | 'idle'
  plan?: GitDeliverPlan | null
  result?: GitDeliverResult | null
  cancelDetail?: string
  /** 空结果/自定义说明；有则优先生效，避免固定失败模板误导 */
  detail?: string
  code?: string
}): string {
  // 与写码「## 本轮结论」区分：Git 专用标题，避免结论区叠两套模板
  const lines: string[] = ['## Git 交付结论', '']
  if (opts.status === 'cancelled') {
    lines.push(`结果：⏹ 已取消 Git 交付。工作区改动仍在，未执行 commit。`)
    lines.push(``)
    lines.push(`说明：`)
    lines.push(`• ${opts.cancelDetail || '用户取消确认卡'}`)
    return lines.join('\n') + '\n'
  }

  const plan = opts.plan
  const result = opts.result
  const detail = String(opts.detail || result?.detail || '').trim()
  const idle =
    opts.status === 'idle' ||
    isGitDeliverIdleDetail(detail, opts.code) ||
    (result && !result.ok && result.stage === 'inspect' && isGitDeliverIdleDetail(result.detail))

  // 无改动可提交：友好收口，不要 ❌「未完成/停在检视」
  if (idle) {
    lines.push(`结果：ℹ 当前没有可提交的改动，本次无需 Git 交付。`)
    lines.push(``)
    lines.push(`说明：`)
    lines.push(`• ${detail || '工作区干净，没有未提交改动。'}`)
    lines.push(`• 未执行 commit，也未开 PR；工作区文件未被改动。`)
    if (plan?.remote_url) lines.push(`• 仓库：${plan.remote_url}`)
    if (plan?.current_branch) lines.push(`• 当前分支：${plan.current_branch}`)
    lines.push(``)
    lines.push(`接下来你可以：`)
    lines.push(`1. 若刚改过代码，先确认已保存到磁盘，并核对是否在当前工程路径。`)
    lines.push(`2. 有可提交改动后，再说一次「提交代码」即可。`)
    return lines.join('\n') + '\n'
  }

  if (!result || !result.ok) {
    const stage = result?.stage || 'inspect'
    const stageZh: Record<string, string> = {
      inspect: '检视',
      branch: '建分支',
      commit: '提交',
      push: '推送',
      pr: '开 PR',
      done: '完成',
    }
    // 按停驻步骤给不同提示，避免一律「冲突/鉴权」
    const hintByStage: Record<string, string[]> = {
      inspect: ['1. 核对工程路径与 Git 仓库是否正确。', '2. 需要时可重新发起 Git 交付。'],
      branch: ['1. 检查分支名是否合法、本地是否有冲突分支。', '2. 处理好后可再次发起 Git 交付。'],
      commit: ['1. 检查是否有未解决冲突或 hook 拦截。', '2. 工作区改动仍在，可再次发起交付。'],
      push: [
        '1. 工具内已自动重试推送多次仍失败；请检查网络/代理后，再说一次「提交代码」即可。',
        '2. 本地 commit 已保留，未回滚；无需在本轮再选「如何处理」。',
      ],
      pr: ['1. 分支若已推送，可按提示手动开 PR。', '2. 或安装/登录 gh 后再试自动开 PR。'],
    }
    const pushDone =
      stage === 'push' && /已重试|已提交但推送失败/.test(detail || result?.detail || '')
    lines.push(
      pushDone
        ? `结果：⚠ 本地已提交，推送失败（已自动重试多次）。`
        : `结果：❌ Git 交付未完成（停在：${stageZh[stage] || stage}）。`,
    )
    lines.push(``)
    lines.push(`说明：`)
    lines.push(`• ${detail || result?.detail || '未知错误'}`)
    if (plan) {
      if (plan.remote_url) lines.push(`• 仓库：${plan.remote_url}`)
      if (plan.current_branch) lines.push(`• 当前分支：${plan.current_branch}`)
    }
    if (result?.commit_short) {
      lines.push(`• 已产生 commit：${result.commit_short}（可能尚未推送）`)
    }
    if (result?.pr_manual_hint) lines.push(`• ${result.pr_manual_hint}`)
    lines.push(``)
    lines.push(pushDone ? `说明（终态，无需再选）：` : `请你验收：`)
    lines.push(...(hintByStage[stage] || hintByStage.inspect))
    return lines.join('\n') + '\n'
  }
  lines.push(`结果：✅ Git 交付完成。`)
  lines.push(``)
  lines.push(`说明：`)
  lines.push(`• 仓库：${result.remote_url || plan?.remote_url || ''}`)
  lines.push(`• 分支：${result.target_branch}`)
  if (result.commit_short) lines.push(`• Commit：${result.commit_short}`)
  if (result.committed_files.length) {
    lines.push(
      `• 提交文件：${result.committed_files.slice(0, 20).join(', ')}${result.committed_files.length > 20 ? '…' : ''}`,
    )
  }
  if (result.pr_url) lines.push(`• PR：${result.pr_url}`)
  else if (result.pr_manual_hint) lines.push(`• ${result.pr_manual_hint}`)
  lines.push(``)
  lines.push(`请你验收：`)
  lines.push(`1. 在托管平台核对分支与 commit。`)
  if (result.pr_url) lines.push(`2. 打开 PR 链接完成人审合并。`)
  else lines.push(`2. 若需合入主干，按提示手动开 PR。`)
  return lines.join('\n') + '\n'
}
