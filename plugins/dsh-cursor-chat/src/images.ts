/**
 * 对话写码 · 图片入参归一化 → Cursor SDK SDKImage。
 * 支持：本地路径 / data URL / raw base64+mime / http(s) url（SDK 侧 url 形态）。
 *
 * 安全：本机 path / file:// 只允许读 allowedRoots 内、非敏感、图片扩展名文件；
 * 落盘引用必须落在 destDir（通常在 dataRoot/uploads），禁止用任意绝对路径当 ref。
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve, sep } from 'node:path'
import { isSensitiveRel } from './pathScope.js'

export type ChatImageInput = {
  /** 本机绝对路径 */
  path?: string
  /** base64（可带 data:image/...;base64, 前缀） */
  data?: string
  mimeType?: string
  /** 远程或 file:// URL，直接交给 SDK */
  url?: string
}

/** 落盘引用（进 pending / job，避免把大 base64 长期堆在工具参数里） */
export type ChatImageRef = {
  path: string
  mimeType: string
  name?: string
}

export type SdkImage =
  | { data: string; mimeType: string }
  | { url: string }

export type MaterializeImageOpts = {
  /** 允许读取的本机根目录（工作区、dataRoot 等）。未传或空 = 拒绝一切本机 path/file: */
  allowedRoots?: string[]
}

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

function mimeFromPath(p: string): string {
  const ext = extname(p).toLowerCase()
  return MIME_BY_EXT[ext] || 'image/png'
}

function isUnderRoot(abs: string, root: string): boolean {
  const a = resolve(abs)
  const r = resolve(root)
  if (a === r) return true
  const prefix = r.endsWith(sep) ? r : r + sep
  return a.startsWith(prefix)
}

function pathLooksSensitive(abs: string): boolean {
  const parts = resolve(abs)
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
  if (!parts.length) return true
  if (isSensitiveRel(parts.slice(-6).join('/'))) return true
  return isSensitiveRel(basename(abs))
}

function assertLocalImageReadable(abs: string, allowedRoots: string[]): string | null {
  const ext = extname(abs).toLowerCase()
  if (!MIME_BY_EXT[ext]) return `非图片扩展名：${ext || '（无）'}`
  if (pathLooksSensitive(abs)) return '拒绝读取敏感路径'
  const roots = (allowedRoots || []).map((r) => resolve(String(r || '').trim())).filter(Boolean)
  if (!roots.length) return '未配置可读根目录，拒绝本机路径'
  if (!roots.some((r) => isUnderRoot(abs, r))) return '路径不在允许的工作区/数据目录内'
  try {
    if (!statSync(abs).isFile()) return '不是普通文件'
  } catch {
    return '图片不存在'
  }
  return null
}

/** 只保留已落在 dataRoot 下的引用（防 pending API 塞任意 path） */
export function filterStoredImageRefs(
  refs: ChatImageRef[] | null | undefined,
  dataRoot: string,
): ChatImageRef[] {
  const root = resolve(String(dataRoot || '').trim())
  if (!root) return []
  const out: ChatImageRef[] = []
  for (const ref of refs || []) {
    if (!ref?.path) continue
    if (ref.mimeType === 'application/x-cursor-chat-image-url') {
      if (isUnderRoot(ref.path, root)) out.push(ref)
      continue
    }
    const abs = resolve(ref.path)
    if (!isUnderRoot(abs, root)) continue
    if (pathLooksSensitive(abs)) continue
    if (!existsSync(abs)) continue
    out.push({ ...ref, path: abs })
    if (out.length >= MAX_IMAGES) break
  }
  return out
}

function stripDataUrl(raw: string): { mimeType: string; data: string } | null {
  const s = String(raw || '').trim()
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(s)
  if (!m) return null
  return { mimeType: m[1].toLowerCase(), data: m[2].replace(/\s+/g, '') }
}

