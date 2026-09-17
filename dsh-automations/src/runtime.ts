import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nowSec, withLock, writeJsonAtomic } from './util.js'

const STALE_SEC = 6 * 3600

type RuntimeFile = { running: Record<string, { run_id: string; started_at: number }> }

function runtimePath(dataRoot: string): string {
  const d = join(dataRoot, 'data')
  mkdirSync(d, { recursive: true })
  return join(d, 'runtime.json')
}

function readRuntime(dataRoot: string): RuntimeFile {
  const path = runtimePath(dataRoot)
  if (!existsSync(path)) return { running: {} }
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as RuntimeFile
    if (data && typeof data === 'object') return { running: data.running || {} }
  } catch {
    /* ignore */
  }
  return { running: {} }
}

function purge(running: RuntimeFile['running'], now = nowSec()): RuntimeFile['running'] {
  const out: RuntimeFile['running'] = {}
  for (const [id, meta] of Object.entries(running || {})) {
    if (!meta || typeof meta !== 'object') continue
    const started = Number(meta.started_at) || 0
    if (started && now - started > STALE_SEC) continue
    out[id] = meta
  }
  return out
}

export async function anyRunning(dataRoot: string): Promise<boolean> {
  return withLock(() => {
    const data = readRuntime(dataRoot)
    const running = purge(data.running)
    return Object.keys(running).length > 0
  })
}

export async function markRunning(dataRoot: string, automationId: string, runId: string): Promise<boolean> {
  return withLock(() => {
    const data = readRuntime(dataRoot)
    const running = purge(data.running)
    if (Object.keys(running).length > 0) return false
    if (running[automationId]) return false
    running[automationId] = { run_id: runId, started_at: nowSec() }
    writeJsonAtomic(runtimePath(dataRoot), { running })
    return true
  })
}

export async function clearRunning(dataRoot: string, automationId: string, runId?: string): Promise<void> {
  await withLock(() => {
    const data = readRuntime(dataRoot)
    const running = { ...data.running }
    const cur = running[automationId]
    if (!cur) return
    if (runId && cur.run_id !== runId) return
    delete running[automationId]
    writeJsonAtomic(runtimePath(dataRoot), { running })
  })
}

export async function clearAllRunning(dataRoot: string): Promise<void> {
  await withLock(() => {
    writeJsonAtomic(runtimePath(dataRoot), { running: {} })
  })
}
