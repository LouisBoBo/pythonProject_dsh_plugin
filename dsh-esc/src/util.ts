import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export const PLUGIN_VERSION = '0.1.21'
export const DEFAULT_PORT = 18786
export const PRIVATE_DIR_MODE = 0o700
export const PRIVATE_FILE_MODE = 0o600

export function packageRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..')
}

export function assetsRoot(): string {
  return join(packageRoot(), 'assets')
}

export function nowSec(d = new Date()): number {
  return Math.floor(d.getTime() / 1000)
}

export function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

export function asNumber(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function asBool(v: unknown, fallback = false): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (['1', 'true', 'yes', 'on'].includes(s)) return true
    if (['0', 'false', 'no', 'off'].includes(s)) return false
  }
  if (typeof v === 'number') return v !== 0
  return fallback
}

export function ensurePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE })
  try {
    chmodSync(dir, PRIVATE_DIR_MODE)
  } catch {
    /* 部分 FS 不支持 chmod */
  }
}

export function ensurePrivateFile(path: string): void {
  try {
    chmodSync(path, PRIVATE_FILE_MODE)
  } catch {
    /* 文件尚不存在或 FS 不支持 */
  }
}

export function writeJsonAtomic(path: string, payload: unknown): void {
  ensurePrivateDir(dirname(path))
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', {
    encoding: 'utf8',
    mode: PRIVATE_FILE_MODE,
  })
  try {
    chmodSync(tmp, PRIVATE_FILE_MODE)
  } catch {
    /* ignore */
  }
  renameSync(tmp, path)
  ensurePrivateFile(path)
}

/** Markdown 图片说明：去掉能打断 `![alt](url)` 的字符，禁止当控制信号用正文。 */
export function sanitizeMdCaption(raw: string): string {
  const text = String(raw || '')
    .replace(/[\r\n\[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return text || '图表'
}

/** 只允许可嵌入对话的公网 https 图链，禁止空格、括号、凭证。 */
export function sanitizeMdImageUrl(raw: string): string {
  const text = String(raw || '').trim()
  if (!text || /[\s()\\]/.test(text)) return ''
  try {
    const url = new URL(text)
    if (url.protocol !== 'https:') return ''
    if (url.username || url.password) return ''
    url.hash = ''
    return url.href
  } catch {
    return ''
  }
}

export function truncate(text: string, max: number): string {
  const s = String(text || '')
  if (s.length <= max) return s
  return `${s.slice(0, Math.max(0, max - 12))}\n…(truncated)`
}

export function maskSecret(value: string): string {
  const v = (value || '').trim()
  if (!v) return ''
  if (v.length <= 6) return '***'
  return `${v.slice(0, 3)}***${v.slice(-2)}`
}

export function keepOrReplace(incoming: unknown, current: string): string {
  const s = typeof incoming === 'string' ? incoming.trim() : ''
  if (!s) return current
  if (s === '***' || s === '（已配置，留空则保持不变）' || /^•+$/.test(s) || s.includes('***')) return current
  return s
}

export function normalizeHttpBaseUrl(raw: string, label: string): string {
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
  return s.replace(/\/+$/, '')
}

export function parseFrontMatter(raw: string): { meta: Record<string, unknown>; body: string } {
  const text = raw.replace(/^\uFEFF/, '')
  if (!text.startsWith('---')) return { meta: {}, body: text.trim() }
  const end = text.indexOf('\n---', 3)
  if (end < 0) return { meta: {}, body: text.trim() }
  const yaml = text.slice(3, end).trim()
  const body = text.slice(end + 4).replace(/^\s*\n/, '').trim()
  const meta: Record<string, unknown> = {}
  let currentList: string[] | null = null
  let currentKey = ''
  for (const line of yaml.split('\n')) {
    const listItem = line.match(/^\s+-\s+(.*)$/)
    if (listItem && currentList) {
      currentList.push(listItem[1].replace(/^['"]|['"]$/g, '').trim())
      continue
    }
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/)
    if (!kv) continue
    currentList = null
    currentKey = kv[1]
    const value = kv[2].trim()
    if (value === '[]') {
      meta[currentKey] = []
      continue
    }
    if (value === '' || value === '|' || value === '>') {
      currentList = []
      meta[currentKey] = currentList
      continue
    }
    meta[currentKey] = value.replace(/^['"]|['"]$/g, '')
  }
  return { meta, body }
}

export function strList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean)
  if (typeof v === 'string') {
    const s = v.trim()
    if (!s || s === '[]') return []
    return [s]
  }
  return []
}

let chain: Promise<unknown> = Promise.resolve()

export function withLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}
