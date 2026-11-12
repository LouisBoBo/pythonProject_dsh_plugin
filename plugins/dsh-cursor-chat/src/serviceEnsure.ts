/**
 * 同步到真实项目之后确认服务。
 * 后端代码有改动且端口上没有进程时，才按 uvicorn 命令拉起。已经在监听则不杀不重启。
 * 接口是否加载由审计探测读运行中的文档，这里不重复核对路径。
 */
import { existsSync, readFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { join } from 'node:path'
import {
  executeBackendRestart,
  listBackendRestartHits,
  readBackendPortFromViteProxy,
  resolveBackendRoot,
  resolveUvicornStartCommand,
} from './backendRestart.js'
import { type CursorRunEvent } from './cursor/runner.js'
import { normalizeRel } from './pathScope.js'

export type ServiceCheck = {
  /** 本轮改了后端，或前端端口没人听且本轮动了前端 */
  required: boolean
  ok: boolean
  /** Mock / 无需要求时不做终端回合 */
  skipped?: boolean
  detail: string
  frontend: string
  backend: string
  api: string
}

const FRONT_MARKERS = ['frontend/', 'src/views/', 'src/router/', 'src/layouts/', 'src/api/']

function normRel(raw: string): string {
  return String(raw || '')
    .replace(/\\/g, '/')
    .replace(/^删除\s*/, '')
    .replace(/^\.\//, '')
    .trim()
}

export function listFrontendTouch(synced: string[], deleted: string[] = []): string[] {
  const out: string[] = []
  for (const raw of [...synced, ...deleted]) {
    const rel = normRel(raw)
    if (!rel) continue
    if (FRONT_MARKERS.some((m) => rel.startsWith(m))) out.push(rel)
    else if (/\.(vue|jsx|tsx|css)$/.test(rel) && rel.includes('/src/')) out.push(rel)
  }
  return out
}

export function readFrontendDevPort(workspace: string): number | null {
  const configs = [
    join(workspace, 'frontend', 'vite.config.js'),
    join(workspace, 'frontend', 'vite.config.ts'),
    join(workspace, 'frontend', 'vite.config.mjs'),
    join(workspace, 'vite.config.js'),
    join(workspace, 'vite.config.ts'),
  ]
  for (const p of configs) {
    if (!existsSync(p)) continue
    try {
      const text = readFileSync(p, 'utf8').slice(0, 8000)
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

export function portOpen(port: number, host = '127.0.0.1'): Promise<boolean> {
  if (!(port > 0 && port <= 65535)) return Promise.resolve(false)
  return new Promise((resolve) => {
    const socket = createConnection({ port, host })
    const finish = (ok: boolean) => {
      socket.removeAllListeners()
      try {
        socket.destroy()
      } catch {
        /* ignore */
      }
      resolve(ok)
    }
    socket.setTimeout(1200)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

/** 从新增路由文件里抽出路径，用来核对正在跑的 openapi。抽不出就不拿路径当失败条件。 */
export function extractRoutePaths(fileText: string): string[] {
  const text = String(fileText || '')
  const prefixMatch = text.match(/APIRouter\([^)]*prefix\s*=\s*['"]([^'"]+)['"]/i)
  const prefix = prefixMatch ? prefixMatch[1]!.replace(/\/$/, '') : ''
  const found: string[] = []
  const re = /@(?:router|app)\.(?:get|post|put|delete|patch|api_route)\(\s*['"]([^'"]+)['"]/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    let path = m[1] || ''
    if (!path.startsWith('/')) path = `/${path}`
    if (prefix && !path.startsWith(prefix)) path = `${prefix}${path === '/' ? '' : path}`
    if (!found.includes(path)) found.push(path)
  }
  return found
}

export function collectRoutePaths(workspace: string, files: string[]): string[] {
  const paths: string[] = []
  for (const raw of files) {
    const rel = normalizeRel(raw)
    if (!rel || !/\.py$/i.test(rel)) continue
    const full = join(workspace, rel)
    if (!existsSync(full)) continue
    let text = ''
    try {
      text = readFileSync(full, 'utf8').slice(0, 80_000)
    } catch {
      continue
    }
    if (!text.includes('APIRouter')) continue
    for (const p of extractRoutePaths(text)) {
      if (!paths.includes(p)) paths.push(p)
    }
  }
  return paths
}

/** 热重载完成前，正在跑的文档仍是旧进程。等到本轮路径出现，或超过这段时间仍没有。 */
export const ROUTE_RELOAD_WAIT_MS = 30_000

const OPENAPI_BODY_CAP = 2_000_000

/**
 * 读正在跑的 openapi，直到本轮路径都出现。
 * 端口开着只说明旧进程还在；`--reload` 换进程要几秒到几十秒，第一次读到的文档不能当结论。
 */
export async function openApiBodyWithRoutes(
  port: number,
  routePaths: string[],
  options: {
    timeoutMs?: number
    intervalMs?: number
    fetchImpl?: typeof fetch
    sleep?: (ms: number) => Promise<void>
    now?: () => number
  } = {},
): Promise<{ body: string; missing: string[] }> {
  const timeoutMs = options.timeoutMs ?? ROUTE_RELOAD_WAIT_MS
  const intervalMs = options.intervalMs ?? 1_000
  const fetchImpl = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const now = options.now ?? Date.now
  const deadline = now() + Math.max(0, timeoutMs)
  let body = ''
  const missingOf = (text: string): string[] => routePaths.filter((p) => !text.includes(p))
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { body, missing: missingOf(body) }
  }
  for (;;) {
    try {
      const res = await fetchImpl(`http://127.0.0.1:${port}/openapi.json`, {
        redirect: 'manual',
        signal: AbortSignal.timeout(4_000),
      })
      if (res.status === 200) {
        body = await readCappedText(res, OPENAPI_BODY_CAP)
        const missing = missingOf(body)
        if (missing.length === 0) return { body, missing }
      }
    } catch {
      /* 热重载空窗：旧进程已停、新进程还没听上 */
    }
    if (now() >= deadline) return { body, missing: missingOf(body) }
    await sleep(Math.max(0, intervalMs))
  }
}

async function readCappedText(res: Response, cap: number): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return (await res.text()).slice(0, cap)
  const parts: Uint8Array[] = []
  let size = 0
  try {
    while (size < cap) {
      const { done, value } = await reader.read()
      if (done || !value) break
      const take = Math.min(value.byteLength, cap - size)
      parts.push(take === value.byteLength ? value : value.subarray(0, take))
      size += take
      if (take < value.byteLength) break
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  const merged = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    merged.set(part, offset)
    offset += part.byteLength
  }
  return new TextDecoder().decode(merged)
}

async function fetchText(url: string): Promise<{ status: number; body: string }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
    const body = await res.text()
    return { status: res.status, body: body.slice(0, 200_000) }
  } catch {
    return { status: 0, body: '' }
  }
}

export async function assessBackend(
  port: number,
  routePaths: string[],
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<{ ok: boolean; backend: string; api: string }> {
  let openapi = { status: 0, body: '' }
  let docs = { status: 0, body: '' }
  for (let i = 0; i < 6; i++) {
    openapi = await fetchText(`http://127.0.0.1:${port}/openapi.json`)
    docs = await fetchText(`http://127.0.0.1:${port}/docs`)
    if (openapi.status === 200 || docs.status === 200) break
    await new Promise((r) => setTimeout(r, 2000))
  }
  const up = openapi.status === 200 || docs.status === 200
  const backend = up
    ? `开着，端口 ${port}，文档可打开`
    : `端口 ${port} 上没有可用的后台（文档打不开）`
  if (!up) return { ok: false, backend, api: '后台没起来，接口无法确认' }
  if (!routePaths.length) return { ok: true, backend, api: '文档可打开（本轮没有抽出新路径）' }
  const settled = await openApiBodyWithRoutes(port, routePaths, options)
  const body = settled.body
  const missing = settled.missing
  if (!body) {
    return { ok: false, backend, api: '文档页开了，但没有拿到 openapi，不能确认新接口已加载' }
  }
  if (missing.length) {
    return {
      ok: false,
      backend,
      api: `正在跑的文档里还没有：${missing.slice(0, 6).join('、')}`,
    }
  }
  return { ok: true, backend, api: `新接口已在正在跑的文档里：${routePaths.slice(0, 6).join('、')}` }
}

function venvPython(backendRoot: string | null): string {
  if (!backendRoot) return ''
  for (const rel of [
    join(backendRoot, '.venv', 'Scripts', 'python.exe'),
    join(backendRoot, 'venv', 'Scripts', 'python.exe'),
    join(backendRoot, '.venv', 'bin', 'python'),
    join(backendRoot, 'venv', 'bin', 'python'),
  ]) {
    if (existsSync(rel)) return rel
  }
  return ''
}

export function buildServicePrompt(opts: {
  workspace: string
  backendFiles: string[]
  frontendFiles: string[]
  backendPort: number | null
  frontendPort: number | null
  frontendUp: boolean
  backendRoot: string | null
  pythonExe: string
  hintCommand: string
}): string {
  const be = opts.backendFiles.length ? opts.backendFiles.slice(0, 20).join('\n') : '（本轮没有后端文件）'
  const fe = opts.frontendFiles.length ? opts.frontendFiles.slice(0, 12).join('\n') : '（本轮没有前端文件）'
  return (
    `你只负责把用户正在用的项目服务跑通。工作目录就是这个真实项目：${opts.workspace}\n` +
    `禁止修改、创建、删除任何文件。禁止 git commit / push。禁止再改代码。\n` +
    `长驻进程必须放在后台启动（启动后立刻返回），本回合结束后进程仍要活着。禁止前台挂住 uvicorn 或 npm run dev。\n` +
    `禁止换端口，禁止再起一个第二套服务。\n\n` +
    `【本轮后端文件】\n${be}\n\n` +
    `【本轮前端文件】\n${fe}\n\n` +
    `【已知情况】\n` +
    `- 后端端口：${opts.backendPort ?? '未知，请读 frontend/vite.config 里的 proxy target，只认 127.0.0.1 或 localhost'}\n` +
    `- 后端目录：${opts.backendRoot || '未知'}\n` +
    `- 优先使用的 Python：${opts.pythonExe || '项目虚拟环境里的 python，不要用一个对不上的系统 python'}\n` +
    `- 可参考的启动命令：${opts.hintCommand || '沿用项目里现有的 uvicorn 启动方式，带上原来的端口'}\n` +
    `- 前端端口：${opts.frontendPort ?? '未知'}，当前${opts.frontendUp ? '已经有进程在听，不要重启前端' : '没有进程在听'}\n\n` +
    `【要做的事】\n` +
    `1. 用 shell 看上述端口。前端已经在听就不要动前端。\n` +
    `2. 上面列出了后端文件时：停掉占用后端端口、且工作目录在本项目里的那个进程，再用项目自己的 Python、原来的端口，在终端后台重新启动后端。\n` +
    `3. 没有列出后端文件时，不要重启后端。\n` +
    `4. 前端端口没人听、并且知道端口时：按项目现有命令在终端后台启动前端，不要换端口。\n` +
    `5. 用 curl 看前端首页、后端 /docs 或 /openapi.json。确认完就结束，不要空等日志。\n` +
    `最后用三行中文汇报：前端、后端、接口。汇报不算完成，端口以实际监听为准。\n`
  )
}


/** 端口上已经有进程时只审计，不杀不重启。 */
export function shouldKeepRunningBackend(listening: boolean): boolean {
  return listening
}

async function waitForHttp(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
      if (res.status === 200) return true
    } catch {
      /* 重启空窗 */
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  return false
}

export async function runServiceCheck(opts: {
  workspace: string
  syncedFiles: string[]
  deletedFiles?: string[]
  apiKey: string
  model?: string
  onEvent: (ev: CursorRunEvent) => void
  isCancel: () => boolean
}): Promise<ServiceCheck> {
  const synced = opts.syncedFiles || []
  const deleted = opts.deletedFiles || []
  const backendFiles = listBackendRestartHits(synced, deleted)
  const frontendPort = readFrontendDevPort(opts.workspace)
  const frontendUp = frontendPort ? await portOpen(frontendPort) : false
  const needBackend = backendFiles.length > 0
  // 前端没开不再另开 Cursor 去 npm run dev。审计探测会写实测结果。
  if (!needBackend) {
    return {
      required: false,
      ok: true,
      skipped: true,
      detail: '',
      frontend: frontendPort
        ? frontendUp
          ? `开着，端口 ${frontendPort}`
          : `端口 ${frontendPort} 未监听`
        : '未识别前端端口',
      backend: '本轮没有后端改动',
      api: '',
    }
  }

  if (process.env.CURSOR_CHAT_MOCK === '1') {
    return {
      required: true,
      ok: true,
      skipped: true,
      detail: '自检模式不重启后端',
      frontend: '',
      backend: '',
      api: '',
    }
  }

  const backendPort = readBackendPortFromViteProxy(opts.workspace)
  const backendRoot = resolveBackendRoot(opts.workspace)
  const pythonExe = venvPython(backendRoot)
  const hinted = backendPort && backendRoot ? resolveUvicornStartCommand(backendRoot, backendPort) : null
  const frontendLine = !frontendPort
    ? '未从 Vite 配置识别前端端口'
    : frontendUp
      ? `开着，端口 ${frontendPort}`
      : `端口 ${frontendPort} 未监听`
  if (!backendPort || !backendRoot || !hinted) {
    return {
      required: true,
      ok: false,
      detail: '代码已同步，但未能解析本机后端端口或启动命令，没有重启。',
      frontend: frontendLine,
      backend: '未重启',
      api: '',
    }
  }

  const alreadyUp = await portOpen(backendPort)
  if (shouldKeepRunningBackend(alreadyUp)) {
    opts.onEvent({
      type: 'status',
      message: `后台已在 :${backendPort} 监听，不重启，直接审计`,
    })
    return {
      required: true,
      ok: true,
      detail: `后台已在端口 ${backendPort} 监听，未重启`,
      frontend: frontendLine,
      backend: `开着，端口 ${backendPort}，未重启`,
      api: '',
    }
  }

  const command = pythonExe
    ? `& '${pythonExe.replace(/'/g, "''")}' -m uvicorn ${hinted.module} --host 127.0.0.1 --port ${backendPort} --reload`
    : hinted.command
  opts.onEvent({
    type: 'status',
    message: `代码已同步。正在按项目命令重启后台 :${backendPort}…`,
  })
  const exec = executeBackendRestart({ cwd: backendRoot, command, port: backendPort })
  if (!exec.ok) {
    return {
      required: true,
      ok: false,
      detail: exec.detail,
      frontend: frontendLine,
      backend: '未重启',
      api: '',
    }
  }
  // 先留出停旧进程的空窗，避免把还没杀掉的旧文档当成新代码已加载。
  await new Promise((r) => setTimeout(r, 2000))
  const ready =
    (await waitForHttp(`http://127.0.0.1:${backendPort}/openapi.json`, 12_000)) ||
    (await waitForHttp(`http://127.0.0.1:${backendPort}/docs`, 4_000))
  return {
    required: true,
    ok: ready,
    detail: ready
      ? `已按项目命令重启后台，端口 ${backendPort}`
      : `已按项目命令重启后台，但端口 ${backendPort} 没有重新打开文档`,
    frontend: frontendLine,
    backend: ready ? `已重启，端口 ${backendPort}` : `重启后端口 ${backendPort} 未就绪`,
    api: '',
  }
}
