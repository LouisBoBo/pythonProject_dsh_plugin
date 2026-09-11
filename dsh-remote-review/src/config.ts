import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { FeishuConfig, RemoteReviewConfig } from './types.js'

export const HOOK_MARKER = 'managed-by: @zhongruan/dsh-remote-review'

export function defaultDataRoot(): string {
  return join(homedir(), '.zhongruan', 'remote-review')
}

function emptyConfig(): RemoteReviewConfig {
  const dataRoot = defaultDataRoot()
  return {
    engine: 'http://127.0.0.1:8000',
    listen: '127.0.0.1',
    port: 18787,
    secret: '',
    workspaceRoot: join(dataRoot, 'workspaces'),
    dataRoot,
    feishu: { appId: '', appSecret: '', folderToken: '' },
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

function mergeFeishu(base: FeishuConfig, raw: unknown, env: NodeJS.ProcessEnv): FeishuConfig {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    appId: env.FEISHU_APP_ID || asString(obj.appId, base.appId),
    appSecret: env.FEISHU_APP_SECRET || asString(obj.appSecret, base.appSecret),
    folderToken: env.FEISHU_FOLDER_TOKEN || asString(obj.folderToken, base.folderToken),
  }
}

export function loadConfig(): RemoteReviewConfig {
  const env = process.env
  const base = emptyConfig()
  const file = configPath(env.REMOTE_REVIEW_HOME || base.dataRoot)
  let disk: Record<string, unknown> = {}
  if (existsSync(file)) {
    try {
      disk = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    } catch {
      disk = {}
    }
  }
  const dataRoot = env.REMOTE_REVIEW_HOME || asString(disk.dataRoot, base.dataRoot)
  const cfg: RemoteReviewConfig = {
    engine: env.WORKBUDDY_ENGINE || asString(disk.engine, base.engine),
    listen: env.REMOTE_REVIEW_LISTEN || asString(disk.listen, base.listen),
    port: asNumber(env.REMOTE_REVIEW_PORT || disk.port, base.port),
    secret: env.REMOTE_REVIEW_SECRET || asString(disk.secret, base.secret),
    workspaceRoot: env.REMOTE_REVIEW_WORKSPACE || asString(disk.workspaceRoot, base.workspaceRoot),
    dataRoot,
    feishu: mergeFeishu(base.feishu, disk.feishu, env),
  }
  mkdirSync(cfg.dataRoot, { recursive: true })
  mkdirSync(cfg.workspaceRoot, { recursive: true })
  mkdirSync(join(cfg.dataRoot, 'jobs'), { recursive: true })
  mkdirSync(join(cfg.dataRoot, 'feishu-out'), { recursive: true })
  mkdirSync(join(cfg.dataRoot, 'logs'), { recursive: true })
  return cfg
}

export type ConfigPatch = {
  engine?: string
  listen?: string
  port?: number
  secret?: string
  workspaceRoot?: string
  dataRoot?: string
  feishu?: Partial<FeishuConfig>
}

export function saveConfig(partial: ConfigPatch): RemoteReviewConfig {
  const current = loadConfig()
  const next: RemoteReviewConfig = {
    ...current,
    ...partial,
    feishu: { ...current.feishu, ...(partial.feishu || {}) },
  }
  mkdirSync(next.dataRoot, { recursive: true })
  const toDisk = {
    engine: next.engine,
    listen: next.listen,
    port: next.port,
    secret: next.secret,
    workspaceRoot: next.workspaceRoot,
    dataRoot: next.dataRoot,
    feishu: next.feishu,
  }
  writeFileSync(configPath(next.dataRoot), JSON.stringify(toDisk, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  })
  try {
    chmodSync(configPath(next.dataRoot), 0o600)
  } catch {
    /* ignore */
  }
  return loadConfig()
}

export function maskSecret(value: string): string {
  const v = (value || '').trim()
  if (!v) return ''
  if (v.length <= 6) return '***'
  return `${v.slice(0, 3)}***${v.slice(-2)}`
}

export function publicConfigView(cfg: RemoteReviewConfig) {
  return {
    engine: cfg.engine,
    listen: cfg.listen,
    port: cfg.port,
    webhook: `http://${cfg.listen}:${cfg.port}/webhook`,
    secretConfigured: Boolean(cfg.secret),
    workspaceRoot: cfg.workspaceRoot,
    dataRoot: cfg.dataRoot,
    feishuAppId: maskSecret(cfg.feishu.appId),
    feishuAppSecret: cfg.feishu.appSecret ? '已配置' : '未配置',
    feishuFolderToken: maskSecret(cfg.feishu.folderToken),
    feishuReady: Boolean(cfg.feishu.appId && cfg.feishu.appSecret),
  }
}

/** 给设置界面用：密钥不回传明文，已配置时用空串 + *Configured 标记 */
export function editableConfigView(cfg: RemoteReviewConfig) {
  return {
    engine: cfg.engine,
    listen: cfg.listen,
    port: cfg.port,
    secret: '',
    secretConfigured: Boolean(cfg.secret.trim()),
    feishuAppId: cfg.feishu.appId,
    feishuAppSecret: '',
    feishuAppSecretConfigured: Boolean(cfg.feishu.appSecret.trim()),
    feishuFolderToken: cfg.feishu.folderToken,
    webhook: `http://${cfg.listen}:${cfg.port}/webhook`,
    dataRoot: cfg.dataRoot,
    feishuReady: feishuReady(cfg),
  }
}

function keepOrReplace(incoming: unknown, current: string): string {
  const s = typeof incoming === 'string' ? incoming.trim() : ''
  if (!s) return current
  if (s === '***' || s === '（已配置，留空则保持不变）' || /^•+$/.test(s)) return current
  return s
}

/** 设置页保存：空密钥字段表示保持原值 */
export function applyConfigFromUi(body: Record<string, unknown>): RemoteReviewConfig {
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
  return saveConfig({
    engine: typeof body.engine === 'string' && body.engine.trim() ? body.engine.trim() : current.engine,
    listen: typeof body.listen === 'string' && body.listen.trim() ? body.listen.trim() : current.listen,
    port,
    secret: keepOrReplace(body.secret, current.secret),
    feishu: {
      appId: keepOrReplace(body.feishuAppId, current.feishu.appId),
      appSecret: keepOrReplace(body.feishuAppSecret, current.feishu.appSecret),
      folderToken: keepOrReplace(body.feishuFolderToken, current.feishu.folderToken),
    },
  })
}

export function feishuReady(cfg: RemoteReviewConfig): boolean {
  return Boolean(cfg.feishu.appId.trim() && cfg.feishu.appSecret.trim())
}