/** 解析工具参数 images：JSON 字符串、数组、单路径字符串 */
export function parseImageArgs(raw: unknown): ChatImageInput[] {
  if (raw == null || raw === '') return []
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (!t) return []
    if (t.startsWith('[') || t.startsWith('{')) {
      try {
        return parseImageArgs(JSON.parse(t))
      } catch {
        /* 当作路径 */
      }
    }
    if (t.startsWith('data:image/')) return [{ data: t }]
    if (/^https?:\/\//i.test(t) || t.startsWith('file:')) return [{ url: t }]
    return [{ path: t }]
  }
  if (Array.isArray(raw)) {
    const out: ChatImageInput[] = []
    for (const item of raw) {
      if (typeof item === 'string') {
        out.push(...parseImageArgs(item))
        continue
      }
      if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>
        out.push({
          path: typeof o.path === 'string' ? o.path : undefined,
          data: typeof o.data === 'string' ? o.data : undefined,
          mimeType: typeof o.mimeType === 'string' ? o.mimeType : undefined,
          url: typeof o.url === 'string' ? o.url : undefined,
        })
      }
    }
    return out
  }
  if (typeof raw === 'object') {
    return parseImageArgs([raw])
  }
  return []
}

/**
 * 从 DSH tool exec 尽量捞附件（宿主若挂 attachments / images / files）。
 * 捞不到就空数组——主路径仍靠工具参数 images。
 */
export function extractImagesFromExec(exec: unknown): ChatImageInput[] {
  if (!exec || typeof exec !== 'object') return []
  const e = exec as Record<string, unknown>
  const bags = [e.attachments, e.images, e.files, e.media, (e as { message?: unknown }).message]
  const out: ChatImageInput[] = []
  for (const bag of bags) {
    if (!bag) continue
    if (Array.isArray(bag)) {
      for (const item of bag) {
        if (!item || typeof item !== 'object') {
          if (typeof item === 'string') out.push(...parseImageArgs(item))
          continue
        }
        const o = item as Record<string, unknown>
        const typ = String(o.type || o.mimeType || o.media_type || '').toLowerCase()
        const path = String(o.path || o.filePath || o.localPath || o.uri || '').trim()
        const data = String(o.data || o.base64 || o.content || '').trim()
        const url = String(o.url || o.src || '').trim()
        const mime = String(o.mimeType || o.media_type || o.mime || '').trim()
        if (path && (typ.includes('image') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(path))) {
          out.push({ path, mimeType: mime || undefined })
        } else if (data && (typ.includes('image') || data.startsWith('data:image/'))) {
          out.push({ data, mimeType: mime || undefined })
        } else if (url && (typ.includes('image') || /\.(png|jpe?g|gif|webp)(\?|$)/i.test(url))) {
          out.push({ url, mimeType: mime || undefined })
        }
      }
    }
  }
  return out
}

