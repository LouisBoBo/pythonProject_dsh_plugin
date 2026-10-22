import { existsSync, lstatSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { MomError } from './types.js'

const ALLOWED_EXT = new Set(['.md', '.txt'])

const SENSITIVE_BASENAMES = new Set([
  '.env',
  'credentials.json',
  'id_rsa',
  'id_ed25519',
])

const SENSITIVE_SUFFIXES = ['.pem', '.key', '.p12', '.pfx', '.env']

function blockedRoots(): string[] {
  const roots = [
    '/etc',
    '/sys',
    '/proc',
    '/dev',
    '/bin',
    '/sbin',
    '/usr/bin',
    '/usr/sbin',
    '/root',
    '/System',
    '/private/etc',
  ]
  if (process.platform === 'win32') {
    const sys = process.env.SystemRoot || 'C:\\Windows'
    roots.push(sys, join(sys, 'System32'))
    const pf = process.env.ProgramFiles
    const pf86 = process.env['ProgramFiles(x86)']
    if (pf) roots.push(pf)
    if (pf86) roots.push(pf86)
  }
  return roots.map((item) => resolve(item))
}

function isBlocked(dir: string): boolean {
  const abs = resolve(dir)
  return blockedRoots().some((root) => abs === root || abs.startsWith(root + sep))
}

export function shanghaiDate(now = new Date()): string {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  return assertCalendarDate(formatted)
}

export function assertCalendarDate(raw: string): string {
  const date = String(raw || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new MomError('directory_invalid', '日期格式必须是 YYYY-MM-DD')
  }
  const [year, month, day] = date.split('-').map((part) => Number(part))
  const utc = new Date(Date.UTC(year, month - 1, day))
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    throw new MomError('directory_invalid', '日期不存在')
  }
  return date
}

export function resolveWorkspaceDir(raw: string): string {
  const text = String(raw || '').trim()
  if (!text || text.includes('\0')) {
    throw new MomError('directory_invalid', '目录为空')
  }
  const expanded = text.replace(/^~(?=\/|\\|$)/, homedir())
  if (!isAbsolute(expanded)) {
    throw new MomError('directory_invalid', '目录必须是绝对路径')
  }
  let abs: string
  try {
    abs = resolve(expanded)
  } catch {
    throw new MomError('directory_invalid', '目录无法解析')
  }
  if (isBlocked(abs)) {
    throw new MomError('directory_invalid', '目录位于系统路径')
  }
  if (!existsSync(abs)) {
    throw new MomError('directory_invalid', '目录不存在')
  }
  let stat: ReturnType<typeof lstatSync>
  try {
    stat = lstatSync(abs)
  } catch {
    throw new MomError('directory_invalid', '目录不可读')
  }
  if (stat.isSymbolicLink()) {
    throw new MomError('directory_invalid', '拒绝符号链接目录')
  }
  if (!stat.isDirectory()) {
    throw new MomError('directory_invalid', '路径不是目录')
  }
  return realpathSync(abs)
}

export function momDayDir(workspace: string, date: string): string {
  const day = assertCalendarDate(date)
  const dir = join(workspace, 'MOM', day)
  assertInside(workspace, dir)
  return dir
}

export function assertInside(root: string, target: string): string {
  const rel = relative(root, target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new MomError('directory_invalid', '路径超出工作区')
  }
  return target
}

export function safeFileName(rawName: string, rawTitle: string): string {
  const source = String(rawName || '').trim() || String(rawTitle || '').trim()
  if (!source) throw new MomError('filename_invalid', '缺少文件名')
  let base = basename(source.replace(/\\/g, '/'))
  base = base.replace(/[\u0000-\u001f]/g, '')
  base = base.replace(/[<>:"|?*]/g, '-')
  base = base.replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '')
  if (!base || base === '.' || base === '..' || base.startsWith('.')) {
    throw new MomError('filename_invalid', '文件名不合法')
  }
  let ext = extname(base).toLowerCase()
  let stem = ext ? base.slice(0, -ext.length) : base
  if (!ALLOWED_EXT.has(ext)) {
    if (ext) throw new MomError('filename_invalid', '只允许 .md 或 .txt')
    ext = '.md'
  }
  stem = stem.replace(/[. ]+$/g, '').trim()
  if (!stem) throw new MomError('filename_invalid', '文件名不合法')
  if (stem.length > 80) stem = stem.slice(0, 80).replace(/[. ]+$/g, '')
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) {
    throw new MomError('filename_invalid', '文件名不合法')
  }
  const fileName = `${stem}${ext}`
  const lower = fileName.toLowerCase()
  if (
    SENSITIVE_BASENAMES.has(lower) ||
    SENSITIVE_SUFFIXES.some((suffix) => lower.endsWith(suffix))
  ) {
    throw new MomError('filename_invalid', '拒绝敏感文件名')
  }
  return fileName
}

export function toPortableRelative(root: string, target: string): string {
  return relative(root, target).split(sep).join('/')
}
