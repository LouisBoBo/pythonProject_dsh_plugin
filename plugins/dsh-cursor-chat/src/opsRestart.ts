/**
 * 启动/重启不走 Cursor。SDK 接手要等本地执行器，接手后还会先搜仓库。
 * 这里只读项目里已经写好的命令，在对应目录后台拉起。找不到就不编命令。
 * 后续重启先看 docs/04-Cursor-AI-Coding逼真版本/重启服务方案.md；结构不同时沿用该项目自己的命令。
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { readBackendPortFromViteProxy, resolveBackendRoot, resolveUvicornStartCommand } from './backendRestart.js'

const PACKAGE_DIRS = ['frontend', 'web', 'client', 'apps/web', '']
const SCRIPT_NAMES = ['dev', 'start', 'serve'] as const
const UI_DIR_NAMES = new Set(['frontend', 'web', 'client'])

export type ServicePlan = {
  side: 'frontend' | 'backend' | 'app'
  cwd: string
  port: number | null
  label: string
  bin: string
  args: string[]
  /** 用来判断占用端口的进程是不是这一条命令 */
  markers: string[]
}

export type ServicePlanResult = {
  plans: ServicePlan[]
  notes: string[]
}

type PackageJson = {
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

function readJson(path: string): PackageJson | null {
  try {
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf8').slice(0, 200_000)
    const parsed = JSON.parse(raw) as PackageJson
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

function scriptIsSafe(command: string): boolean {
  const c = String(command || '').toLowerCase()
  if (!c.trim()) return false
  if (c.includes('pull-refresh')) return false
  if (/\bgit\s+(fetch|merge|pull|reset|checkout|clean)\b/.test(c)) return false
  return true
}

function readDevPort(dir: string): number | null {
  for (const name of ['vite.config.js', 'vite.config.ts', 'vite.config.mjs', 'vite.config.cjs']) {
    const path = join(dir, name)
    if (!existsSync(path)) continue
    try {
      const text = readFileSync(path, 'utf8').slice(0, 8000)
      const m = text.match(/port\s*:\s*(\d{2,5})/)
      if (!m) continue
      const port = Number(m[1])
      if (port >= 1 && port <= 65535) return port
    } catch {
      /* ignore */
    }
  }
  return null
}

function isUiPackage(dir: string, pkg: PackageJson): boolean {
  if (UI_DIR_NAMES.has(basename(dir).toLowerCase())) return true
  if (readDevPort(dir)) return true
  const deps = JSON.stringify({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) })
  return /vite|next|webpack|"vue"|react-scripts/.test(deps)
}

function pickScript(pkg: PackageJson): { name: string; command: string } | null {
  const scripts = pkg.scripts || {}
  for (const name of SCRIPT_NAMES) {
    const command = String(scripts[name] || '').trim()
    if (scriptIsSafe(command)) return { name, command }
  }
  return null
}

function resolveBin(name: string): string | null {
  if (process.platform === 'win32') {
    try {
      const out = execFileSync('where.exe', [name], {
        encoding: 'utf8',
        timeout: 4000,
        windowsHide: true,
      })
      const lines = out
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s && !/\\windowsapps\\/i.test(s))
      const exe = lines.find((s) => /\.exe$/i.test(s) && existsSync(s))
      if (name === 'python' || name === 'python3') return exe || null
      const cmd = lines.find((s) => /\.cmd$/i.test(s) && existsSync(s))
      if (cmd) return cmd
      const line = lines.find((s) => existsSync(s) || existsSync(`${s}.cmd`))
      if (!line) return null
      if (existsSync(`${line}.cmd`)) return `${line}.cmd`
      return existsSync(line) ? line : null
    } catch {
      return null
    }
  }
  try {
    // name 仅来自内部固定值（npm/python/python3），仍按参数传入避免拼进 -lc
    const out = execFileSync('/usr/bin/env', ['bash', '-lc', 'command -v -- "$1"', 'bash', name], {
      encoding: 'utf8',
      timeout: 4000,
    })
    const line = String(out || '').trim().split('\n')[0] || ''
    return line && existsSync(line) ? line : null
  } catch {
    return null
  }
}

function resolvePython(backendRoot: string, workspace: string): string | null {
  const candidates =
    process.platform === 'win32'
      ? [
          join(backendRoot, '.venv', 'Scripts', 'python.exe'),
          join(backendRoot, 'venv', 'Scripts', 'python.exe'),
          join(workspace, '.venv', 'Scripts', 'python.exe'),
        ]
      : [
          join(backendRoot, '.venv', 'bin', 'python'),
          join(backendRoot, 'venv', 'bin', 'python'),
          join(workspace, '.venv', 'bin', 'python'),
        ]
  for (const path of candidates) {
    if (existsSync(path)) return path
  }
  return resolveBin('python') || resolveBin('python3')
}

function planFrontend(workspace: string): ServicePlan | null {
  const npm = resolveBin('npm')
  if (!npm) return null
  for (const rel of PACKAGE_DIRS) {
    const dir = rel ? join(workspace, rel) : workspace
    if (!existsSync(dir)) continue
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    const pkg = readJson(join(dir, 'package.json'))
    if (!pkg || !isUiPackage(dir, pkg)) continue
    const script = pickScript(pkg)
    if (!script) continue
    const port = readDevPort(dir)
    return {
      side: 'frontend',
      cwd: dir,
      port,
      label: `前端 npm run ${script.name}${port ? ` :${port}` : ''}`,
      bin: npm,
      args: ['run', script.name],
      markers: ['vite.js', dir, script.command],
    }
  }
  return null
}

function planBackend(workspace: string): ServicePlan | null {
  const backendRoot = resolveBackendRoot(workspace)
  if (!backendRoot) return null
  const port = readBackendPortFromViteProxy(workspace)
  if (!port) return null
  const start = resolveUvicornStartCommand(backendRoot, port)
  const python = resolvePython(backendRoot, workspace)
  if (!python) return null
  if (!start) return planDjango(workspace, backendRoot, python, port)
  return {
    side: 'backend',
    cwd: backendRoot,
    port,
    label: `后端 ${start.module} :${port}`,
    bin: python,
    args: ['-m', 'uvicorn', start.module, '--host', '127.0.0.1', '--port', String(port), '--reload'],
    markers: [backendRoot, start.module],
  }
}

function planDjango(
  workspace: string,
  backendRoot: string,
  python: string,
  port: number,
): ServicePlan | null {
  const manage = join(backendRoot, 'manage.py')
  if (!existsSync(manage)) return null
  let text = ''
  try {
    text = readFileSync(manage, 'utf8').slice(0, 4000).toLowerCase()
  } catch {
    return null
  }
  if (!text.includes('django') && !text.includes('execute_from_command_line')) return null
  return {
    side: 'backend',
    cwd: backendRoot,
    port,
    label: `后端 django :${port}`,
    bin: python,
    args: ['manage.py', 'runserver', `127.0.0.1:${port}`],
    markers: [backendRoot, workspace, 'runserver'],
  }
}

function planApp(workspace: string): ServicePlan | null {
  const pkg = readJson(join(workspace, 'package.json'))
  if (!pkg) return null
  const script = pickScript(pkg)
  if (!script) return null
  const npm = resolveBin('npm')
  if (!npm) return null
  return {
    side: 'app',
    cwd: workspace,
    port: readDevPort(workspace),
    label: `npm run ${script.name}`,
    bin: npm,
    args: ['run', script.name],
    markers: [workspace, script.command],
  }
}

/**
 * 单仓 Python 应用（如 Gradio main.py）。无 vite/uvicorn 时也能按项目入口后台拉起，
 * 避免「重启」落到 Cursor 后先盲装一整包依赖卡住。
 */
function planPythonApp(workspace: string): ServicePlan | null {
  const python = resolvePython(workspace, workspace)
  if (!python) return null
  const names = ['main.py', 'app.py', 'server.py', 'run.py', 'webui.py']
  for (const name of names) {
    const file = join(workspace, name)
    if (!existsSync(file)) continue
    let text = ''
    try {
      text = readFileSync(file, 'utf8').slice(0, 16_000)
    } catch {
      continue
    }
    const hasMain = /if\s+__name__\s*==\s*['"]__main__['"]/.test(text)
    const isGradio = /(?:import\s+gradio|from\s+gradio|\.launch\s*\()/.test(text)
    const isFlask = /(?:Flask\s*\(|app\.run\s*\()/.test(text)
    const isStreamlit = /streamlit/i.test(text)
    if (!hasMain && !isGradio && !isFlask) continue
    if (isStreamlit) continue
    const portFromLaunch = text.match(/server_port\s*=\s*(\d{2,5})/)
    const portFromRun = text.match(/\.run\s*\([^)]*port\s*=\s*(\d{2,5})/)
    const portNum = Number((portFromLaunch || portFromRun)?.[1] || (isGradio ? 7860 : 0))
    const port = portNum >= 1 && portNum <= 65535 ? portNum : isGradio ? 7860 : null
    return {
      side: 'app',
      cwd: workspace,
      port,
      label: `Python ${name}${port ? ` :${port}` : ''}`,
      bin: python,
      args: [name],
      markers: [workspace, name, ...(isGradio ? ['gradio'] : [])],
    }
  }
  return null
}

function planFallbackApp(workspace: string): { plan: ServicePlan | null; note: string } {
  const npmApp = planApp(workspace)
  if (npmApp) {
    const pkg = readJson(join(workspace, 'package.json')) || {}
    if (!isUiPackage(workspace, pkg)) {
      return { plan: npmApp, note: '没有分开的前后端目录，改用仓库根目录的启动脚本' }
    }
  }
  const py = planPythonApp(workspace)
  if (py) return { plan: py, note: '没有前后端分仓命令，改用仓库根目录的 Python 入口' }
  return { plan: null, note: '' }
}

export function planProjectServices(
  workspace: string,
  expect: { frontend: boolean; backend: boolean },
): ServicePlanResult {
  const root = resolve(String(workspace || '').trim())
  const notes: string[] = []
  const plans: ServicePlan[] = []
  if (!root || !existsSync(root)) {
    return { plans, notes: ['工程路径不存在'] }
  }
  if (expect.backend) {
    const backend = planBackend(root)
    if (backend) plans.push(backend)
    else notes.push('项目里没有找到后端启动命令')
  }
  if (expect.frontend) {
    const frontend = planFrontend(root)
    if (frontend) plans.push(frontend)
    else notes.push('项目里没有找到前端启动命令')
  }
  if (!plans.length && !expect.frontend && !expect.backend) {
    const app = planApp(root) || planPythonApp(root)
    if (app) plans.push(app)
  }
  if (!plans.length && expect.frontend && expect.backend) {
    const fb = planFallbackApp(root)
    if (fb.plan) {
      plans.push(fb.plan)
      if (fb.note) notes.push(fb.note)
    }
  }
  return { plans, notes }
}

function quotePs(value: string): string {
  return "'" + String(value).replace(/'/g, "''") + "'"
}

function tailFile(path: string): string {
  try {
    return readFileSync(path, 'utf8').slice(-400).replace(/\s+/g, ' ').trim()
  } catch {
    return ''
  }
}

function isSafePort(port: number | null | undefined): port is number {
  return typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535
}

/**
 * 停进程只认本项目工作目录出现在命令行里。
 * 禁止「凡占端口就杀」或靠 vite.js 这类短词误伤其它本机服务。
 */
function projectNeedles(plan: ServicePlan): string[] {
  const needles = [plan.cwd, ...plan.markers]
    .map((item) => String(item || '').trim())
    .filter((item) => item.length >= 8)
  return Array.from(new Set(needles))
}

/** 与 Cursor IDE 相同：Start-Process，标准输出和错误分开落盘，进程脱离当前任务。 */
function launchWindows(workspace: string, plan: ServicePlan): { ok: true; pid: string } | { ok: false; detail: string } {
  const logDir = join(workspace, '.dev-logs')
  mkdirSync(logDir, { recursive: true })
  const outLog = join(logDir, `${plan.side}.log`)
  const errLog = join(logDir, `${plan.side}.err.log`)
  const pidFile = join(logDir, `${plan.side}.pid`)
  const needles = projectNeedles(plan)
  if (!needles.length) {
    return { ok: false, detail: '无法确认本项目进程标记，未杀进程也未启动' }
  }
  const argList = plan.args.map((arg) => quotePs(arg)).join(',')
  const needleList = needles.map((item) => quotePs(item.toLowerCase())).join(',')
  const stopPort =
    isSafePort(plan.port)
      ? [
          `$conns = @(Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort ${plan.port} -State Listen -ErrorAction SilentlyContinue)`,
          'foreach ($c in $conns) {',
          '  if (-not $c.OwningProcess) { continue }',
          '  $proc = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $c.OwningProcess) -ErrorAction SilentlyContinue',
          '  if (-not $proc -or -not $proc.CommandLine) { continue }',
          '  $line = $proc.CommandLine.ToLower()',
          '  $hit = $false',
          '  foreach ($n in $needles) { if ($line.Contains($n)) { $hit = $true; break } }',
          '  if ($hit) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue }',
          '}',
        ].join('\n')
      : ''
  const script = [
    "$ErrorActionPreference = 'Continue'",
    `$needles = @(${needleList})`,
    stopPort,
    "Get-CimInstance Win32_Process -Filter \"Name='python.exe' OR Name='node.exe' OR Name='cmd.exe'\" | Where-Object {",
    '  if ($_.ProcessId -eq $PID -or -not $_.CommandLine) { $false }',
    '  else {',
    '    $line = $_.CommandLine.ToLower()',
    '    $hit = $false',
    '    foreach ($n in $needles) { if ($line.Contains($n)) { $hit = $true; break } }',
    '    $hit',
    '  }',
    '} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }',
    'Start-Sleep -Seconds 1',
    `Remove-Item -LiteralPath ${quotePs(outLog)},${quotePs(errLog)} -ErrorAction SilentlyContinue`,
    `$p = Start-Process -FilePath ${quotePs(plan.bin)} -ArgumentList ${argList} -WorkingDirectory ${quotePs(plan.cwd)} -RedirectStandardOutput ${quotePs(outLog)} -RedirectStandardError ${quotePs(errLog)} -PassThru -WindowStyle Hidden`,
    `Set-Content -LiteralPath ${quotePs(pidFile)} -Value $p.Id`,
    'Write-Output $p.Id',
  ]
    .filter(Boolean)
    .join('\n')
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
      encoding: 'utf8',
      timeout: 40_000,
      windowsHide: true,
    })
    const pid = String(out || '')
      .trim()
      .split(/\s+/)
      .pop()
    if (!pid || !/^\d+$/.test(pid)) return { ok: true, pid: '' }
    return { ok: true, pid }
  } catch (err) {
    const text = String(err)
    if (/ETIMEDOUT|TIMEOUT/i.test(text)) return { ok: true, pid: '' }
    return { ok: false, detail: `启动失败：${text.slice(0, 180)}` }
  }
}

function spawnDetached(plan: ServicePlan, logPath: string): { ok: true; pid: number | undefined } | { ok: false; detail: string } {
  let fd: number | null = null
  try {
    mkdirSync(dirname(logPath), { recursive: true })
    fd = openSync(logPath, 'a')
  } catch {
    fd = null
  }
  let child: ChildProcess
  try {
    child = spawn(plan.bin, plan.args, {
      cwd: plan.cwd,
      detached: true,
      windowsHide: true,
      stdio: fd == null ? 'ignore' : ['ignore', fd, fd],
    })
  } catch (err) {
    if (fd != null) {
      try {
        closeSync(fd)
      } catch {
        /* ignore */
      }
    }
    return { ok: false, detail: `启动失败：${String(err).slice(0, 160)}` }
  }
  child.unref()
  if (fd != null) {
    try {
      closeSync(fd)
    } catch {
      /* ignore */
    }
  }
  child.on('error', () => {
    /* 已脱离的进程错误不能打崩宿主 */
  })
  return { ok: true, pid: child.pid }
}

async function serviceResponds(plan: ServicePlan): Promise<boolean> {
  if (!plan.port) return true
  const url =
    plan.side === 'backend'
      ? `http://127.0.0.1:${plan.port}/api/health`
      : `http://127.0.0.1:${plan.port}/`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
    return res.status > 0 && res.status < 500
  } catch {
    return false
  }
}

async function waitReady(
  workspace: string,
  plan: ServicePlan,
  isCancel?: () => boolean,
): Promise<{ ok: boolean; detail: string }> {
  if (!plan.port) return { ok: true, detail: `${plan.label} 已在后台执行` }
  const start = Date.now()
  while (Date.now() - start < 25_000) {
    if (isCancel?.()) return { ok: false, detail: '用户取消' }
    if (await serviceResponds(plan)) return { ok: true, detail: `${plan.label} 已在听` }
    await new Promise((r) => setTimeout(r, 400))
  }
  const err = tailFile(join(workspace, '.dev-logs', `${plan.side}.err.log`))
  return {
    ok: false,
    detail: err ? `${plan.label} 没有起来。${err}` : `${plan.label} 已执行，端口仍未响应`,
  }
}

function logFile(workspace: string, side: string): string {
  return join(workspace, '.dev-logs', `${side}.log`)
}

export type StartServicesResult = {
  ok: boolean
  detail: string
  /** 插件一张启动计划都认不出：可降级 Cursor IDE 式终端处理，禁止就此空手失败 */
  no_commands?: boolean
  /** 已认出命令但未全部起来：可降级 Cursor 灵活排障后再启 */
  start_failed?: boolean
}

/** 进度卡用：status 短文案；command 走 Shell 工具块展示命令与输出摘要 */
export type RestartProgressEvent = {
  type: 'status' | 'command'
  message?: string
  command?: string
  snippet?: string
  tool_status?: string
  call_id?: string
}

function planCommandLine(plan: ServicePlan): string {
  const args = plan.args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')
  return `${plan.bin}${args ? ` ${args}` : ''}`.trim()
}

export async function startRequestedServices(
  workspace: string,
  expect: { frontend: boolean; backend: boolean },
  isCancel?: () => boolean,
  onStatus?: (message: string) => void,
  onProgress?: (ev: RestartProgressEvent) => void,
): Promise<StartServicesResult> {
  const say = (message: string) => {
    // 有 onProgress 时只走它，避免与 onStatus 各推一次造成进度卡双份
    if (onProgress) onProgress({ type: 'status', message })
    else onStatus?.(message)
  }
  const root = resolve(String(workspace || '').trim())
  say('正在读取项目里的启动命令，不改代码…')
  const planned = planProjectServices(root, expect)
  if (!planned.plans.length) {
    const note = planned.notes.filter(Boolean).join('；')
    return {
      ok: false,
      no_commands: true,
      detail: `项目里没有找到启动命令，未改代码。${note || '请改由 Cursor 按项目现有方式处理。'}`,
    }
  }
  say(
    `已认出 ${planned.plans.length} 条启动命令：` +
      planned.plans.map((p) => `${p.label}${p.port ? ` :${p.port}` : ''}`).join('；'),
  )
  const lines: string[] = []
  for (const plan of planned.plans) {
    if (isCancel?.()) {
      return { ok: false, detail: '用户取消' }
    }
    const callId = `restart-${plan.side}-${Date.now()}`
    const cmdline = planCommandLine(plan)
    say(`正在拉起${plan.label}，请稍候`)
    onProgress?.({
      type: 'command',
      call_id: callId,
      command: `cd ${plan.cwd}\n${cmdline}`,
      tool_status: 'running',
      snippet: `工作目录 ${plan.cwd}${plan.port ? `\n端口 ${plan.port}` : ''}`,
    })
    let started =
      process.platform === 'win32'
        ? launchWindows(root, plan)
        : spawnDetached(plan, logFile(root, plan.side))
    // Windows 偶发 Start-Process 对 npm 失败：改用 npm.cmd 再试一次（不改其它计划）
    if (
      !started.ok &&
      process.platform === 'win32' &&
      plan.side === 'frontend' &&
      /(?:^|[\\/])npm(?:\.exe)?$/i.test(plan.bin) &&
      !/\.cmd$/i.test(plan.bin)
    ) {
      const retryPlan = { ...plan, bin: `${plan.bin.replace(/\.exe$/i, '')}.cmd` }
      say(`前端启动失败，改用 npm.cmd 再启一次`)
      onProgress?.({
        type: 'command',
        call_id: callId,
        command: `cd ${retryPlan.cwd}\n${planCommandLine(retryPlan)}`,
        tool_status: 'running',
        snippet: `上次失败：${started.detail}\n改用 npm.cmd 重试`,
      })
      started = launchWindows(root, retryPlan)
    }
    if (!started.ok) {
      const failedLine = `${plan.label}：${started.detail}`
      lines.push(failedLine)
      say(failedLine)
      onProgress?.({
        type: 'command',
        call_id: callId,
        command: `cd ${plan.cwd}\n${cmdline}`,
        tool_status: 'failed',
        snippet: started.detail.slice(0, 1200),
      })
      continue
    }
    const ready = await waitReady(root, plan, isCancel)
    if (ready.detail === '用户取消') {
      return { ok: false, detail: '用户取消' }
    }
    lines.push(ready.detail)
    say(ready.detail)
    const errTail = ready.ok ? '' : tailFile(join(root, '.dev-logs', `${plan.side}.err.log`))
    onProgress?.({
      type: 'command',
      call_id: callId,
      command: `cd ${plan.cwd}\n${cmdline}`,
      tool_status: ready.ok ? 'completed' : 'failed',
      snippet: (ready.ok
        ? `${ready.detail}${started.ok && 'pid' in started && started.pid ? `\nPID ${started.pid}` : ''}`
        : `${ready.detail}${errTail ? `\n${errTail}` : ''}`
      ).slice(0, 2000),
    })
  }
  const failed = lines.filter((line) => !line.includes('已在听') && !line.includes('已在后台执行'))
  const note = planned.notes.filter(Boolean).join('；')
  const detail = [`已按项目命令处理，未改代码。`, ...lines, note].filter(Boolean).join(' ')
  if (failed.length) {
    return { ok: false, start_failed: true, detail }
  }
  return { ok: true, detail }
}
