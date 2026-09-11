import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { RemoteReviewConfig, ReviewEvent } from './types.js'

const SAFE_REF = /^[A-Za-z0-9._/\-]{1,200}$/

function isAllowedCloneUrl(raw: string): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' && u.protocol !== 'ssh:') return false
  if (raw.startsWith('-')) return false
  const hosts = (process.env.REMOTE_REVIEW_ALLOWED_HOSTS || 'github.com,gitlab.com')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (u.protocol === 'ssh:') return true
  return hosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))
}

function run(cmd: string, args: string[], cwd?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: process.env })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (b: Buffer) => {
      stdout += b.toString('utf8')
    })
    child.stderr?.on('data', (b: Buffer) => {
      stderr += b.toString('utf8')
    })
    child.on('error', (err) => {
      resolve({ code: 1, stdout, stderr: String(err) })
    })
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

function safeRepoName(name: string): string {
  return (name || 'repo').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'repo'
}

export async function prepareWorkspace(
  cfg: RemoteReviewConfig,
  event: ReviewEvent,
): Promise<{ ok: boolean; path: string; detail?: string }> {
  if (event.localPath) {
    if (!existsSync(event.localPath)) {
      return { ok: false, path: event.localPath, detail: `本地路径不存在：${event.localPath}` }
    }
    return { ok: true, path: event.localPath }
  }

  const cloneUrl = (event.cloneUrl || '').trim()
  if (!cloneUrl) {
    return { ok: false, path: '', detail: 'Webhook 未提供 local_path 或 clone_url，无法检出' }
  }
  if (!isAllowedCloneUrl(cloneUrl)) {
    return { ok: false, path: '', detail: `clone_url 不被允许（仅 https/ssh + 白名单主机）：${cloneUrl}` }
  }
  if (event.branch && event.branch !== 'HEAD' && (!SAFE_REF.test(event.branch) || event.branch.startsWith('-'))) {
    return { ok: false, path: '', detail: `非法分支名：${event.branch}` }
  }
  if (event.commit && event.commit !== 'HEAD' && (!SAFE_REF.test(event.commit) || event.commit.startsWith('-'))) {
    return { ok: false, path: '', detail: `非法 commit：${event.commit}` }
  }

  const dir = join(cfg.workspaceRoot, safeRepoName(event.repo))
  const rootResolved = resolve(cfg.workspaceRoot)
  if (!(resolve(dir) === rootResolved || resolve(dir).startsWith(rootResolved + sep))) {
    return { ok: false, path: dir, detail: '工作区路径越界' }
  }
  mkdirSync(cfg.workspaceRoot, { recursive: true })

  if (!existsSync(join(dir, '.git'))) {
    const args = ['clone', '--depth', '50']
    if (event.branch && event.branch !== 'HEAD') args.push('--branch', event.branch)
    args.push('--', cloneUrl, dir)
    const cloned = await run('git', args)
    if (cloned.code !== 0) {
      return { ok: false, path: dir, detail: `git clone 失败：${cloned.stderr || cloned.stdout}` }
    }
  } else {
    const fetched = await run('git', ['fetch', '--all', '--prune'], dir)
    if (fetched.code !== 0) {
      return { ok: false, path: dir, detail: `git fetch 失败：${fetched.stderr || fetched.stdout}` }
    }
  }

  if (event.commit && event.commit !== 'HEAD' && !/^0+$/.test(event.commit)) {
    const co = await run('git', ['checkout', '--force', event.commit], dir)
    if (co.code !== 0) {
      const reset = await run('git', ['reset', '--hard', event.commit], dir)
      if (reset.code !== 0) {
        return { ok: false, path: dir, detail: `git checkout ${event.commit} 失败：${co.stderr || reset.stderr}` }
      }
    }
  } else if (event.branch && event.branch !== 'HEAD') {
    const co = await run('git', ['checkout', '--force', event.branch], dir)
    if (co.code !== 0) {
      return { ok: false, path: dir, detail: `git checkout ${event.branch} 失败：${co.stderr || co.stdout}` }
    }
  }

  return { ok: true, path: dir }
}
