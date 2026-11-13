/**
 * 后端重启门禁：
 * - 本轮只要同步/删除了会影响运行中进程的后端代码（backend 下非测试 .py），就应重启
 * - 能解析 Vite 代理端口 + uvicorn 启动命令时：本机服务进程**实际执行**重启（可见 PowerShell 窗）
 * - 应用终端仅作镜像展示；不得只「签发」就宣称已重启
 * - 解析不到启动方式时，仍给文案提示（禁止无动作也无说明）
 * - 禁止：纯前端、测试/迁移、端口/命令未知时硬重启
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  detectProjectLayout,
  isBackendRuntimeRel,
  type ProjectLayout,
} from './projectLayout.js'

export type BackendRestartOffer = {
  offered: true
  reason: string
  /** 后端工作目录（绝对路径） */
  cwd: string
  /** 启动命令（单行，已含 host/port） */
  command: string
  port: number
  probe_url: string
  hit_files: string[]
  /** 可粘贴到终端的脚本（优先 cmd 可跑的单行） */
  shell_lines: string[]
  /** 已确认并执行过（防连点） */
  started_at?: string | null
  /** 本机是否已真正拉起重启进程 */
  executed?: boolean
  done_at?: string | null
  last_detail?: string | null
}

function normRel(raw: string): string {
  return String(raw || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^删除\s*/, '')
    .trim()
}

/**
 * 会影响本机已启动后端进程的源码（含 routers / main / models / schemas / services 等）。
 * 不含测试与迁移，避免无谓打扰。
 * 有 workspace 时按项目画像后端根判定；无画像时用路径段兜底（backend|server|根 app/）。
 */
export function isBackendRuntimeFile(rel: string, layout?: ProjectLayout | null): boolean {
  return isBackendRuntimeRel(rel, layout)
}

/** 本轮变更是否需要后端重启（仍须后续解析端口/命令才出按钮） */
export function listBackendRestartHits(
  synced: string[],
  deleted: string[] = [],
  layout?: ProjectLayout | null,
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of [...(synced || []), ...(deleted || [])]) {
    const rel = normRel(raw)
    if (!rel || !isBackendRuntimeFile(rel, layout)) continue
    if (seen.has(rel)) continue
    seen.add(rel)
    out.push(rel)
  }
  return out
}

export function resolveBackendRoot(workspace: string, hintRels: string[] = []): string | null {
  const layout = detectProjectLayout(workspace, hintRels)
  return layout.backendRoots[0] || null
}

