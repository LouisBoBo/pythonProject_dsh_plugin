/**
 * 同步后轻量刷新前端：默认只触碰文件触发 HMR。
 *
 * 禁止默认「杀 Vite + npm run dev」：桌面宿主 PATH 常无 npm，
 * spawn('npm') 一旦 ENOENT 且未挂 error 监听 → 未捕获异常直接打崩 DSH host，
 * 表现成「正在汇总本轮结论」时进程退出、结论未交付。
 *
 * 可选：CURSOR_CHAT_VITE_RESTART=1 且本机可解析到 npm 时才软重启（仍吞掉所有错误）。
 * CURSOR_CHAT_FULL_BUILD=1 时额外 npm run build（同样安全 spawn）。
 */
import { existsSync, readFileSync, statSync, utimesSync } from 'node:fs'
import { join, delimiter } from 'node:path'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { sandboxSafeEnv } from './sandboxEnv.js'

const VITE_NAMES = ['vite.config.js', 'vite.config.ts', 'vite.config.mjs', 'vite.config.cjs']
const FRONT_MARKERS = [
  'frontend/src/',
  'frontend/index.html',
  'src/views/',
  'src/router/',
  'src/layouts/',
  'src/api/',
]

const NPM_CANDIDATES = [
  '/usr/local/bin/npm',
  '/opt/homebrew/bin/npm',
  '/usr/bin/npm',
  join(process.env.HOME || '', '.nvm/current/bin/npm'),
  join(process.env.HOME || '', '.local/share/fnm/current/bin/npm'),
]

export function resolveFrontendRoot(workspace: string): string | null {
  for (const cand of [join(workspace, 'frontend'), workspace]) {
    if (!existsSync(cand)) continue
    if (VITE_NAMES.some((n) => existsSync(join(cand, n)))) return cand
  }
  return null
}

function readVitePort(frontend: string): number {
  for (const n of VITE_NAMES) {
    const p = join(frontend, n)
    if (!existsSync(p)) continue
    try {
      const text = readFileSync(p, 'utf8').slice(0, 8000)
      const m = text.match(/port\s*:\s*(\d{2,5})/)
      if (m) {
        const port = Number(m[1])
        if (port >= 1 && port <= 65535) return port
      }
    } catch {
      /* ignore */
    }
  }
  return 5175
}

function needsNudge(synced: string[], deleted: string[]): boolean {
  for (const raw of [...synced, ...deleted]) {
    const rel = String(raw || '')
      .replace(/\\/g, '/')
      .replace(/^删除\s*/, '')
      .replace(/^\.\//, '')
    if (!rel) continue
    if (FRONT_MARKERS.some((m) => rel.startsWith(m) || rel === m.replace(/\/$/, ''))) return true
    if (/\.(vue|jsx|tsx|css|js|ts)$/.test(rel) && rel.includes('/src/')) return true
  }
  return false
}

function touch(path: string): void {
  try {
    if (!existsSync(path) || !statSync(path).isFile()) return
    const now = new Date()
    utimesSync(path, now, now)
  } catch {
    /* ignore */
  }
}

function portListening(port: number): boolean {
  try {
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      timeout: 3000,
    })
    return Boolean(out && String(out).trim())
  } catch {
    return false
  }
}

function envWithCommonPath(): NodeJS.ProcessEnv {
  const extra = ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin']
  const cur = String(process.env.PATH || '')
  const parts = [...extra, ...cur.split(delimiter).filter(Boolean)]
  const seen = new Set<string>()
  const path = parts.filter((p) => {
    if (!p || seen.has(p)) return false
    seen.add(p)
    return true
  }).join(delimiter)
  return { ...process.env, PATH: path }
}

/** 解析可用的 npm 可执行文件；找不到则返回 null（禁止盲目 spawn 'npm'） */
export function resolveNpmBin(): string | null {
  try {
    const out = execFileSync('bash', ['-lc', 'command -v npm'], {
      encoding: 'utf8',
      timeout: 3000,
      env: envWithCommonPath(),
    })
    const p = String(out || '').trim().split('\n')[0] || ''
    if (p && existsSync(p)) return p
  } catch {
    /* fall through */
  }
  for (const c of NPM_CANDIDATES) {
    if (c && existsSync(c)) return c
  }
  return null
}

/**
 * 安全 detach spawn：必须监听 error，否则 ENOENT 会变成宿主未捕获异常并退出。
 */