/** 把入参写成 dataRoot 下文件引用（确认前即可落盘到 pending 目录） */
export function materializeImages(
  inputs: ChatImageInput[],
  destDir: string,
  opts?: MaterializeImageOpts,
): { refs: ChatImageRef[]; errors: string[] } {
  const destRoot = resolve(destDir)
  mkdirSync(destRoot, { recursive: true })
  const allowedRoots = [...(opts?.allowedRoots || []), destRoot]
  const refs: ChatImageRef[] = []
  const errors: string[] = []
  let i = 0
  for (const raw of inputs.slice(0, MAX_IMAGES)) {
    i += 1
    try {
      if (raw.url && /^https?:\/\//i.test(raw.url)) {
        // URL 不落盘，用伪 path 标记；toSdkImages 时走 url 分支
        const marker = join(destRoot, `url-${i}.json`)
        writeFileSync(marker, JSON.stringify({ url: raw.url }), 'utf8')
        refs.push({ path: marker, mimeType: 'application/x-cursor-chat-image-url', name: `url-${i}` })
        continue
      }
      let localPath = raw.path ? String(raw.path).trim() : ''
      if (raw.url && raw.url.startsWith('file:')) {
        try {
          const u = new URL(raw.url)
          localPath = decodeURIComponent(u.pathname)
          if (process.platform === 'win32' && localPath.startsWith('/')) {
            localPath = localPath.slice(1)
          }
        } catch {
          errors.push(`无效 file URL：${raw.url.slice(0, 80)}`)
          continue
        }
      }
      let buf: Buffer | null = null
      let mime = (raw.mimeType || '').trim() || 'image/png'
      let name = `img-${i}.png`
      if (localPath) {
        const abs = resolve(localPath)
        const deny = assertLocalImageReadable(abs, allowedRoots)
        if (deny) {
          errors.push(`第 ${i} 张图：${deny}`)
          continue
        }
        buf = readFileSync(abs)
        mime = mimeFromPath(abs)
        name = basename(abs) || name
      } else if (raw.data) {
        const parsed = stripDataUrl(raw.data)
        const b64 = parsed ? parsed.data : String(raw.data).replace(/\s+/g, '')
        if (parsed) mime = parsed.mimeType
        else if (raw.mimeType) mime = raw.mimeType
        if (!/^image\//i.test(mime)) {
          errors.push(`第 ${i} 张图：mime 必须是 image/*`)
          continue
        }
        buf = Buffer.from(b64, 'base64')
        const ext =
          mime === 'image/jpeg' ? '.jpg' : mime === 'image/webp' ? '.webp' : mime === 'image/gif' ? '.gif' : '.png'
        name = `img-${i}${ext}`
      }
      if (!buf || !buf.length) {
        errors.push(`第 ${i} 张图为空`)
        continue
      }
      if (buf.length > MAX_BYTES) {
        errors.push(`第 ${i} 张图过大（>${MAX_BYTES}）`)
        continue
      }
      const safeName = name.replace(/[^\w.\u4e00-\u9fff-]+/g, '_') || `img-${i}.png`
      const dest = join(destRoot, safeName)
      if (!isUnderRoot(dest, destRoot)) {
        errors.push(`第 ${i} 张图：写入路径非法`)
        continue
      }
      writeFileSync(dest, buf)
      refs.push({ path: dest, mimeType: mime, name: safeName })
    } catch (err) {
      errors.push(`第 ${i} 张图失败：${String(err).slice(0, 120)}`)
    }
  }
  return { refs, errors }
}

export function toSdkImages(refs: ChatImageRef[] | null | undefined): SdkImage[] {
  const out: SdkImage[] = []
  for (const ref of refs || []) {
    if (!ref?.path) continue
    const abs = resolve(ref.path)
    if (pathLooksSensitive(abs)) continue
    if (ref.mimeType === 'application/x-cursor-chat-image-url') {
      try {
        const j = JSON.parse(readFileSync(abs, 'utf8')) as { url?: string }
        if (j.url && /^https?:\/\//i.test(j.url)) out.push({ url: j.url })
      } catch {
        /* skip */
      }
      continue
    }
    if (!existsSync(abs)) continue
    const ext = extname(abs).toLowerCase()
    if (!MIME_BY_EXT[ext] && !String(ref.mimeType || '').startsWith('image/')) continue
    const buf = readFileSync(abs)
    if (!buf.length || buf.length > MAX_BYTES) continue
    out.push({ data: buf.toString('base64'), mimeType: ref.mimeType || mimeFromPath(abs) })
  }
  return out.slice(0, MAX_IMAGES)
}

/** 拷进沙箱供 Agent 用 Read 工具兜底（SDK 吃图为主） */
export function copyImagesIntoSandbox(
  refs: ChatImageRef[] | null | undefined,
  sandbox: string,
): string[] {
  const dir = join(sandbox, '.cursor-chat-images')
  mkdirSync(dir, { recursive: true })
  const rels: string[] = []
  let i = 0
  for (const ref of refs || []) {
    if (!ref?.path || !existsSync(ref.path)) continue
    if (ref.mimeType === 'application/x-cursor-chat-image-url') continue
    if (pathLooksSensitive(ref.path)) continue
    i += 1
    const ext = extname(ref.name || ref.path) || '.png'
    const name = `shot-${i}${ext}`
    const dest = join(dir, name)
    writeFileSync(dest, readFileSync(ref.path))
    rels.push(`.cursor-chat-images/${name}`)
  }
  return rels
}
