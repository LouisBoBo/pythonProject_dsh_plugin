import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { EscConfig } from './types.js'
import { asNumber, asString, DEFAULT_PORT, ensurePrivateDir, ensurePrivateFile } from './util.js'

export function defaultDataRoot(): string {
  return join(homedir(), '.zhongruan', 'esc')
}

function emptyConfig(): EscConfig {
  return {
    listen: '127.0.0.1',
    port: DEFAULT_PORT,
    dataRoot: defaultDataRoot(),
  }
}

function configPath(dataRoot?: string): string {
  return join(dataRoot || defaultDataRoot(), 'config.json')
}

function tightenDataRoot(dir: string): void {
  ensurePrivateDir(dir)
  ensurePrivateFile(configPath(dir))
  ensurePrivateFile(join(dir, 'state.json'))
}

function clampListen(raw: string): string {
  const s = raw.trim() || '127.0.0.1'
  if (s === 'localhost' || s === '127.0.0.1') return '127.0.0.1'
  return '127.0.0.1'
}

export function loadConfig(overrideRoot?: string): EscConfig {
  const env = process.env
  const base = emptyConfig()
  const file = configPath(overrideRoot || env.DSH_ESC_HOME || base.dataRoot)
  let disk: Record<string, unknown> = {}
  if (existsSync(file)) {
    try {
      disk = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    } catch {
      disk = {}
    }
  }
  const dataRoot = overrideRoot || env.DSH_ESC_HOME || asString(disk.dataRoot, base.dataRoot)
  const cfg: EscConfig = {
    listen: clampListen(env.DSH_ESC_LISTEN || asString(disk.listen, base.listen)),
    port: asNumber(env.DSH_ESC_PORT || disk.port, base.port),
    dataRoot,
  }
  tightenDataRoot(cfg.dataRoot)
  return cfg
}

export function saveConfig(partial: Partial<EscConfig>, overrideRoot?: string): EscConfig {
  const current = loadConfig(overrideRoot)
  const next: EscConfig = {
    ...current,
    ...partial,
    listen: clampListen(partial.listen ?? current.listen),
  }
  tightenDataRoot(next.dataRoot)
  writeFileSync(configPath(next.dataRoot), JSON.stringify(next, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  })
  try {
    chmodSync(configPath(next.dataRoot), 0o600)
  } catch {
    /* ignore */
  }
  return loadConfig(overrideRoot || next.dataRoot)
}

export function publicConfigView(cfg: EscConfig) {
  return {
    listen: cfg.listen,
    port: cfg.port,
    addr: `http://${cfg.listen}:${cfg.port}`,
    dataRoot: cfg.dataRoot,
  }
}
