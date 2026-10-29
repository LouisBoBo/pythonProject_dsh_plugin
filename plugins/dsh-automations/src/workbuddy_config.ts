/**
 * 只读复用 WorkBuddy 系统配置（引擎 config.yaml）。
 * 不写回、不打印密钥。
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

function sectionBody(yaml: string, name: string): string {
  const re = new RegExp(`^${name}:\\s*\\n((?:[ \\t]+.*\\n?)*)`, 'm')
  const m = yaml.match(re)
  return m ? m[1] : ''
}

/** 只解析 section 第一层 key，避免 by_provider 子键覆盖顶层凭证 */
function parseSection(yaml: string, name: string): Record<string, string> {
  const body = sectionBody(yaml, name)
  if (!body) return {}
  let minIndent = Infinity
  const rows: { indent: number; key: string; val: string }[] = []
  for (const line of body.split('\n')) {
    const kv = line.match(/^([ \t]+)([A-Za-z0-9_]+)[ \t]*:[ \t]*(.*)$/)
    if (!kv) continue
    const indent = kv[1].length
    minIndent = Math.min(minIndent, indent)
    rows.push({ indent, key: kv[2], val: stripScalar(kv[3] || '') })
  }
  if (!Number.isFinite(minIndent)) return {}
  const out: Record<string, string> = {}
  for (const row of rows) {
    if (row.indent !== minIndent) continue
    if (isMasked(row.val)) continue
    out[row.key] = row.val
  }
  return out
}

function parseByProvider(yaml: string, section: string, provider: string): Record<string, string> {
  const body = sectionBody(yaml, section)
  if (!body || !provider) return {}
  const lines = body.split('\n')
  let byIndent = -1
  let provIndent = -1
  const out: Record<string, string> = {}
  for (const line of lines) {
    const kv = line.match(/^([ \t]+)([A-Za-z0-9_]+)[ \t]*:[ \t]*(.*)$/)
    if (!kv) continue
    const indent = kv[1].length
    const key = kv[2]
    const val = stripScalar(kv[3] || '')
    if (byIndent < 0) {
      if (key === 'by_provider') byIndent = indent
      continue
    }
    if (indent <= byIndent) break
    if (provIndent < 0) {
      if (key === provider) provIndent = indent
      continue
    }
    if (indent <= provIndent) {
      if (indent > byIndent && key === provider) {
        provIndent = indent
        continue
      }
      if (indent > byIndent) {
        provIndent = -1
        if (key === provider) provIndent = indent
        continue
      }
      break
    }
    if (!isMasked(val)) out[key] = val
  }
  return out
}

function parseDeepseekLlm(yaml: string): { api_key: string; base_url: string; model: string } {
  const flat = parseSection(yaml, 'deepseek')
  const provider = (flat.provider || 'deepseek').trim() || 'deepseek'
  const nested = parseByProvider(yaml, 'deepseek', provider)
  return {
    api_key: flat.api_key || nested.api_key || '',
    base_url: flat.base_url || nested.base_url || '',
    model: flat.model || nested.model || '',
  }
}

export function workbuddyConfigCandidates(): string[] {
  // WORKBUDDY_CONFIG_YAML 可能指向仅含 mes 的 sidecar；段缺失时继续回落引擎 config.yaml。
  const explicit = (process.env.WORKBUDDY_CONFIG_YAML || '').trim()
  if (explicit === '-') return []
  const home = homedir()
  const dsh = (process.env.DSH_HOME || '').trim() || join(home, '.dsh')
  const defaults = [
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
  const out: string[] = []
  const seen = new Set<string>()
  for (const p of explicit ? [explicit, ...defaults] : defaults) {
    if (!p || seen.has(p)) continue
    seen.add(p)
    out.push(p)
  }
  return out
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
  // 多文件合并：先出现的非空字段优先（sidecar 可只带 mes，引擎 yaml 补 deepseek）。
  const merged: WorkbuddyCreds = { ...empty }
  let any = false
  let wecomEnabledSet = false
  let wecomDrySet = false
  let feishuEnabledSet = false
  let feishuDrySet = false
  for (const path of workbuddyConfigCandidates()) {
    const yaml = readYamlFile(path)
    if (!yaml) continue
    const vision = parseSection(yaml, 'vision')
    const llm = parseDeepseekLlm(yaml)
    const auto = parseSection(yaml, 'automations')
    const mes = parseSection(yaml, 'mes')
    const hasLlm = Boolean(llm.api_key || llm.base_url || llm.model)
    if (!Object.keys(vision).length && !hasLlm && !Object.keys(auto).length && !Object.keys(mes).length) {
      continue
    }
    any = true
    if (!merged.visionApiKey && vision.api_key) merged.visionApiKey = vision.api_key
    if (!merged.visionBaseUrl && vision.base_url) merged.visionBaseUrl = vision.base_url.replace(/\/+$/, '')
    if (!merged.llmApiKey && llm.api_key) merged.llmApiKey = llm.api_key
    if (!merged.llmBaseUrl && llm.base_url) merged.llmBaseUrl = llm.base_url.replace(/\/+$/, '')
    if (!merged.llmModel && llm.model) merged.llmModel = llm.model
    if (!merged.wecomWebhookKey && auto.wecom_webhook_key) merged.wecomWebhookKey = auto.wecom_webhook_key
    if (!wecomEnabledSet && 'wecom_push_enabled' in auto) {
      merged.wecomPushEnabled = yamlBool(auto.wecom_push_enabled, false)
      wecomEnabledSet = true
    }
    if (!wecomDrySet && 'wecom_push_dry_run' in auto) {
      merged.wecomDryRun = yamlBool(auto.wecom_push_dry_run, false)
      wecomDrySet = true
    }
    if (!merged.mesBaseUrl && mes.base_url) merged.mesBaseUrl = mes.base_url.replace(/\/+$/, '')
    if (merged.mesAuthType === 'password' && mes.auth_type) merged.mesAuthType = mes.auth_type
    if (!merged.mesUsername && mes.username) merged.mesUsername = mes.username
    if (!merged.mesPassword && mes.password) merged.mesPassword = mes.password
    if (!merged.mesToken && mes.token) merged.mesToken = mes.token
    if (!merged.mesEnterpriseCode && mes.enterprise_code) merged.mesEnterpriseCode = mes.enterprise_code
    if (merged.mesTimeoutSec === 30 && mes.timeout) {
      const timeoutRaw = Number(mes.timeout)
      if (Number.isFinite(timeoutRaw) && timeoutRaw > 0) merged.mesTimeoutSec = timeoutRaw
    }
    if (!merged.feishuAppId && auto.feishu_app_id) merged.feishuAppId = auto.feishu_app_id
    if (!merged.feishuAppSecret && auto.feishu_app_secret) merged.feishuAppSecret = auto.feishu_app_secret
    if (!feishuEnabledSet && 'feishu_bitable_enabled' in auto) {
      merged.feishuBitableEnabled = yamlBool(auto.feishu_bitable_enabled, false)
      feishuEnabledSet = true
    }
    if (!feishuDrySet && 'feishu_bitable_dry_run' in auto) {
      merged.feishuBitableDryRun = yamlBool(auto.feishu_bitable_dry_run, false)
      feishuDrySet = true
    }
    if (!merged.yuqueToken && auto.yuque_token) merged.yuqueToken = auto.yuque_token
    if (!merged.yuqueCookie && auto.yuque_cookie) merged.yuqueCookie = auto.yuque_cookie
    if (!merged.yuqueHost && auto.yuque_host) merged.yuqueHost = auto.yuque_host
  }
  return any ? merged : empty
}
