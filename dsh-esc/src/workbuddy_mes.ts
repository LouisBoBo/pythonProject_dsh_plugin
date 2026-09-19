/**
 * 只读 WorkBuddy 系统配置里的 MES 段。不写回、不打印密钥。
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

function candidates(): string[] {
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
  ]
}

export function readYamlSection(name: string): Record<string, string> {
  for (const path of candidates()) {
    if (!existsSync(path)) continue
    let yaml = ''
    try {
      yaml = readFileSync(path, 'utf8')
    } catch {
      continue
    }
    const sec = parseSection(yaml, name)
    if (Object.keys(sec).length) return sec
  }
  return {}
}

export function readWorkbuddyMes(): WorkbuddyMesCreds {
  const empty: WorkbuddyMesCreds = {
    baseUrl: '',
    username: '',
    password: '',
    token: '',
    enterpriseCode: '',
  }
  const mes = readYamlSection('mes')
  const creds: WorkbuddyMesCreds = {
    baseUrl: (mes.base_url || '').replace(/\/+$/, ''),
    username: mes.username || '',
    password: mes.password || '',
    token: mes.token || '',
    enterpriseCode: mes.enterprise_code || '',
  }
  return creds.baseUrl ? creds : empty
}

export function publicMesSource(): { fromWorkbuddy: boolean; baseUrl: string } {
  const wb = readWorkbuddyMes()
  return { fromWorkbuddy: Boolean(wb.baseUrl), baseUrl: wb.baseUrl }
}
