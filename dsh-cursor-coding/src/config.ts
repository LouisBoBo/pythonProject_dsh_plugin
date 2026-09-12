import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CursorCodingConfig } from './types.js'

export const SERVICE_NAME = 'dsh-cursor-coding'
export const DEFAULT_PORT = 18788

export function defaultDataRoot(): string {
  return join(homedir(), '.zhongruan', 'cursor-coding')
}

function emptyConfig(): CursorCodingConfig {
  const dataRoot = defaultDataRoot()
  return {
    listen: '127.0.0.1',
    port: DEFAULT_PORT,
    dataRoot,
    cursorApiKey: '',
    writeScope: [],
    model: 'composer-2.5',
  }
}

function configPath(dataRoot?: string): string {
  return join(dataRoot || defaultDataRoot(), 'config.json')
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function asNumber(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => String(x || '').trim()).filter(Boolean)
}

export function ensureDataDirs(cfg: CursorCodingConfig): void {
  mkdirSync(cfg.dataRoot, { recursive: true })
  mkdirSync(join(cfg.dataRoot, 'jobs'), { recursive: true })
  mkdirSync(join(cfg.dataRoot, 'sandboxes'), { recursive: true })
  mkdirSync(join(cfg.dataRoot, 'logs'), { recursive: true })
}

export function loadConfig(): CursorCodingConfig {
  const env = process.env
  const base = emptyConfig()
  const home = env.CURSOR_CODING_HOME || base.dataRoot
  const file = configPath(home)
  let disk: Record<string, unknown> = {}
  if (existsSync(file)) {
    try {
      disk = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    } catch {
      disk = {}
    }
  }
  const dataRoot = env.CURSOR_CODING_HOME || asString(disk.dataRoot, base.dataRoot)
  const listenRaw = env.CURSOR_CODING_LISTEN || asString(disk.listen, base.listen)
  const listen =
    listenRaw === 'localhost' || listenRaw === '127.0.0.1'
      ? listenRaw === 'localhost'
        ? '127.0.0.1'
        : listenRaw
      : '127.0.0.1'
  const cfg: CursorCodingConfig = {
    listen,
    port: asNumber(env.CURSOR_CODING_PORT || disk.port, base.port),
    dataRoot,
    cursorApiKey: env.CURSOR_API_KEY || asString(disk.cursorApiKey, base.cursorApiKey),
    writeScope: asStringArray(disk.writeScope),
    model: env.CURSOR_CODING_MODEL || asString(disk.model, base.model) || 'composer-2.5',
  }
  ensureDataDirs(cfg)
  return cfg
}

export type ConfigPatch = Partial<
  Pick<CursorCodingConfig, 'listen' | 'port' | 'dataRoot' | 'cursorApiKey' | 'writeScope' | 'model'>
>

export function saveConfig(partial: ConfigPatch): CursorCodingConfig {
  const current = loadConfig()
  const next: CursorCodingConfig = {
    ...current,
    ...partial,
    writeScope: partial.writeScope !== undefined ? partial.writeScope : current.writeScope,
  }
  ensureDataDirs(next)
  const toDisk = {
    listen: next.listen,
    port: next.port,
    dataRoot: next.dataRoot,
    cursorApiKey: next.cursorApiKey,
    writeScope: next.writeScope,
    model: next.model,
  }
  const path = configPath(next.dataRoot)
  writeFileSync(path, JSON.stringify(toDisk, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  })
  try {
    chmodSync(path, 0o600)
  } catch {
    /* ignore */
  }
  return loadConfig()
}

export function maskSecret(value: string): string {
  const v = (value || '').trim()
  if (!v) return ''
  if (v.length <= 8) return '********'
  return `${v.slice(0, 4)}…${v.slice(-4)}`
}

export function cursorKeyReady(cfg: CursorCodingConfig): boolean {
  const k = cfg.cursorApiKey.trim()
  if (!k) return false
  // Mock 自检允许任意非空 Key；正式运行拒绝 test-* 伪装成已配置
  if (process.env.CURSOR_CODING_MOCK === '1') return true
  if (k === 'test-key-not-real' || /^test-/i.test(k)) return false
  return true
}

/** 对外公开视图：不回传 Key 明文 */
export function publicConfigView(cfg: CursorCodingConfig) {
  const reuseRaw = String(process.env.CURSOR_CODING_REUSE_PARENT || '').trim().toLowerCase()
  const reuseParentSandbox = !(
    reuseRaw === '0' ||
    reuseRaw === 'false' ||
    reuseRaw === 'off' ||
    reuseRaw === 'no'
  )
  return {
    service: SERVICE_NAME,
    listen: cfg.listen,
    port: cfg.port,
    base: `http://${cfg.listen}:${cfg.port}`,
    dataRoot: cfg.dataRoot,
    cursorKeyConfigured: cursorKeyReady(cfg),
    writeScope: cfg.writeScope,
    model: cfg.model,
    reuseParentSandbox,
    stage: 'F-enterprise-ux',
  }
}

/** 设置页：已配置时用空串 + configured 标记，避免明文回显 */
export function editableConfigView(cfg: CursorCodingConfig) {
  return {
    listen: cfg.listen,
    port: cfg.port,
    dataRoot: cfg.dataRoot,
    cursorApiKey: '',
    cursorKeyConfigured: cursorKeyReady(cfg),
    writeScopeText: cfg.writeScope.join('\n'),
    model: cfg.model,
    base: `http://${cfg.listen}:${cfg.port}`,
  }
}

function keepOrReplace(incoming: unknown, current: string): string {
  const s = typeof incoming === 'string' ? incoming.trim() : ''
  if (!s) return current
  if (s === '***' || /^•+$/.test(s) || s.includes('…')) return current
  return s
}

/** 设置页保存：空 Key 表示保持原值；不允许保存空 Key 覆盖已有（须显式 clearCursorKey） */
export function applyConfigFromUi(body: Record<string, unknown>): CursorCodingConfig {
  const current = loadConfig()
  const portRaw = body.port
  let port = current.port
  if (portRaw !== undefined && portRaw !== null && String(portRaw).trim() !== '') {
    const n = Number(portRaw)
    if (!Number.isInteger(n) || n <= 0 || n > 65535) {
      throw new Error(`端口非法：${portRaw}`)
    }
    port = n
  }
  let cursorApiKey = current.cursorApiKey
  if (body.clearCursorKey === true || body.clearCursorKey === '1') {
    cursorApiKey = ''
  } else {
    cursorApiKey = keepOrReplace(body.cursorApiKey, current.cursorApiKey)
  }
  let writeScope = current.writeScope
  if (typeof body.writeScopeText === 'string') {
    writeScope = body.writeScopeText
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  } else if (Array.isArray(body.writeScope)) {
    writeScope = asStringArray(body.writeScope)
  }
  const listen =
    typeof body.listen === 'string' && body.listen.trim() ? body.listen.trim() : current.listen
  if (listen !== '127.0.0.1' && listen !== 'localhost') {
    throw new Error('安全要求：listen 仅允许 127.0.0.1 或 localhost')
  }
  return saveConfig({
    listen: listen === 'localhost' ? '127.0.0.1' : listen,
    port,
    cursorApiKey,
    writeScope,
    model:
      typeof body.model === 'string' && body.model.trim() ? body.model.trim() : current.model,
  })
}
