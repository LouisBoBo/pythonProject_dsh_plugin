/**
 * 只读 WorkBuddy 系统配置里的 MES / LLM 段。不写回、不打印密钥。
 * 对照自动化插件：凭证不进本插件 config.json。
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type WorkbuddyMesCreds = {
  baseUrl: string
  username: string
  password: string
  token: string
  enterpriseCode: string
}

export type WorkbuddyLlmCreds = {
  baseUrl: string
  apiKey: string
  model: string
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

/**
 * 只解析 section 下第一层 key（相同最小缩进）。
 * 忽略 by_provider 等嵌套子键，避免 ollama/openai_compat 覆盖顶层 deepseek 凭证。
 */
function parseSectionFlat(yaml: string, name: string): Record<string, string> {
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

/** 兼容旧调用名 */
function parseSection(yaml: string, name: string): Record<string, string> {
  return parseSectionFlat(yaml, name)
}

/** 读取 deepseek.by_provider.<provider> 下的扁平字段 */
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

function parseDeepseekLlm(yaml: string): WorkbuddyLlmCreds {
  const flat = parseSectionFlat(yaml, 'deepseek')
  const provider = (flat.provider || 'deepseek').trim() || 'deepseek'
  const nested = parseByProvider(yaml, 'deepseek', provider)
  return {
    baseUrl: (flat.base_url || nested.base_url || '').replace(/\/+$/, ''),
    apiKey: flat.api_key || nested.api_key || '',
    model: flat.model || nested.model || '',
  }
}

function candidates(): string[] {
  // WORKBUDDY_CONFIG_YAML 常指向 ~/.dsh/workbuddy-mes.yaml（仅 mes/automations/vision，不含 deepseek）。
  // 显式路径优先，但段缺失时必须继续回落到引擎 config.yaml，否则 AI 扩写会误报 llm_unconfigured。
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

/** 多文件合并：先出现的非空字段优先（sidecar 可只带 mes，引擎 yaml 补其余）。 */
export function readYamlSection(name: string): Record<string, string> {
  const merged: Record<string, string> = {}
  let any = false
  for (const path of candidates()) {
    const yaml = readYamlFile(path)
    if (!yaml) continue
    const sec = parseSection(yaml, name)
    if (!Object.keys(sec).length) continue
    any = true
    for (const [k, v] of Object.entries(sec)) {
      if (!merged[k] && v) merged[k] = v
    }
  }
  return any ? merged : {}
}

export function readWorkbuddyLlm(): WorkbuddyLlmCreds {
  const empty: WorkbuddyLlmCreds = { baseUrl: '', apiKey: '', model: '' }
  const merged = { ...empty }
  for (const path of candidates()) {
    const yaml = readYamlFile(path)
    if (!yaml) continue
    const llm = parseDeepseekLlm(yaml)
    if (!merged.baseUrl && llm.baseUrl) merged.baseUrl = llm.baseUrl
    if (!merged.apiKey && llm.apiKey) merged.apiKey = llm.apiKey
    if (!merged.model && llm.model) merged.model = llm.model
    if (merged.baseUrl && merged.apiKey) break
  }
  if (!merged.baseUrl && !merged.apiKey) return empty
  return {
    baseUrl: merged.baseUrl,
    apiKey: merged.apiKey,
    model: merged.model || 'deepseek-chat',
  }
}

export function readWorkbuddyMes(): WorkbuddyMesCreds {
  const empty: WorkbuddyMesCreds = {
    baseUrl: '',
    username: '',
    password: '',
    token: '',
    enterpriseCode: '',
  }
  const merged = { ...empty }
  for (const path of candidates()) {
    const yaml = readYamlFile(path)
    if (!yaml) continue
    const mes = parseSectionFlat(yaml, 'mes')
    if (!Object.keys(mes).length) continue
    if (!merged.baseUrl && mes.base_url) merged.baseUrl = mes.base_url.replace(/\/+$/, '')
    if (!merged.username && mes.username) merged.username = mes.username
    if (!merged.password && mes.password) merged.password = mes.password
    if (!merged.token && mes.token) merged.token = mes.token
    if (!merged.enterpriseCode && mes.enterprise_code) merged.enterpriseCode = mes.enterprise_code
  }
  return merged.baseUrl ? merged : empty
}

export function publicMesSource(): { fromWorkbuddy: boolean; baseUrl: string } {
  const wb = readWorkbuddyMes()
  return { fromWorkbuddy: Boolean(wb.baseUrl), baseUrl: wb.baseUrl }
}
