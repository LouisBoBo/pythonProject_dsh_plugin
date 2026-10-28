import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { maskApiKey } from './key-id.js'

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
  const matched = yaml.match(re)
  return matched ? matched[1] : ''
}

function parseSection(yaml: string, name: string): Record<string, string> {
  const body = sectionBody(yaml, name)
  if (!body) return {}
  let minIndent = Infinity
  const rows: { indent: number, key: string, val: string }[] = []
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
    if (indent <= provIndent) break
    if (!isMasked(val)) out[key] = val
  }
  return out
}

const ENGINE_YAML = join('apps', 'zr-workbuddy', 'engine', 'config', 'config.yaml')

/** 桌面宿主的 DSH_HOME 往往没有 link。系统配置写在 roaming 的 persist / runtime-app，或 ~/.dsh。 */
export function deepseekConfigCandidates(env: NodeJS.ProcessEnv = process.env, home = homedir()): string[] {
  const explicit = (env.WORKBUDDY_CONFIG_YAML || '').trim()
  if (explicit === '-') return []
  const dsh = (env.DSH_HOME || '').trim() || join(home, '.dsh')
  const appData = (env.APPDATA || '').trim()
  const out: string[] = []
  const push = (path: string) => {
    if (path && !out.includes(path)) out.push(path)
  }
  if (explicit) push(explicit)
  push(join(dsh, 'link', 'DSH-ZR-WorkBuddy', ENGINE_YAML))
  if (appData) {
    const desktop = join(appData, 'zr-workbuddy-desktop')
    push(join(desktop, 'persist', 'config.yaml'))
    push(join(desktop, 'dsh-home', 'link', 'DSH-ZR-WorkBuddy', ENGINE_YAML))
    push(join(desktop, 'runtime-app', ENGINE_YAML))
  }
  push(join(home, '.dsh', 'link', 'DSH-ZR-WorkBuddy', ENGINE_YAML))
  push(join(home, 'ai_projects', 'DSH-ZR-WorkBuddy', ENGINE_YAML))
  const mac = join(home, 'Library', 'Application Support', 'zr-workbuddy-desktop')
  push(join(mac, 'runtime-app', ENGINE_YAML))
  push(join(mac, 'persist', 'config.yaml'))
  return out
}

function sectionField(yaml: string, section: string, field: string, defaultProvider = ''): string {
  const flat = parseSection(yaml, section)
  const provider = (flat.provider || defaultProvider).trim()
  const nested = provider ? parseByProvider(yaml, section, provider) : {}
  return flat[field] || nested[field] || ''
}

function deepseekKeyIn(yaml: string): string {
  return sectionField(yaml, 'deepseek', 'api_key', 'deepseek')
}

/** 只读 deepseek.api_key。不写回系统配置，不打印密钥。 */
export function readDeepseekApiKey(
  readFile: (path: string) => string | null = readYaml,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string {
  for (const path of deepseekConfigCandidates(env, home)) {
    const yaml = readFile(path)
    if (!yaml) continue
    const key = deepseekKeyIn(yaml)
    if (key) return key
  }
  return ''
}

export type ProviderKeyMasks = {
  deepseek: string
  zhipu: string
  cursor: string
}

/** 只返回遮罩。调用方拿不到系统配置里的原文。 */
export function readProviderKeyMasks(
  readFile: (path: string) => string | null = readYaml,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): ProviderKeyMasks {
  const out: ProviderKeyMasks = { deepseek: '', zhipu: '', cursor: '' }
  for (const path of deepseekConfigCandidates(env, home)) {
    const yaml = readFile(path)
    if (!yaml) continue
    if (!out.deepseek) out.deepseek = maskApiKey(deepseekKeyIn(yaml))
    if (!out.zhipu) out.zhipu = maskApiKey(sectionField(yaml, 'vision', 'api_key'))
    if (!out.cursor) out.cursor = maskApiKey(sectionField(yaml, 'code_dev', 'cursor_api_key'))
    if (out.deepseek && out.zhipu && out.cursor) break
  }
  return out
}

function readYaml(path: string): string | null {
  if (!existsSync(path)) return null
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}
