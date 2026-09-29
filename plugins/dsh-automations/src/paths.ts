import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { AutomationError } from './types.js'

const BLOCKED = [
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

export function sanitizeCwds(raw: unknown, opts?: { mustExist?: boolean }): string[] {
  const list = Array.isArray(raw) ? raw : []
  const out: string[] = []
  const mustExist = opts?.mustExist !== false
  for (const item of list) {
    const text = String(item || '').trim()
    if (!text || text.includes('\0')) continue
    let resolved: string
    try {
      resolved = resolve(text.replace(/^~(?=\/|$)/, homedir()))
    } catch {
      continue
    }
    if (!isAbsolute(resolved)) continue
    const blocked = BLOCKED.some((p) => resolved === p || resolved.startsWith(p + sep))
    if (blocked) continue
    if (mustExist) {
      try {
        if (!statSync(resolved).isDirectory()) continue
      } catch {
        continue
      }
    }
    if (!out.includes(resolved)) out.push(resolved)
    if (out.length >= 8) break
  }
  return out
}

export function assertPathInsideCwd(cwd: string, target: string): string {
  const root = realpathSync(resolve(cwd))
  const abs = resolve(root, target)
  let real: string
  try {
    real = existsSync(abs) ? realpathSync(abs) : abs
  } catch {
    real = abs
  }
  const rel = relative(root, real)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new AutomationError('cwd_invalid', '路径超出工作目录')
  }
  return real
}

const TEXT_EXT = new Set([
  '.md',
  '.txt',
  '.json',
  '.ts',
  '.js',
  '.tsx',
  '.jsx',
  '.py',
  '.yml',
  '.yaml',
  '.toml',
  '.csv',
  '.log',
  '.html',
  '.css',
  '.vue',
])

export function listDirSafe(cwd: string, sub = '.', max = 40): string[] {
  const dir = assertPathInsideCwd(cwd, sub || '.')
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    throw new AutomationError('cwd_invalid', '无法读取目录')
  }
  const out: string[] = []
  for (const name of names) {
    if (name.startsWith('.')) continue
    const p = join(dir, name)
    try {
      const st = statSync(p)
      out.push(`${st.isDirectory() ? 'dir' : 'file'}\t${name}`)
    } catch {
      continue
    }
    if (out.length >= max) break
  }
  return out
}

export function readFileSafe(cwd: string, relPath: string, maxBytes = 64_000): string {
  const file = assertPathInsideCwd(cwd, relPath)
  const st = statSync(file)
  if (!st.isFile()) throw new AutomationError('cwd_invalid', '不是文件')
  if (st.size > maxBytes) throw new AutomationError('cwd_invalid', `文件过大（>${maxBytes} 字节）`)
  const ext = file.includes('.') ? file.slice(file.lastIndexOf('.')).toLowerCase() : ''
  if (ext && !TEXT_EXT.has(ext)) {
    throw new AutomationError('cwd_invalid', `不支持的文件类型 ${ext}`)
  }
  return readFileSync(file, 'utf8')
}

export function listNewerFiles(cwd: string, sinceSec: number, max = 40): { path: string; mtime: number }[] {
  const root = realpathSync(resolve(cwd))
  const out: { path: string; mtime: number }[] = []
  const walk = (dir: string, depth: number) => {
    if (out.length >= max || depth > 4) return
    let names: string[] = []
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    for (const name of names) {
      if (name.startsWith('.') || name === 'node_modules' || name === 'lib') continue
      const p = join(dir, name)
      let st
      try {
        st = statSync(p)
      } catch {
        continue
      }
      if (st.isDirectory()) walk(p, depth + 1)
      else if (st.isFile() && Math.floor(st.mtimeMs / 1000) >= sinceSec) {
        out.push({ path: relative(root, p) || name, mtime: Math.floor(st.mtimeMs / 1000) })
        if (out.length >= max) return
      }
    }
  }
  walk(root, 0)
  out.sort((a, b) => b.mtime - a.mtime)
  return out
}
