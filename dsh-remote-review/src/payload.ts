import { createHmac, timingSafeEqual } from 'node:crypto'
import type { ReviewEvent } from './types.js'

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function header(headers: Record<string, string | string[] | undefined>, name: string): string {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase())
  if (!key) return ''
  const v = headers[key]
  return Array.isArray(v) ? v[0] || '' : v || ''
}

function branchFromRef(ref: string): string {
  return ref.replace(/^refs\/heads\//, '').replace(/^refs\/tags\//, '') || 'HEAD'
}

function isZeroSha(sha: string): boolean {
  return !sha || /^0+$/.test(sha)
}

export function secretsEqual(expected: string, actual: string): boolean {
  const a = Buffer.from(expected)
  const b = Buffer.from(actual)
  if (a.length !== b.length || a.length === 0) return a.length === b.length && expected === actual
  return timingSafeEqual(a, b)
}

export function isLoopbackHost(host: string): boolean {
  const h = (host || '').trim().toLowerCase()
  return h === '127.0.0.1' || h === '::1' || h === 'localhost'
}

/** GitHub Webhook：Secret 字段对应 X-Hub-Signature-256 = sha256=<hmac> */
export function verifyGitHubSignature(secret: string, rawBody: string, signatureHeader: string): boolean {
  const sig = (signatureHeader || '').trim()
  if (!sig.toLowerCase().startsWith('sha256=')) return false
  const digest = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  const expected = `sha256=${digest}`
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
  } catch {
    return false
  }
}

export function verifyWebhookSecret(opts: {
  configuredSecret: string
  headers: Record<string, string | string[] | undefined>
  listenHost?: string
  /** 公网反代场景：即使 listen 是 127.0.0.1 也必须校验密钥 */
  requireSecret?: boolean
  /** GitHub HMAC 需要原始 body */
  rawBody?: string
}): { ok: boolean; detail?: string } {
  const expected = (opts.configuredSecret || '').trim()
  const force = opts.requireSecret === true || process.env.REMOTE_REVIEW_REQUIRE_SECRET === '1'
  if (!expected) {
    if (!force && isLoopbackHost(opts.listenHost || '127.0.0.1')) return { ok: true }
    return { ok: false, detail: '未配置 Webhook 密钥（公网部署必须配置）' }
  }
  const gitlab = header(opts.headers, 'x-gitlab-token')
  const local = header(opts.headers, 'x-remote-review-secret')
  const ghSig = header(opts.headers, 'x-hub-signature-256')
  if (gitlab || local) {
    const actual = gitlab || local
    if (!secretsEqual(expected, actual)) return { ok: false, detail: 'Webhook 密钥不匹配' }
    return { ok: true }
  }
  if (ghSig) {
    if (opts.rawBody == null) return { ok: false, detail: 'GitHub 签名校验缺少请求体' }
    if (!verifyGitHubSignature(expected, opts.rawBody, ghSig)) {
      return { ok: false, detail: 'GitHub X-Hub-Signature-256 校验失败' }
    }
    return { ok: true }
  }
  return {
    ok: false,
    detail: '缺少 Webhook 密钥头（GitHub: X-Hub-Signature-256；GitLab: X-Gitlab-Token；或 X-Remote-Review-Secret）',
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}

export function parseWebhookPayload(
  body: unknown,
  headers: Record<string, string | string[] | undefined> = {},
): ReviewEvent {
  const data = asRecord(body)
  const ghEvent = header(headers, 'x-github-event').toLowerCase()
  const glEvent = header(headers, 'x-gitlab-event').toLowerCase()

  if (ghEvent === 'ping' || str(data.zen)) {
    return {
      source: 'github',
      repo: str(asRecord(data.repository).full_name) || 'github',
      commit: '',
      branch: '',
      focus: 'github ping',
      skip: true,
      skipReason: 'GitHub ping，不审码',
    }
  }

  const eventName = str(data.event).toLowerCase()
  if (eventName === 'git-commit' || eventName === 'simulate') {
    const localPath = str(data.local_path) || str(data.localPath)
    const commit = str(data.commit) || str(data.after) || 'HEAD'
    const repo = str(data.repo) || (localPath ? localPath.split(/[\\/]/).filter(Boolean).pop() || 'local' : 'local')
    return {
      source: eventName === 'simulate' ? 'simulate' : 'local',
      repo,
      commit,
      branch: str(data.branch) || 'HEAD',
      localPath: localPath || undefined,
      focus: str(data.focus) || `IDE 提交 ${commit.slice(0, 8)} 自动审码`,
    }
  }

  if (ghEvent === 'push' || asRecord(data.repository).clone_url || asRecord(data.repository).html_url) {
    const repo = asRecord(data.repository)
    const after = str(data.after)
    if (isZeroSha(after) || data.deleted === true || str(data.deleted) === 'true') {
      return {
        source: 'github',
        repo: str(repo.full_name) || str(repo.name) || 'github',
        commit: after,
        branch: branchFromRef(str(data.ref)),
        focus: 'github push',
        skip: true,
        skipReason: '删除分支/空提交，跳过',
      }
    }
    return {
      source: 'github',
      repo: str(repo.full_name) || str(repo.name) || 'github',
      commit: after || str(asRecord(data.head_commit).id),
      branch: branchFromRef(str(data.ref)),
      cloneUrl: str(repo.clone_url) || str(repo.html_url),
      focus: `GitHub push ${str(repo.name)} ${String(after).slice(0, 8)}`,
    }
  }

  if (glEvent.includes('push') || str(data.object_kind) === 'push' || asRecord(data.project).git_http_url) {
    const project = asRecord(data.project)
    const after = str(data.after)
    if (isZeroSha(after)) {
      return {
        source: 'gitlab',
        repo: str(project.path_with_namespace) || str(project.name) || 'gitlab',
        commit: after,
        branch: branchFromRef(str(data.ref)),
        focus: 'gitlab push',
        skip: true,
        skipReason: '删除分支/空提交，跳过',
      }
    }
    return {
      source: 'gitlab',
      repo: str(project.path_with_namespace) || str(project.name) || str(data.project_name) || 'gitlab',
      commit: after,
      branch: branchFromRef(str(data.ref)),
      cloneUrl: str(project.git_http_url) || str(data.git_http_url),
      focus: `GitLab push ${str(project.name)} ${after.slice(0, 8)}`,
    }
  }

  return {
    source: 'simulate',
    repo: str(data.repo) || 'unknown',
    commit: str(data.commit) || '',
    branch: str(data.branch) || '',
    focus: 'unrecognized webhook',
    skip: true,
    skipReason: '无法识别的 Webhook 载荷',
  }
}
