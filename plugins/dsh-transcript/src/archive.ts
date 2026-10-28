import { lstat, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import {
  isPositiveIntegerTurn,
  projectTurn,
  safeSessionId,
  sessionTitleFromEvents,
  turnHasContent,
  type SessionEvent,
} from './events.js'
import { readSessionCover, renderIndex, renderSessionCover, renderTurnDocument, type IndexRow } from './render.js'
import { shanghaiIso } from './time.js'

export interface ArchiveInput {
  archiveRoot: string
  sessionId: string
  turn: unknown
  events: readonly SessionEvent[]
  workspace?: string
  now?: Date
}

export type ArchiveResult =
  | { ok: true; wrote: boolean; sessionDir?: string }
  | { ok: false; category: string }

const tails = new Map<string, Promise<void>>()

export async function archiveTurn(input: ArchiveInput): Promise<ArchiveResult> {
  try {
    if (!isPositiveIntegerTurn(input.turn)) return { ok: false, category: 'invalid_turn' }
    const sessionId = safeSessionId(input.sessionId.trim())
    if (!sessionId) return { ok: false, category: 'path_unsafe' }
    const root = resolve(input.archiveRoot)
    if (!isUsableRoot(root)) return { ok: false, category: 'path_unsafe' }
    const projected = projectTurn(input.events, input.turn)
    if (!projected) return { ok: false, category: 'slice_miss' }
    if (!turnHasContent(projected)) return { ok: true, wrote: false }
    const writtenAt = shanghaiIso(input.now ?? new Date())
    const title = sessionTitleFromEvents(input.events)
    const workspace = cleanWorkspace(input.workspace)
    const markdown = renderTurnDocument({
      sessionTitle: title,
      sessionId,
      turn: input.turn,
      writtenAt,
      projected,
    })
    const sessionDir = join(root, sessionId)
    await enqueue(root, async () => {
      await ensureRealDir(root, true)
      await ensureRealDir(sessionDir, false)
      const turnName = String(input.turn).padStart(3, '0')
      const turnDir = join(sessionDir, turnName)
      assertInside(root, turnDir)
      await ensureRealDir(turnDir, false)
      await atomicWrite(join(turnDir, '对话.md'), markdown)
      const turns = await listTurnNames(sessionDir)
      const cover = renderSessionCover({
        title,
        sessionId,
        updated: writtenAt,
        turns,
        ...workspace ? { workspace } : {},
      })
      await atomicWrite(join(sessionDir, '会话.md'), cover)
      await rewriteIndex(root)
    })
    return { ok: true, wrote: true, sessionDir }
  } catch (err) {
    return { ok: false, category: writeCategory(err) }
  }
}

export async function describeArchive(archiveRoot: string, sessionId: string | undefined): Promise<{ path: string; pending: boolean }> {
  const root = resolve(archiveRoot)
  const safe = sessionId ? safeSessionId(sessionId.trim()) : undefined
  if (!safe) return { path: root, pending: true }
  const sessionDir = join(root, safe)
  if (!isInside(root, sessionDir)) return { path: root, pending: true }
  try {
    const info = await lstat(sessionDir)
    if (info.isSymbolicLink() || !info.isDirectory()) return { path: root, pending: true }
    return { path: sessionDir, pending: false }
  } catch {
    return { path: root, pending: true }
  }
}

export function sessionIdFromExec(exec: unknown): string {
  if (!exec || typeof exec !== 'object') return ''
  const host = exec as {
    sessionId?: unknown
    session_id?: unknown
    session?: { id?: unknown }
    agent?: { session?: { id?: unknown }; sessionId?: unknown }
  }
  const direct = text(host.sessionId) || text(host.session_id) || text(host.session?.id)
  if (direct) return direct
  try {
    return text(host.agent?.session?.id) || text(host.agent?.sessionId)
  } catch {
    return ''
  }
}

async function rewriteIndex(root: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true })
  const rows: IndexRow[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    if (!safeSessionId(entry.name)) continue
    const sessionDir = join(root, entry.name)
    let title = '未命名会话'
    let updated = ''
    try {
      const cover = readSessionCover(await readFile(join(sessionDir, '会话.md'), 'utf8'))
      title = cover.title
      updated = cover.updated
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    const turns = await listTurnNames(sessionDir)
    if (turns.length === 0 && updated === '' && title === '未命名会话') continue
    rows.push({
      title,
      sessionId: entry.name,
      latestTurn: turns[turns.length - 1] ?? '',
      updated,
    })
  }
  rows.sort((a, b) => {
    if (a.updated !== b.updated) return a.updated < b.updated ? 1 : -1
    return a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0
  })
  await atomicWrite(join(root, 'index.md'), renderIndex(rows))
}

async function listTurnNames(sessionDir: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(sessionDir, { withFileTypes: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const names: { n: number; name: string }[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    if (!/^\d{3,}$/.test(entry.name)) continue
    const n = Number(entry.name)
    if (!Number.isInteger(n)) continue
    try {
      const info = await stat(join(sessionDir, entry.name, '对话.md'))
      if (!info.isFile()) continue
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw err
    }
    names.push({ n, name: entry.name })
  }
  names.sort((a, b) => a.n - b.n)
  return names.map((item) => item.name)
}

async function ensureRealDir(dir: string, allowCreateParents: boolean): Promise<void> {
  try {
    const info = await lstat(dir)
    if (info.isSymbolicLink()) throw coded('SYMLINK')
    if (!info.isDirectory()) throw coded('ENOTDIR')
    return
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  await mkdir(dir, { recursive: allowCreateParents })
  const created = await lstat(dir)
  if (created.isSymbolicLink()) throw coded('SYMLINK')
  if (!created.isDirectory()) throw coded('ENOTDIR')
}

async function atomicWrite(filePath: string, text: string): Promise<void> {
  const tmp = `${filePath}.tmp`
  await writeFile(tmp, text, 'utf8')
  await rename(tmp, filePath)
}

function enqueue(root: string, task: () => Promise<void>): Promise<void> {
  const prev = tails.get(root) ?? Promise.resolve()
  const run = prev.then(task, task)
  tails.set(root, run.then(() => undefined, () => undefined))
  return run
}

function isUsableRoot(root: string): boolean {
  if (!root || root === sep || /^[A-Za-z]:\\$/.test(root)) return false
  return true
}

function assertInside(root: string, target: string): void {
  if (!isInside(root, target)) throw coded('PATH')
}

function isInside(root: string, target: string): boolean {
  const base = root.endsWith(sep) ? root : root + sep
  return target.startsWith(base)
}

function cleanWorkspace(value: string | undefined): string | undefined {
  if (!value) return undefined
  const cleaned = value.replace(/[\u0000-\u001f`]/g, ' ').trim().slice(0, 1024)
  return cleaned || undefined
}

function writeCategory(err: unknown): string {
  const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: unknown }).code ?? '') : ''
  if (/^[A-Z][A-Z0-9_]{0,31}$/.test(code)) return `write_failed:${code}`
  return 'write_failed'
}

function coded(code: string): NodeJS.ErrnoException {
  const err = new Error(code) as NodeJS.ErrnoException
  err.code = code
  return err
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
