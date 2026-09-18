import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AutomationsConfig } from './types.js'
import { asBool, asNumber, asString } from './util.js'
import { readWorkbuddyCreds } from './workbuddy_config.js'
import { yuqueAuthView } from './yuque_docs.js'

export const DEFAULT_PORT = 18789

export function pluginVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
    return String((JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }).version || '')
  } catch {
    return ''
  }
}

export function defaultDataRoot(): string {
  return join(homedir(), '.zhongruan', 'automations')
}

function emptyConfig(): AutomationsConfig {
  return {
    listen: '127.0.0.1',
    port: DEFAULT_PORT,
    dataRoot: defaultDataRoot(),
    schedulerEnabled: true,
    tickSec: 30,
    llmBaseUrl: '',
    llmApiKey: '',
    llmModel: 'deepseek-chat',
    zhipuApiKey: '',
    zhipuBaseUrl: '',
    wecomPushEnabled: false,
    wecomWebhookKey: '',
    wecomDryRun: true,
    mesBaseUrl: '',
  }
}

function configPath(dataRoot?: string): string {
  return join(dataRoot || defaultDataRoot(), 'config.json')
}

function clampListen(raw: string): string {
  const s = raw.trim() || '127.0.0.1'
  if (s === 'localhost' || s === '127.0.0.1') return '127.0.0.1'
  // P0 只绑回环，避免误开 0.0.0.0 把管理口暴露出去
  return '127.0.0.1'
}

export function loadConfig(overrideRoot?: string): AutomationsConfig {
  const env = process.env
  const base = emptyConfig()
  const file = configPath(overrideRoot || env.DSH_AUTOMATIONS_HOME || base.dataRoot)
  let disk: Record<string, unknown> = {}
  if (existsSync(file)) {
    try {
      disk = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    } catch {
      disk = {}
    }
  }
  const dataRoot = overrideRoot || env.DSH_AUTOMATIONS_HOME || asString(disk.dataRoot, base.dataRoot)
  const tick = Math.max(5, asNumber(env.AUTOMATIONS_TICK_SEC || disk.tickSec, base.tickSec))
  const cfg: AutomationsConfig = {
    listen: clampListen(env.DSH_AUTOMATIONS_LISTEN || asString(disk.listen, base.listen)),
    port: asNumber(env.DSH_AUTOMATIONS_PORT || disk.port, base.port),
    dataRoot,
    schedulerEnabled: asBool(
      env.AUTOMATIONS_SCHEDULER_ENABLED ?? disk.schedulerEnabled,
      base.schedulerEnabled,
    ),
    tickSec: tick,
    llmBaseUrl: env.DSH_AUTOMATIONS_LLM_BASE_URL || asString(disk.llmBaseUrl, base.llmBaseUrl),
    llmApiKey: env.DSH_AUTOMATIONS_LLM_API_KEY || asString(disk.llmApiKey, base.llmApiKey),
    llmModel: env.DSH_AUTOMATIONS_LLM_MODEL || asString(disk.llmModel, base.llmModel),
    zhipuApiKey: env.ZHIPU_API_KEY || env.BIGMODEL_API_KEY || asString(disk.zhipuApiKey, base.zhipuApiKey),
    zhipuBaseUrl: env.ZHIPU_BASE_URL || env.VISION_BASE_URL || asString(disk.zhipuBaseUrl, base.zhipuBaseUrl),
    wecomPushEnabled: asBool(env.WECOM_PUSH_ENABLED ?? disk.wecomPushEnabled, base.wecomPushEnabled),
    wecomWebhookKey: env.WECOM_WEBHOOK_KEY || asString(disk.wecomWebhookKey, base.wecomWebhookKey),
    wecomDryRun: asBool(env.WECOM_PUSH_DRY_RUN ?? disk.wecomDryRun, base.wecomDryRun),
    mesBaseUrl: env.MES_BASE_URL || asString(disk.mesBaseUrl, base.mesBaseUrl),
  }
  mkdirSync(cfg.dataRoot, { recursive: true })
  mkdirSync(join(cfg.dataRoot, 'logs'), { recursive: true })
  return cfg
}

export type ConfigPatch = Partial<AutomationsConfig>

export function saveConfig(partial: ConfigPatch, overrideRoot?: string): AutomationsConfig {
  const current = loadConfig(overrideRoot)
  const next: AutomationsConfig = {
    ...current,
    ...partial,
    listen: clampListen(partial.listen ?? current.listen),
  }
  mkdirSync(next.dataRoot, { recursive: true })
  const toDisk = { ...next }
  writeFileSync(configPath(next.dataRoot), JSON.stringify(toDisk, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  })
  try {
    chmodSync(configPath(next.dataRoot), 0o600)
  } catch {
    /* ignore */
  }
  return loadConfig(overrideRoot || next.dataRoot)
}

