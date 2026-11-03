/** 需求附图 → cursor-chat 可读取的落盘引用。 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'

import { expandHome } from './config.js'

const MAX_IMAGES = 8
const MAX_BYTES = 8 * 1024 * 1024
const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
}
const SUPPORTED_MIMES: ReadonlySet<string> = new Set(Object.values(MIME_BY_EXT))
const SENSITIVE_SEGMENTS = new Set([
  '.ssh',
  '.aws',
  '.gnupg',
  '.config',
  'keychains',
  'credentials',
])
const SENSITIVE_NAMES = new Set([
  '.env',
  '.netrc',
  'credentials',
  'credentials.json',
  'id_rsa',
  'id_ed25519',
])

export interface ChatImageRef {
  path: string
  mimeType: string
  name?: string
}

export interface PreparedImages {
  refs: ChatImageRef[]
  warnings: string[]
}

/** 与 cursor-chat 默认落盘目录保持一致（支持 CURSOR_CHAT_HOME / config.json 覆盖）。 */
export function cursorChatDataRoot(): string {
  const env = String(process.env.CURSOR_CHAT_HOME || '').trim()
  if (env) return resolve(expandHome(env))
  const base = join(homedir(), '.zhongruan', 'cursor-chat')
  try {
    const raw = JSON.parse(readFileSync(join(base, 'config.json'), 'utf8')) as {
      dataRoot?: unknown
    }
    const root = String(raw.dataRoot || '').trim()
    if (root) return resolve(expandHome(root))
  } catch {
    /* 用默认目录 */
  }
  return base
}

function mimeOf(path: string): string {
  return MIME_BY_EXT[extname(path).toLowerCase()] || ''
}

function looksSensitive(path: string): boolean {
  const parts = resolve(path)
    .replace(/\\/g, '/')
    .toLowerCase()
    .split('/')
    .filter(Boolean)
  if (!parts.length) return true
  if (parts.some((p) => SENSITIVE_SEGMENTS.has(p))) return true
  return SENSITIVE_NAMES.has(parts[parts.length - 1])
}

function safeName(name: string, fallback: string): string {
  const cleaned = String(name || '')
    .replace(/[^\w.\u4e00-\u9fff-]+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 80)
  return cleaned || fallback
}

function storeBuffer(
  dir: string,
  buf: Buffer,
  mime: string,
  name: string,
): ChatImageRef {
  const hash = createHash('sha1').update(buf).digest('hex').slice(0, 10)
  const ext =
    mime === 'image/jpeg' ? '.jpg' : mime === 'image/webp' ? '.webp' : mime === 'image/gif' ? '.gif' : mime === 'image/bmp' ? '.bmp' : '.png'
  const file = `dp-${hash}-${safeName(name, 'image')}`.replace(/\.[^.]*$/, '') + ext
  const dest = join(dir, file)
  if (!existsSync(dest)) writeFileSync(dest, buf)
  return { path: dest, mimeType: mime, name: basename(dest) }
}

/**
 * 支持本机图片路径、file:// 和 data:image/...;base64。
 * 远程 http(s) 不在这里下载，避免把任意 URL 变成内网探测器。
 */
export function prepareImages(inputs: string[]): PreparedImages {
  const warnings: string[] = []
  const refs: ChatImageRef[] = []
  const dir = join(cursorChatDataRoot(), 'uploads', 'dev-pipeline')
  try {
    mkdirSync(dir, { recursive: true })
  } catch (err) {
    return { refs: [], warnings: [`图片目录不可写：${String(err)}`] }
  }

  for (const input of (inputs || []).slice(0, MAX_IMAGES)) {
    const raw = String(input || '').trim()
    if (!raw) continue
    if (/^https?:\/\//i.test(raw)) {
      warnings.push(`跳过远程图片（请先保存到工程目录）：${raw.slice(0, 120)}`)
      continue
    }
    if (/^data:image\//i.test(raw)) {
      const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(raw)
      if (!m) {
        warnings.push('跳过无法识别的 data URL 图片')
        continue
      }
      const mime = m[1].toLowerCase()
      if (!SUPPORTED_MIMES.has(mime)) {
        warnings.push(`跳过不支持的图片格式：${mime}`)
        continue
      }
      const buf = Buffer.from(m[2].replace(/\s+/g, ''), 'base64')
      if (!buf.length || buf.length > MAX_BYTES) {
        warnings.push('跳过空图或超过 8MB 的图片')
        continue
      }
      refs.push(storeBuffer(dir, buf, mime, 'pasted'))
      continue
    }

    let local = raw
    if (raw.startsWith('file:')) {
      try {
        local = decodeURIComponent(new URL(raw).pathname)
        if (process.platform === 'win32' && local.startsWith('/')) local = local.slice(1)
      } catch {
        warnings.push(`跳过无效 file URL：${raw.slice(0, 120)}`)
        continue
      }
    }
    local = resolve(expandHome(local))
    const mime = mimeOf(local)
    if (!mime) {
      warnings.push(`跳过非图片文件：${basename(local)}`)
      continue
    }
    try {
      const real = realpathSync(local)
      if (looksSensitive(real)) {
        warnings.push(`跳过敏感路径图片：${basename(real)}`)
        continue
      }
      const st = statSync(real)
      if (!st.isFile()) {
        warnings.push(`跳过非普通文件：${basename(real)}`)
        continue
      }
      if (st.size <= 0 || st.size > MAX_BYTES) {
        warnings.push(`跳过空图或超过 8MB 的图片：${basename(real)}`)
        continue
      }
      refs.push(storeBuffer(dir, readFileSync(real), mime, basename(real)))
    } catch (err) {
      warnings.push(`跳过不可读图片：${basename(local)}（${String(err).slice(0, 80)}）`)
    }
    if (refs.length >= MAX_IMAGES) break
  }

  return { refs, warnings }
}
