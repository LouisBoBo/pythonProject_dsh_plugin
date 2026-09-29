/**
 * 只读复用 WorkBuddy 系统配置（引擎 config.yaml）。
 * 对照 dsh-cursor-coding 读 cursor_api_key 的方式；不写回、不打印密钥。
 * 智谱检索用 vision.*；MES 用 mes.base_url；企微/飞书 App 用 automations.*。
 * 语雀不改 WorkBuddy 仓库文件：凭证只放本机 ~/.zhongruan/automations/credentials/yuque.cookie；
 * 若运行时 yaml 里已有 yuque_* 则顺带读取，禁止手改项目 config.yaml。
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type WorkbuddyCreds = {
  visionApiKey: string
  visionBaseUrl: string
  llmApiKey: string
  llmBaseUrl: string
  llmModel: string
  wecomWebhookKey: string
  wecomPushEnabled: boolean
  wecomDryRun: boolean
  mesBaseUrl: string
  mesAuthType: string
  mesUsername: string
  mesPassword: string
  mesToken: string
  mesEnterpriseCode: string
  mesTimeoutSec: number
  feishuAppId: string
  feishuAppSecret: string
  feishuBitableEnabled: boolean
  feishuBitableDryRun: boolean
  yuqueToken: string
  yuqueCookie: string
  yuqueHost: string
}

function isMasked(v: string): boolean {
  const s = v.trim()
  return !s || s === '••••••••' || /^•+$/.test(s) || s === "''" || s === '""'
}

function stripScalar(raw: string): string {
  let v = raw.trim()
  const hash = v.search(/\s+#/)
  if (hash >= 0) v = v.slice(0, hash).trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1)
  }
  return v.trim()
}

function parseSection(yaml: string, name: string): Record<string, string> {
  const re = new RegExp(`^${name}:\\s*\\n((?:[ \\t]+.*\\n?)*)`, 'm')
  const m = yaml.match(re)
  if (!m) return {}
  const out: Record<string, string> = {}
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^[ \t]+([A-Za-z0-9_]+)[ \t]*:[ \t]*(.*)$/)
    if (!kv) continue
    const val = stripScalar(kv[2] || '')
    if (isMasked(val)) continue
    out[kv[1]] = val
  }
  return out
}

export function workbuddyConfigCandidates(): string[] {
  const explicit = (process.env.WORKBUDDY_CONFIG_YAML || '').trim()
  if (explicit === '-') return []
  if (explicit) return [explicit]
  const home = homedir()
  const dsh = (process.env.DSH_HOME || '').trim() || join(home, '.dsh')
  return [
    join(dsh, 'link', 'DSH-ZR-WorkBuddy', 'apps', 'zr-workbuddy', 'engine', 'config', 'config.yaml'),
    join(home, 'ai_projects', 'DSH-ZR-WorkBuddy', 'apps', 'zr-workbuddy', 'engine', 'config', 'config.yaml'),
    join(
      home,
      'Library',
      'Application Support',
      'zr-workbuddy-desktop',
      'runtime-app',
      'apps',
      'zr-workbuddy',
      'engine',
      'config',
      'config.yaml',
    ),
    join(home, 'Library', 'Application Support', 'zr-workbuddy-desktop', 'persist', 'config.yaml'),
  ]
}

function readYamlFile(path: string): string | null {
  if (!existsSync(path)) return null
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function yamlBool(raw: string | undefined, fallback = false): boolean {
  const s = (raw || '').trim().toLowerCase()
  if (!s) return fallback
  if (['1', 'true', 'yes', 'on'].includes(s)) return true
  if (['0', 'false', 'no', 'off'].includes(s)) return false
  return fallback
}

export function readWorkbuddyCreds(): WorkbuddyCreds {
  const empty: WorkbuddyCreds = {
    visionApiKey: '',
    visionBaseUrl: '',
    llmApiKey: '',
    llmBaseUrl: '',
    llmModel: '',
    wecomWebhookKey: '',
    wecomPushEnabled: false,
    wecomDryRun: false,
    mesBaseUrl: '',
    mesAuthType: 'password',
    mesUsername: '',
    mesPassword: '',
    mesToken: '',
    mesEnterpriseCode: '',
    mesTimeoutSec: 30,
    feishuAppId: '',
    feishuAppSecret: '',
    feishuBitableEnabled: false,
    feishuBitableDryRun: false,
    yuqueToken: '',
    yuqueCookie: '',
    yuqueHost: '',
  }
  for (const path of workbuddyConfigCandidates()) {
    const yaml = readYamlFile(path)
    if (!yaml) continue
    const vision = parseSection(yaml, 'vision')
    const llm = parseSection(yaml, 'deepseek')
    const auto = parseSection(yaml, 'automations')
    const mes = parseSection(yaml, 'mes')
    const timeoutRaw = Number(mes.timeout)
    const creds: WorkbuddyCreds = {
      visionApiKey: vision.api_key || '',
      visionBaseUrl: (vision.base_url || '').replace(/\/+$/, ''),
      llmApiKey: llm.api_key || '',
      llmBaseUrl: (llm.base_url || '').replace(/\/+$/, ''),
      llmModel: llm.model || '',
      wecomWebhookKey: auto.wecom_webhook_key || '',
      wecomPushEnabled: yamlBool(auto.wecom_push_enabled, false),
      wecomDryRun: yamlBool(auto.wecom_push_dry_run, false),
      mesBaseUrl: (mes.base_url || '').replace(/\/+$/, ''),
      mesAuthType: mes.auth_type || 'password',
      mesUsername: mes.username || '',
      mesPassword: mes.password || '',
      mesToken: mes.token || '',
      mesEnterpriseCode: mes.enterprise_code || '',
      mesTimeoutSec: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 30,
      feishuAppId: auto.feishu_app_id || '',
      feishuAppSecret: auto.feishu_app_secret || '',
      feishuBitableEnabled: yamlBool(auto.feishu_bitable_enabled, false),
      feishuBitableDryRun: yamlBool(auto.feishu_bitable_dry_run, false),
      yuqueToken: auto.yuque_token || '',
      yuqueCookie: auto.yuque_cookie || '',
      yuqueHost: auto.yuque_host || '',
    }
    if (
      creds.visionApiKey ||
      creds.llmApiKey ||
      creds.wecomWebhookKey ||
      creds.mesBaseUrl ||
      creds.feishuAppId ||
      creds.yuqueToken ||
      creds.yuqueCookie
    )
      return creds
  }
  return empty
}