export function maskSecret(value: string): string {
  const v = (value || '').trim()
  if (!v) return ''
  if (v.length <= 6) return '***'
  return `${v.slice(0, 3)}***${v.slice(-2)}`
}

export type MesSettings = {
  baseUrl: string
  fromWorkbuddy: boolean
  authType: string
  username: string
  password: string
  token: string
  enterpriseCode: string
  timeoutMs: number
}

/** MES / LLM / 企微等业务连接只认 WorkBuddy 系统配置；插件磁盘仅作空缺兜底。 */
export function resolveMesSettings(): MesSettings {
  const cfg = loadConfig()
  const wb = readWorkbuddyCreds()
  const env = (process.env.MES_BASE_URL || '').trim()
  const plugin = cfg.mesBaseUrl.trim()
  const baseUrl = (wb.mesBaseUrl || env || plugin).replace(/\/+$/, '')
  return {
    baseUrl,
    fromWorkbuddy: Boolean(wb.mesBaseUrl),
    authType: wb.mesAuthType || 'password',
    username: wb.mesUsername,
    password: wb.mesPassword,
    token: wb.mesToken,
    enterpriseCode: wb.mesEnterpriseCode || '江西中软',
    timeoutMs: Math.max(5, wb.mesTimeoutSec || 30) * 1000,
  }
}

export function publicConfigView(cfg: AutomationsConfig) {
  const wb = readWorkbuddyCreds()
  const mes = resolveMesSettings()
  const yuque = yuqueAuthView(cfg.dataRoot)
  const llmKey = cfg.llmApiKey.trim() || wb.llmApiKey
  const llmBase = cfg.llmBaseUrl.trim() || wb.llmBaseUrl
  const zhipuKey =
    cfg.zhipuApiKey.trim() ||
    (process.env.ZHIPU_API_KEY || '').trim() ||
    (process.env.BIGMODEL_API_KEY || '').trim() ||
    (process.env.VISION_API_KEY || '').trim() ||
    wb.visionApiKey
  return {
    listen: cfg.listen,
    port: cfg.port,
    pluginVersion: pluginVersion(),
    addr: `http://${cfg.listen}:${cfg.port}`,
    dataRoot: cfg.dataRoot,
    schedulerEnabled: cfg.schedulerEnabled,
    tickSec: cfg.tickSec,
    llmBaseUrl: llmBase,
    llmModel: cfg.llmModel.trim() || wb.llmModel,
    llmConfigured: Boolean(llmKey && llmBase),
    llmFromWorkbuddy: !cfg.llmApiKey.trim() && Boolean(wb.llmApiKey),
    zhipuBaseUrl: cfg.zhipuBaseUrl.trim() || wb.visionBaseUrl,
    webSearchConfigured: Boolean(zhipuKey),
    webSearchFromWorkbuddy: !cfg.zhipuApiKey.trim() && Boolean(wb.visionApiKey),
    wecomPushEnabled: cfg.wecomWebhookKey.trim() ? cfg.wecomPushEnabled : Boolean(cfg.wecomPushEnabled || wb.wecomPushEnabled),
    wecomConfigured: Boolean(cfg.wecomWebhookKey.trim() || wb.wecomWebhookKey),
    wecomDryRun: cfg.wecomWebhookKey.trim() ? cfg.wecomDryRun : wb.wecomDryRun,
    wecomFromWorkbuddy: !cfg.wecomWebhookKey.trim() && Boolean(wb.wecomWebhookKey),
    feishuConfigured: Boolean(wb.feishuAppId && wb.feishuAppSecret),
    feishuFromWorkbuddy: Boolean(wb.feishuAppId && wb.feishuAppSecret),
    yuqueConfigured: yuque.configured,
    yuqueAuthMode: yuque.mode,
    yuqueAuthSource: yuque.source,
    yuqueHost: yuque.host,
    yuqueCookieFile: yuque.cookieFilePath,
    mesBaseUrl: mes.baseUrl,
    mesConfigured: Boolean(mes.baseUrl),
    mesFromWorkbuddy: mes.fromWorkbuddy,
  }
}