/** 画像里的前端根 + 后端根 + workspace，供仍按「多根试探」的旧调用兼容。 */
export function resolveAppRoots(workspace: string, hintRels: string[] = []): string[] {
  const layout = detectProjectLayout(workspace, hintRels)
  const out: string[] = [layout.workspace]
  const seen = new Set(out.map((p) => resolve(p)))
  for (const p of [...layout.frontendRoots, ...layout.backendRoots]) {
    const key = resolve(p)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out
}

function readText(path: string, limit = 120_000): string {
  try {
    if (!existsSync(path)) return ''
    return readFileSync(path, 'utf8').slice(0, limit)
  } catch {
    return ''
  }
}

/**
 * 只认 Vite 代理到本机 loopback 的后端口；认不到就不出重启按钮（仍可文案提示）。
 * 端口来自项目画像扫描到的任意深度 vite 配置。
 */
export function readBackendPortFromViteProxy(workspace: string, hintRels: string[] = []): number | null {
  return detectProjectLayout(workspace, hintRels).backendProxyPort
}

export function resolveUvicornStartCommand(
  backendRoot: string,
  port: number,
): { command: string; module: string } | null {
  if (!backendRoot || !port) return null
  if (existsSync(join(backendRoot, 'app', 'main.py'))) {
    const body = readText(join(backendRoot, 'app', 'main.py'), 8000)
    if (!/\bFastAPI\b|\bAPIRouter\b|include_router/.test(body)) return null
    return {
      module: 'app.main:app',
      command: `python -m uvicorn app.main:app --host 127.0.0.1 --port ${port} --reload`,
    }
  }
  if (existsSync(join(backendRoot, 'main.py'))) {
    const body = readText(join(backendRoot, 'main.py'), 8000)
    if (!/\bFastAPI\b|\bAPIRouter\b|include_router/.test(body)) return null
    return {
      module: 'main:app',
      command: `python -m uvicorn main:app --host 127.0.0.1 --port ${port} --reload`,
    }
  }
  return null
}

function shellQuoteWin(path: string): string {
  return "'" + String(path).replace(/'/g, "''") + "'"
}

function shellQuoteUnix(path: string): string {
  return "'" + String(path).replace(/'/g, `'\\''`) + "'"
}

/** PowerShell 正文（多语句）；供本机 spawn 与 -Command 包装 */
export function buildRestartPowerShellBody(opts: {
  cwd: string
  command: string
  port: number
}): string {
  const cwd = String(opts.cwd || '')
  const cmd = String(opts.command || '').trim()
  const port = Number(opts.port)
  if (!cwd || !cmd || !(port >= 1024 && port <= 65535)) return ''
  return [
    `Set-Location -LiteralPath ${shellQuoteWin(cwd)}`,
    `$ccBe = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique`,
    `if ($ccBe) { $ccBe | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }; Start-Sleep -Seconds 1 }`,
    `Write-Host '[cursor-chat] restarting backend :${port}'`,
    cmd,
  ].join('; ')
}

export function buildRestartShellLines(opts: {
  cwd: string
  command: string
  port: number
  platform?: NodeJS.Platform
}): string[] {
  const cwd = String(opts.cwd || '')
  const cmd = String(opts.command || '').trim()
  const port = Number(opts.port)
  const platform = opts.platform || process.platform
  if (!cwd || !cmd || !(port >= 1024 && port <= 65535)) return []

  if (platform === 'win32') {
    const body = buildRestartPowerShellBody({ cwd, command: cmd, port })
    if (!body) return []
    // 单行：cmd.exe / PowerShell 应用终端都能执行（此前多行 PS 写进 cmd 等于没跑）
    return [
      `powershell -NoProfile -ExecutionPolicy Bypass -NoExit -Command ${JSON.stringify(body)}`,
    ]
  }
  return [
    `cd ${shellQuoteUnix(cwd)}`,
    `PIDS=$(lsof -nP -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null | tr '\\n' ' '); if [ -n "$PIDS" ]; then kill $PIDS 2>/dev/null || true; sleep 1; fi`,
    cmd,
  ]
}

/**
 * 门禁已过后由本机写码服务真正执行重启（可见终端窗，非「只签发」）。
 * Windows：新开 PowerShell -NoExit；Unix：detached shell。
 */
export function executeBackendRestart(offer: {
  cwd: string
  command: string
  port: number
  shell_lines?: string[]
  platform?: NodeJS.Platform
}): { ok: true; detail: string } | { ok: false; detail: string } {
  const cwd = String(offer.cwd || '')
  const cmd = String(offer.command || '').trim()
  const port = Number(offer.port)
  const platform = offer.platform || process.platform
  if (!cwd || !existsSync(cwd) || !cmd || !(port >= 1024 && port <= 65535)) {
    return { ok: false, detail: '重启参数无效（cwd/command/port）' }
  }

  try {
    if (platform === 'win32') {
      const body = buildRestartPowerShellBody({ cwd, command: cmd, port })
      if (!body) return { ok: false, detail: '无法生成 PowerShell 重启脚本' }
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-Command', body],
        {
          cwd,
          detached: true,
          stdio: 'ignore',
          windowsHide: false,
        },
      )
      child.unref()
      return {
        ok: true,
        detail: `已新开 PowerShell 执行重启（端口 ${port}，pid=${child.pid ?? '?'}）`,
      }
    }

    const lines = (offer.shell_lines && offer.shell_lines.length
      ? offer.shell_lines
      : buildRestartShellLines({ cwd, command: cmd, port, platform })
    ).filter(Boolean)
    if (!lines.length) return { ok: false, detail: '无法生成 shell 重启脚本' }
    const child = spawn('bash', ['-lc', lines.join('\n')], {
      cwd,
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    return {
      ok: true,
      detail: `已后台执行重启脚本（端口 ${port}，pid=${child.pid ?? '?'}）`,
    }
  } catch (err) {
    return { ok: false, detail: `执行重启失败：${String(err).slice(0, 200)}` }
  }
}

/** 有后端命中但无法解析启动方式时的纯文案（门禁未过，平台无法代重启） */
export function backendRestartHintText(hits: string[]): string {
  if (!hits.length) return ''
  const sample = hits.slice(0, 4).join('、')
  return (
    `【后端重启】本轮已改后端运行时代码（${sample}${hits.length > 4 ? '…' : ''}），` +
    `但未能解析本机 Vite 代理端口或 uvicorn 启动命令，平台无法自动重启。` +
    `请在工程目录按既有方式重启后端后再验收，否则接口仍可能 Not Found / 旧逻辑。`
  )
}

/**
 * 评估是否可自动经应用终端重启。
 * 文件命中放宽为 backend 运行时 .py；端口+启动命令仍必须可解析（防乱杀乱起）。
 */
export function evaluateBackendRestartOffer(opts: {
  workspace: string
  syncedFiles: string[]
  deletedFiles?: string[]
  platform?: NodeJS.Platform
}): BackendRestartOffer | null {
  const workspace = resolve(String(opts.workspace || '').trim())
  if (!workspace || !existsSync(workspace)) return null

  const hints = [...(opts.syncedFiles || []), ...(opts.deletedFiles || [])]
  const layout = detectProjectLayout(workspace, hints)
  const hits = listBackendRestartHits(opts.syncedFiles || [], opts.deletedFiles || [], layout)
  if (!hits.length) return null

  const backendRoot = resolveBackendRoot(workspace, hints)
  if (!backendRoot) return null

  const wsNorm = workspace.replace(/\\/g, '/').toLowerCase()
  const beNorm = backendRoot.replace(/\\/g, '/').toLowerCase()
  if (beNorm !== wsNorm && !beNorm.startsWith(wsNorm.endsWith('/') ? wsNorm : wsNorm + '/')) {
    return null
  }

  const port = readBackendPortFromViteProxy(workspace, hints)
  if (!port) return null

  const start = resolveUvicornStartCommand(backendRoot, port)
  if (!start) return null

  const shell_lines = buildRestartShellLines({
    cwd: backendRoot,
    command: start.command,
    port,
    platform: opts.platform,
  })
  if (!shell_lines.length) return null

  return {
    offered: true,
    reason: `本轮同步了后端代码（${hits.slice(0, 4).join('、')}${hits.length > 4 ? '…' : ''}），将由本机写码服务自动重启以加载新接口`,
    cwd: backendRoot,
    command: start.command,
    port,
    probe_url: `http://127.0.0.1:${port}/docs`,
    hit_files: hits.slice(0, 12),
    shell_lines,
    started_at: null,
    executed: false,
    done_at: null,
    last_detail: null,
  }
}

/**
 * 同步后统一结算：能出按钮则 offer；否则有命中则 hint。
 */
export function settleBackendRestartAfterSync(opts: {
  workspace: string
  syncedFiles: string[]
  deletedFiles?: string[]
  platform?: NodeJS.Platform
}): { offer: BackendRestartOffer | null; hint: string } {
  const workspace = resolve(String(opts.workspace || '').trim())
  const hints = [...(opts.syncedFiles || []), ...(opts.deletedFiles || [])]
  const layout = workspace ? detectProjectLayout(workspace, hints) : null
  const hits = listBackendRestartHits(opts.syncedFiles || [], opts.deletedFiles || [], layout)
  if (!hits.length) return { offer: null, hint: '' }
  const offer = evaluateBackendRestartOffer(opts)
  if (offer) return { offer, hint: '' }
  return { offer: null, hint: backendRestartHintText(hits) }
}

/**
 * 自动/手工下发重启前再次过门禁。
 * 允许 succeeded，或 failed 但本轮确有同步到后端文件（避免「代码已落盘却因其它原因 failed」丢重启入口）。
 */
export function assertBackendRestartReady(job: {
  status?: string
  workspace?: string
  synced_files?: string[]
  last_synced_files?: string[]
  deleted_files?: string[]
  backend_restart?: BackendRestartOffer | null
}):
  | { ok: true; offer: BackendRestartOffer }
  | { ok: false; detail: string; code: string } {
  const st = String(job.status || '')
  const synced = job.synced_files?.length ? job.synced_files : job.last_synced_files || []
  const hits = listBackendRestartHits(synced, job.deleted_files || [])
  if (st !== 'succeeded' && !(st === 'failed' && hits.length > 0)) {
    return { ok: false, detail: '当前任务状态不允许重启后端', code: 'bad_status' }
  }
  const prev = job.backend_restart
  if (!prev || prev.offered !== true) {
    return { ok: false, detail: '本轮未开放后端重启（门禁未过）', code: 'not_offered' }
  }
  if (prev.started_at) {
    return { ok: false, detail: '本轮已下发过重启，请到应用终端查看或续改后再试', code: 'already_started' }
  }
  const fresh = evaluateBackendRestartOffer({
    workspace: String(job.workspace || ''),
    syncedFiles: synced,
    deletedFiles: job.deleted_files || [],
  })
  if (!fresh) {
    return { ok: false, detail: '复检未通过：缺少后端变更或无法解析本机后端启动方式', code: 'recheck_failed' }
  }
  if (fresh.port !== prev.port || fresh.command !== prev.command || fresh.cwd !== prev.cwd) {
    return {
      ok: false,
      detail: '后端启动参数已变化，请刷新任务后重试',
      code: 'plan_changed',
    }
  }
  return { ok: true, offer: { ...prev, ...fresh, started_at: null, done_at: null } }
}
