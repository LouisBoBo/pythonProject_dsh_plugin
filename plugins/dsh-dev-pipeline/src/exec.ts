/** 子进程：配置命令走 shell；git/gh 走参数数组，避免拼接注入。 */

import { spawn, spawnSync } from 'node:child_process'

export interface ExecResult {
  command: string
  exit_code: number | null
  timed_out: boolean
  stdout: string
  stderr: string
  output: string
}

const MAX_CAPTURE = 200_000

function clip(text: string): string {
  if (text.length <= MAX_CAPTURE) return text
  return `${text.slice(0, MAX_CAPTURE)}\n…（输出已截断）`
}

interface RunOpts {
  cwd: string
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal
}

function shellArgv(command: string): { bin: string; args: string[] } {
  if (process.platform === 'win32') {
    return { bin: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', command] }
  }
  return { bin: '/bin/sh', args: ['-c', command] }
}

function spawnCapture(
  label: string,
  bin: string,
  args: string[],
  opts: RunOpts,
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : 0
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    const child = spawn(bin, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env || {}) },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const finish = (code: number | null) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      opts.signal?.removeEventListener('abort', onAbort)
      resolve({
        command: label,
        exit_code: code,
        timed_out: timedOut,
        stdout: clip(stdout),
        stderr: clip(stderr),
        output: clip(`${stdout}${stderr ? `\n${stderr}` : ''}`),
      })
    }

    let killTimer: NodeJS.Timeout | null = null
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true
            child.kill('SIGTERM')
            killTimer = setTimeout(() => child.kill('SIGKILL'), 2000)
          }, timeoutMs)
        : null

    const onAbort = () => {
      child.kill('SIGTERM')
      killTimer = setTimeout(() => child.kill('SIGKILL'), 2000)
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout?.on('data', (buf: Buffer) => {
      if (stdout.length < MAX_CAPTURE) stdout += buf.toString('utf8')
    })
    child.stderr?.on('data', (buf: Buffer) => {
      if (stderr.length < MAX_CAPTURE) stderr += buf.toString('utf8')
    })
    child.on('error', (err) => {
      stderr += `\n${String(err)}`
      finish(null)
    })
    child.on('close', (code) => finish(code))
  })
}

export function runCommand(command: string, opts: RunOpts): Promise<ExecResult> {
  const { bin, args } = shellArgv(command)
  return spawnCapture(command, bin, args, opts)
}

export function runBinary(
  bin: string,
  args: string[],
  opts: RunOpts,
): Promise<ExecResult> {
  return spawnCapture([bin, ...args].join(' '), bin, args, opts)
}

export function which(cmd: string): string {
  try {
    if (process.platform === 'win32') {
      const out = spawnSync('where', [cmd], { encoding: 'utf8', windowsHide: true })
      if (out.status === 0) return String(out.stdout || '').split(/\r?\n/)[0].trim()
      return ''
    }
    const out = spawnSync('/bin/sh', ['-c', `command -v ${JSON.stringify(cmd)}`], {
      encoding: 'utf8',
    })
    return out.status === 0 ? String(out.stdout || '').trim() : ''
  } catch {
    return ''
  }
}

export async function git(
  args: string[],
  cwd: string,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ExecResult> {
  return runBinary('git', args, {
    cwd,
    timeoutMs: opts.timeoutMs ?? 60_000,
    signal: opts.signal,
  })
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  const out = await git(['rev-parse', '--is-inside-work-tree'], cwd, { timeoutMs: 10_000 })
  return out.exit_code === 0 && out.stdout.trim() === 'true'
}

export interface GitStatusEntry {
  code: string
  path: string
}

export async function gitStatus(cwd: string, signal?: AbortSignal): Promise<GitStatusEntry[]> {
  const out = await git(['status', '--porcelain=v1', '-z'], cwd, { signal })
  if (out.exit_code !== 0) return []
  const parts = out.stdout.split('\u0000').filter(Boolean)
  const rows: GitStatusEntry[] = []
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i]
    if (entry.length < 4) continue
    const code = entry.slice(0, 2)
    const path = entry.slice(3)
    // porcelain -z 的 rename/copy 第二条是旧路径，当前记录的新路径必须保留。
    if (code.startsWith('R') || code.startsWith('C')) i += 1
    rows.push({ code, path })
  }
  return rows
}

/** 暂存区文件（含 rename 的新路径）；用于识别用户原有 staged 改动。 */
export async function stagedFiles(cwd: string, signal?: AbortSignal): Promise<string[]> {
  const out = await git(['diff', '--cached', '--name-only', '-z'], cwd, { signal })
  if (out.exit_code !== 0) return []
  return out.stdout.split('\u0000').filter(Boolean)
}

export async function currentBranch(cwd: string, signal?: AbortSignal): Promise<string> {  const out = await git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd, { signal })
  return out.exit_code === 0 ? out.stdout.trim() : ''
}

export async function gitRemote(cwd: string, signal?: AbortSignal): Promise<string> {
  const out = await git(['remote', 'get-url', 'origin'], cwd, { signal })
  return out.exit_code === 0 ? out.stdout.trim() : ''
}

export async function hasStagedOrDirty(cwd: string, signal?: AbortSignal): Promise<boolean> {
  const out = await git(['status', '--porcelain'], cwd, { signal })
  return out.exit_code === 0 && out.stdout.trim().length > 0
}