export function editableConfigView(cfg: AutomationsConfig) {
  const wb = readWorkbuddyCreds()
  const mes = resolveMesSettings()
  return {
    listen: cfg.listen,
    port: cfg.port,
    schedulerEnabled: cfg.schedulerEnabled,
    tickSec: cfg.tickSec,
    llmBaseUrl: cfg.llmBaseUrl.trim() || wb.llmBaseUrl,
    llmApiKey: '',
    llmApiKeyConfigured: Boolean(cfg.llmApiKey.trim() || wb.llmApiKey),
    llmModel: cfg.llmModel.trim() || wb.llmModel || cfg.llmModel,
    zhipuApiKey: '',
    zhipuApiKeyConfigured: Boolean(cfg.zhipuApiKey.trim() || wb.visionApiKey),
    zhipuBaseUrl: cfg.zhipuBaseUrl.trim() || wb.visionBaseUrl,
    wecomPushEnabled: cfg.wecomWebhookKey.trim() ? cfg.wecomPushEnabled : Boolean(cfg.wecomPushEnabled || wb.wecomPushEnabled),
    wecomWebhookKey: '',
    wecomWebhookKeyConfigured: Boolean(cfg.wecomWebhookKey.trim() || wb.wecomWebhookKey),
    wecomDryRun: cfg.wecomWebhookKey.trim() ? cfg.wecomDryRun : wb.wecomDryRun,
    mesBaseUrl: mes.baseUrl,
    mesConfigured: Boolean(mes.baseUrl),
    mesFromWorkbuddy: mes.fromWorkbuddy,
    dataRoot: cfg.dataRoot,
  }
}

function keepOrReplace(incoming: unknown, current: string): string {
  const s = typeof incoming === 'string' ? incoming.trim() : ''
  if (!s) return current
  if (s === '***' || s === '（已配置，留空则保持不变）' || /^•+$/.test(s)) return current
  return s
}

/** 只允许 http(s) Base URL，拒绝 file/自定义协议把密钥打到任意目标。 */
function normalizeHttpBaseUrl(raw: string, label: string): string {
  const s = (raw || '').trim()
  if (!s) return ''
  let url: URL
  try {
    url = new URL(s)
  } catch {
    throw new Error(`${label} 不是合法 URL`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${label} 只允许 http/https`)
  }
  if (url.username || url.password) {
    throw new Error(`${label} 不能带用户名或密码`)
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '') || `${url.origin}`
}

function applyPlain(body: Record<string, unknown>, key: string, current: string): string {
  if (!(key in body)) return current
  const raw = body[key]
  if (typeof raw !== 'string') return current
  return raw.trim()
}

export function applyConfigFromUi(body: Record<string, unknown>, overrideRoot?: string): AutomationsConfig {
  const current = loadConfig(overrideRoot)
  const portRaw = body.port
  let port = current.port
  if (portRaw !== undefined && portRaw !== null && String(portRaw).trim() !== '') {
    const n = Number(portRaw)
    if (!Number.isInteger(n) || n <= 0 || n > 65535) {
      throw new Error(`端口非法：${portRaw}`)
    }
    port = n
  }
  let tickSec = current.tickSec
  if (body.tickSec !== undefined && body.tickSec !== null && String(body.tickSec).trim() !== '') {
    const n = Number(body.tickSec)
    if (!Number.isFinite(n)) throw new Error('调度间隔非法')
    tickSec = Math.max(5, Math.min(3600, Math.floor(n)))
  }
  const llmBaseRaw = applyPlain(body, 'llmBaseUrl', current.llmBaseUrl)
  const zhipuBaseRaw = applyPlain(body, 'zhipuBaseUrl', current.zhipuBaseUrl)
  return saveConfig(
    {
      listen: '127.0.0.1',
      port,
      schedulerEnabled: asBool(body.schedulerEnabled, current.schedulerEnabled),
      tickSec,
      llmBaseUrl: llmBaseRaw ? normalizeHttpBaseUrl(llmBaseRaw, 'LLM Base URL') : '',
      llmApiKey: keepOrReplace(body.llmApiKey, current.llmApiKey),
      llmModel: applyPlain(body, 'llmModel', current.llmModel) || current.llmModel,
      zhipuApiKey: keepOrReplace(body.zhipuApiKey, current.zhipuApiKey),
      zhipuBaseUrl: zhipuBaseRaw ? normalizeHttpBaseUrl(zhipuBaseRaw, '智谱 Base URL') : '',
      wecomPushEnabled: asBool(body.wecomPushEnabled, current.wecomPushEnabled),
      wecomWebhookKey: keepOrReplace(body.wecomWebhookKey, current.wecomWebhookKey),
      wecomDryRun: asBool(body.wecomDryRun, current.wecomDryRun),
      mesBaseUrl: current.mesBaseUrl,
    },
    overrideRoot,
  )
}
