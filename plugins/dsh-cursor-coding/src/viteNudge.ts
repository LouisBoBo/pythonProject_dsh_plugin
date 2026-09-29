/**
 * 同步后轻量刷新前端：触碰文件触发 HMR；必要时软重启 Vite。
 * CURSOR_CODING_FULL_BUILD=1 时额外跑 npm run build。
 */
import { existsSync, readFileSync, statSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync, spawn } from 'node:child_process'

const VITE_NAMES = ['vite.config.js', 'vite.config.ts', 'vite.config.mjs', 'vite.config.cjs']
const FRONT_MARKERS = [
  'frontend/src/',
  'frontend/index.html',
  'src/views/',
  'src/router/',
  'src/layouts/',
  'src/api/',
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

function softRestartVite(frontend: string, port: number): string {
  try {
    try {
      execFileSync(
        'bash',
        ['-lc', `lsof -nP -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null | xargs kill 2>/dev/null || true`],
        { timeout: 5000 },
      )
    } catch {
      /* ignore */
    }
    try {
      execFileSync('rm', ['-rf', join(frontend, 'node_modules', '.vite')], { timeout: 5000 })
    } catch {
      /* ignore */
    }
    const child = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port)], {
      cwd: frontend,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    })
    child.unref()
    return `已软重启 Vite :${port}`
  } catch (e) {
    return `Vite 软重启跳过：${String(e).slice(0, 120)}`
  }
}

async function runNpmBuild(frontend: string): Promise<string> {
  return await new Promise((resolve) => {
    const child = spawn('npm', ['run', 'build'], {
      cwd: frontend,
      stdio: 'ignore',
      env: { ...process.env },
    })
    const t = setTimeout(() => {
      try {
        child.kill('SIGTERM')
      } catch {
        /* ignore */
      }
      resolve('完整编译超时已中止')
    }, 180_000)
    child.on('exit', (code) => {
      clearTimeout(t)
      resolve(code === 0 ? '已执行 npm run build' : `npm run build 退出码 ${code}`)
    })
  })
}

/** 同步后刷新；返回给人看的短说明 */
export async function nudgeAfterSync(opts: {
  workspace: string
  syncedFiles: string[]
  deletedFiles?: string[]
}): Promise<string> {
  const synced = opts.syncedFiles || []
  const deleted = opts.deletedFiles || []
  if (!needsNudge(synced, deleted)) return '无需前端热更新'

  const frontend = resolveFrontendRoot(opts.workspace)
  if (!frontend) return '未找到 Vite 前端根，跳过编译刷新'

  touch(join(frontend, 'index.html'))
  for (const rel of synced.slice(0, 40)) {
    touch(join(opts.workspace, rel))
  }

  const full = String(process.env.CURSOR_CODING_FULL_BUILD || '').trim().toLowerCase()
  if (full === '1' || full === 'true') {
    const msg = await runNpmBuild(frontend)
    return `已触碰热更新文件；${msg}`
  }

  const port = readVitePort(frontend)
  const heavy = deleted.length > 0 || synced.some((f) => /router|layout|AppLayout/i.test(f))
  if (portListening(port)) {
    if (heavy) return `已触碰热更新；${softRestartVite(frontend, port)}`
    return `已触碰前端文件触发 HMR（:${port}）`
  }
  return softRestartVite(frontend, port)
}
