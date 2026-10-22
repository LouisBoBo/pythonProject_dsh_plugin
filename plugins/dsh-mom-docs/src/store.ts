import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { extname, join } from 'node:path'
import {
  assertCalendarDate,
  assertInside,
  resolveWorkspaceDir,
  safeFileName,
  shanghaiDate,
  toPortableRelative,
} from './paths.js'
import { MomError, type LibraryDay, type LibraryFile, type ListedDoc, type SaveResult } from './types.js'

export const MAX_BYTES = 512 * 1024
const MAX_INDEX_BYTES = 1024 * 1024

function withTrailingNewline(content: string): string {
  return content.endsWith('\n') ? content : `${content}\n`
}

function errnoCode(err: unknown): string {
  if (!err || typeof err !== 'object' || !('code' in err)) return ''
  return String((err as { code?: unknown }).code || '')
}

function assertRealDirectory(workspace: string, dir: string): string {
  assertInside(workspace, dir)
  let stat: ReturnType<typeof lstatSync>
  try {
    stat = lstatSync(dir)
  } catch {
    throw new MomError('directory_invalid', '目录不可读')
  }
  if (stat.isSymbolicLink()) throw new MomError('directory_invalid', '拒绝符号链接目录')
  if (!stat.isDirectory()) throw new MomError('directory_invalid', '路径不是目录')
  let real: string
  try {
    real = realpathSync(dir)
  } catch {
    throw new MomError('directory_invalid', '目录无法解析')
  }
  assertInside(workspace, real)
  return real
}

function tryRealDirectory(workspace: string, dir: string): string | null {
  try {
    return assertRealDirectory(workspace, dir)
  } catch (err) {
    if (err instanceof MomError) return null
    return null
  }
}

function openMomDay(workspace: string, date: string): string | null {
  const mom = tryRealDirectory(workspace, join(workspace, 'MOM'))
  if (!mom) return null
  const day = join(mom, assertCalendarDate(date))
  assertInside(workspace, day)
  return tryRealDirectory(workspace, day)
}

function ensureDayDir(workspace: string, date: string): string {
  const mom = join(workspace, 'MOM')
  assertInside(workspace, mom)
  if (!existsSync(mom)) mkdirSync(mom)
  const realMom = assertRealDirectory(workspace, mom)
  const day = join(realMom, assertCalendarDate(date))
  assertInside(workspace, day)
  if (!existsSync(day)) mkdirSync(day)
  return assertRealDirectory(workspace, day)
}

function writeNewFile(dayDir: string, requested: string, body: string): string {
  const ext = extname(requested)
  const stem = requested.slice(0, -ext.length)
  for (let n = 1; n <= 100; n += 1) {
    const candidate = n === 1 ? requested : `${stem}-${n}${ext}`
    const filePath = assertInside(dayDir, join(dayDir, candidate))
    try {
      writeFileSync(filePath, body, { encoding: 'utf8', flag: 'wx' })
    } catch (err) {
      if (errnoCode(err) === 'EEXIST') continue
      throw err
    }
    try {
      const stat = lstatSync(filePath)
      if (stat.isSymbolicLink() || !stat.isFile()) throw new MomError('write_failed', '写入失败')
      assertInside(dayDir, realpathSync(filePath))
    } catch (err) {
      try {
        unlinkSync(filePath)
      } catch {
        // 校验失败时尽量不留下半成品
      }
      if (err instanceof MomError) throw err
      throw new MomError('write_failed', '写入失败')
    }
    return candidate
  }
  throw new MomError('write_failed', '同名文件超过 100 个')
}

function readRegularText(workspace: string, filePath: string): string {
  assertInside(workspace, filePath)
  let stat: ReturnType<typeof lstatSync>
  try {
    stat = lstatSync(filePath)
  } catch {
    throw new MomError('filename_invalid', '文件不存在')
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new MomError('filename_invalid', '文件不存在')
  }
  let real: string
  try {
    real = realpathSync(filePath)
  } catch {
    throw new MomError('filename_invalid', '文件不存在')
  }
  assertInside(workspace, real)
  const realStat = lstatSync(real)
  if (realStat.isSymbolicLink() || !realStat.isFile()) {
    throw new MomError('filename_invalid', '文件不存在')
  }
  if (realStat.size > MAX_BYTES) throw new MomError('content_too_large', '文件超过 512 KiB')
  return readFileSync(real, 'utf8')
}

export function saveDocument(input: {
  directory: string
  filename: string
  title: string
  content: string
  now?: Date
}): SaveResult {
  const workspace = resolveWorkspaceDir(input.directory)
  const now = input.now ?? new Date()
  const date = shanghaiDate(now)
  const requested = safeFileName(input.filename, input.title)
  const text = String(input.content ?? '')
  if (!text.trim()) throw new MomError('content_empty', '正文为空')
  const body = withTrailingNewline(text)
  const bytes = Buffer.byteLength(body, 'utf8')
  if (bytes > MAX_BYTES) throw new MomError('content_too_large', '正文超过 512 KiB')

  const dayDir = ensureDayDir(workspace, date)
  let fileName: string
  try {
    fileName = writeNewFile(dayDir, requested, body)
  } catch (err) {
    if (err instanceof MomError) throw err
    throw new MomError('write_failed', '写入失败')
  }
  const filePath = assertInside(workspace, join(dayDir, fileName))

  const title = String(input.title || '').trim().slice(0, 120)
  const indexWritten = appendIndex(
    dayDir,
    JSON.stringify({ savedAt: now.toISOString(), date, fileName, title, bytes }) + '\n',
  )

  return {
    filePath,
    relativePath: toPortableRelative(workspace, filePath),
    fileName,
    date,
    bytes,
    title,
    indexWritten,
  }
}