function spawnDetachedSafe(
  bin: string,
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv },
): { ok: true; child: ChildProcess } | { ok: false; detail: string } {
  try {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      detached: true,
      stdio: 'ignore',
      env: opts.env || envWithCommonPath(),
    })
    let failed = ''
    child.on('error', (err) => {
      failed = String(err && (err as Error).message ? (err as Error).message : err).slice(0, 160)
      console.warn('[cursor-chat] viteNudge spawn error (swallowed)', failed)
    })
    child.unref()
    // 同步无法等 async error；若 bin 不存在，error 仍会在下一 tick 触发——已挂监听，不会打崩宿主
    if (!existsSync(bin)) {
      return { ok: false, detail: `可执行文件不存在：${bin}` }
    }
    return { ok: true, child }
  } catch (e) {
    return { ok: false, detail: String(e).slice(0, 160) }
  }
}

function softRestartVite(frontend: string, port: number): string {
  const npm = resolveNpmBin()
  if (!npm) {
    return `Vite 软重启跳过：宿主环境找不到 npm（已仅触碰文件；需要热更新请本机终端自行 npm run dev :${port}）`
  }
  try {
    try {
      execFileSync(
        'bash',
        ['-lc', `lsof -nP -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null | xargs kill 2>/dev/null || true`],
        { timeout: 5000, env: envWithCommonPath() },
      )
    } catch {
      /* ignore */
    }
    try {
      execFileSync('rm', ['-rf', join(frontend, 'node_modules', '.vite')], { timeout: 5000 })
    } catch {
      /* ignore */
    }
    const spawned = spawnDetachedSafe(
      npm,
      ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port)],
      { cwd: frontend, env: envWithCommonPath() },
    )
    if (!spawned.ok) return `Vite 软重启跳过：${spawned.detail}`
    return `已软重启 Vite :${port}`
  } catch (e) {
    return `Vite 软重启跳过：${String(e).slice(0, 120)}`
  }
}

async function runNpmBuild(frontend: string): Promise<string> {
  const npm = resolveNpmBin()
  if (!npm) return '完整编译跳过：找不到 npm'
  return await new Promise((resolve) => {
    let settled = false
    const done = (msg: string) => {
      if (settled) return
      settled = true
      resolve(msg)
    }
    let child: ChildProcess
    try {
      child = spawn(npm, ['run', 'build'], {
        cwd: frontend,
        stdio: 'ignore',
        env: sandboxSafeEnv(),
      })
    } catch (e) {
      done(`完整编译跳过：${String(e).slice(0, 120)}`)
      return
    }
    child.on('error', (err) => {
      done(`完整编译跳过：${String(err && err.message ? err.message : err).slice(0, 120)}`)
    })
    const t = setTimeout(() => {
      try {
        child.kill('SIGTERM')
      } catch {
        /* ignore */
      }
      done('完整编译超时已中止')
    }, 180_000)
    child.on('exit', (code) => {
      clearTimeout(t)
      done(code === 0 ? '已执行 npm run build' : `npm run build 退出码 ${code}`)
    })
  })
}

function viteRestartEnabled(): boolean {
  const raw = String(process.env.CURSOR_CHAT_VITE_RESTART || '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

/** 同步后刷新；返回给人看的短说明。任意失败不得抛出。 */
export async function nudgeAfterSync(opts: {
  workspace: string
  syncedFiles: string[]
  deletedFiles?: string[]
}): Promise<string> {
  try {
    const synced = opts.syncedFiles || []
    const deleted = opts.deletedFiles || []
    if (!needsNudge(synced, deleted)) return '无需前端热更新'

    const frontend = resolveFrontendRoot(opts.workspace)
    if (!frontend) return '未找到 Vite 前端根，跳过编译刷新'

    touch(join(frontend, 'index.html'))
    for (const rel of synced.slice(0, 40)) {
      touch(join(opts.workspace, rel))
    }

    const full = String(process.env.CURSOR_CHAT_FULL_BUILD || '').trim().toLowerCase()
    if (full === '1' || full === 'true') {
      const msg = await runNpmBuild(frontend)
      return `已触碰热更新文件；${msg}`
    }

    const port = readVitePort(frontend)
    // 默认绝不杀进程/spawn npm：只触碰文件。软重启需显式开关且 npm 可用。
    if (!viteRestartEnabled()) {
      if (portListening(port)) {
        return `已触碰前端文件触发 HMR（:${port}）`
      }
      return `已触碰前端文件；:${port} 未在监听（请本机自行开 Vite，插件不再自动 npm run dev）`
    }

    const heavy = deleted.length > 0 || synced.some((f) => /router|layout|AppLayout/i.test(f))
    if (portListening(port) && !heavy) {
      return `已触碰前端文件触发 HMR（:${port}）`
    }
    return `已触碰热更新；${softRestartVite(frontend, port)}`
  } catch (e) {
    console.warn('[cursor-chat] nudgeAfterSync swallowed', e)
    return `前端热更新跳过：${String(e).slice(0, 120)}`
  }
}