function appendIndex(dayDir: string, line: string): boolean {
  const indexPath = join(dayDir, '_index.jsonl')
  try {
    assertInside(dayDir, indexPath)
    try {
      const stat = lstatSync(indexPath)
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_INDEX_BYTES) return false
      assertInside(dayDir, realpathSync(indexPath))
    } catch (err) {
      if (errnoCode(err) !== 'ENOENT') return false
    }
    appendFileSync(indexPath, line, { encoding: 'utf8', flag: 'a' })
    const written = lstatSync(indexPath)
    if (written.isSymbolicLink() || !written.isFile()) return false
    assertInside(dayDir, realpathSync(indexPath))
    return true
  } catch {
    return false
  }
}

function readTitleIndex(dayDir: string): Map<string, { title: string; savedAt: string }> {
  const out = new Map<string, { title: string; savedAt: string }>()
  const indexPath = join(dayDir, '_index.jsonl')
  let stat: ReturnType<typeof lstatSync>
  try {
    stat = lstatSync(indexPath)
  } catch {
    return out
  }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_INDEX_BYTES) return out
  try {
    assertInside(dayDir, realpathSync(indexPath))
  } catch {
    return out
  }
  const lines = readFileSync(indexPath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      const row = JSON.parse(line) as { fileName?: unknown; title?: unknown; savedAt?: unknown }
      if (typeof row.fileName !== 'string' || !row.fileName) continue
      out.set(row.fileName, {
        title: typeof row.title === 'string' ? row.title : '',
        savedAt: typeof row.savedAt === 'string' ? row.savedAt : '',
      })
    } catch {
      continue
    }
  }
  return out
}

export function listDocuments(
  directory: string,
  dateRaw: string,
  now = new Date(),
): { date: string; items: ListedDoc[] } {
  const workspace = resolveWorkspaceDir(directory)
  const date = assertCalendarDate(String(dateRaw || '').trim() ? String(dateRaw).trim() : shanghaiDate(now))
  const dayDir = openMomDay(workspace, date)
  if (!dayDir) return { date, items: [] }
  const titles = readTitleIndex(dayDir)
  const items: ListedDoc[] = []
  for (const fileName of readdirSync(dayDir).sort()) {
    if (fileName.startsWith('_') || fileName.startsWith('.')) continue
    const ext = extname(fileName).toLowerCase()
    if (ext !== '.md' && ext !== '.txt') continue
    try {
      const filePath = join(dayDir, fileName)
      const stat = lstatSync(filePath)
      if (stat.isSymbolicLink() || !stat.isFile()) continue
      assertInside(workspace, realpathSync(filePath))
      const meta = titles.get(fileName)
      items.push({
        fileName,
        bytes: stat.size,
        title: meta?.title || '',
        savedAt: meta?.savedAt || '',
      })
    } catch {
      continue
    }
  }
  return { date, items }
}

export function readDocument(
  directory: string,
  dateRaw: string,
  filename: string,
  now = new Date(),
): { filePath: string; content: string; date: string; fileName: string } {
  const workspace = resolveWorkspaceDir(directory)
  const date = assertCalendarDate(String(dateRaw || '').trim() ? String(dateRaw).trim() : shanghaiDate(now))
  const fileName = safeFileName(filename, '')
  const dayDir = openMomDay(workspace, date)
  if (!dayDir) throw new MomError('filename_invalid', '文件不存在')
  const filePath = assertInside(workspace, join(dayDir, fileName))
  return { filePath, content: readRegularText(workspace, filePath), date, fileName }
}

export function listLibrary(directory: string): { directory: string; days: LibraryDay[] } {
  const workspace = resolveWorkspaceDir(directory)
  const mom = tryRealDirectory(workspace, join(workspace, 'MOM'))
  if (!mom) return { directory: workspace, days: [] }

  const dates = readdirSync(mom)
    .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))

  const days: LibraryDay[] = []
  for (const date of dates) {
    try {
      assertCalendarDate(date)
    } catch {
      continue
    }
    const dayDir = tryRealDirectory(workspace, join(mom, date))
    if (!dayDir) continue
    const titles = readTitleIndex(dayDir)
    const items: LibraryFile[] = []
    for (const name of readdirSync(dayDir)) {
      if (name.startsWith('_') || name.startsWith('.')) continue
      const ext = extname(name).toLowerCase()
      if (ext !== '.md' && ext !== '.txt') continue
      const filePath = join(dayDir, name)
      let stat
      try {
        stat = lstatSync(filePath)
        if (!stat.isFile() || stat.isSymbolicLink()) continue
        assertInside(workspace, realpathSync(filePath))
      } catch {
        continue
      }
      const meta = titles.get(name)
      items.push({
        fileName: name,
        title: meta?.title || '',
        bytes: stat.size,
        savedAt: meta?.savedAt || '',
        mtimeMs: stat.mtimeMs,
        kind: ext === '.txt' ? 'txt' : 'md',
      })
    }
    items.sort((a, b) => b.mtimeMs - a.mtimeMs || a.fileName.localeCompare(b.fileName, 'zh-CN'))
    if (items.length > 0) days.push({ date, items })
  }
  return { directory: workspace, days }
}
