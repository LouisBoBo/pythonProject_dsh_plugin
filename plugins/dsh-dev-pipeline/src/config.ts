/** 配置：宿主级 ~/.dsh/dev-pipeline/config.json + 工程级 .dsh/dev-pipeline.json。 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

import type { PipelineConfig } from './types.js'

export function expandHome(value: string): string {
  const s = String(value || '').trim()
  if (!s) return s
  if (s === '~') return homedir()
  if (s.startsWith('~/') || s.startsWith('~\\')) return resolve(homedir(), s.slice(2))
  return s
}

export function dshHome(): string {
  const raw = String(process.env.DSH_HOME || '').trim()
  return raw ? expandHome(raw) : join(homedir(), '.dsh')
}

export function defaultDataRoot(): string {
  return join(dshHome(), 'dev-pipeline')
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = String(process.env[name] ?? '').trim().toLowerCase()
  if (!raw) return fallback
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false
  return fallback
}

function envInt(name: string, fallback: number): number {
  const raw = String(process.env[name] ?? '').trim()
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function defaults(): PipelineConfig {
  return {
    dataRoot: defaultDataRoot(),
    cursorChatBase: 'http://127.0.0.1:18791',
    maxFixRounds: 3,
    maxDeployAttempts: 3,
    autoRun: true,
    push: true,
    prProvider: 'auto',
    stepPaceMs: 300,
    cursorTimeoutMs: 30 * 60 * 1000,
    validateCommands: [],
    deploy: {
      command: '',
      healthUrl: '',
      timeoutMs: 10 * 60 * 1000,
    },
    llm: {
      provider: '',
      model: '',
    },
    warnings: [],
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

function mergeInto(target: PipelineConfig, raw: unknown, source: string): void {
  if (!isRecord(raw)) {
    if (raw !== undefined) target.warnings.push(`${source} 不是 JSON 对象，已忽略`)
    return
  }
  const asString = (v: unknown, fallback: string): string =>
    typeof v === 'string' ? v : fallback
  const asBool = (v: unknown, fallback: boolean): boolean =>
    typeof v === 'boolean' ? v : fallback
  const asPosInt = (v: unknown, fallback: number): number => {
    const n = typeof v === 'number' ? Math.floor(v) : Number.NaN
    return Number.isFinite(n) && n > 0 ? n : fallback
  }

  if (raw.dataRoot !== undefined) {
    target.dataRoot = expandHome(asString(raw.dataRoot, target.dataRoot))
  }
  if (raw.cursorChatBase !== undefined) {
    target.cursorChatBase = asString(raw.cursorChatBase, target.cursorChatBase).replace(/\/+$/, '')
  }
  if (raw.maxFixRounds !== undefined) {
    target.maxFixRounds = asPosInt(raw.maxFixRounds, target.maxFixRounds)
  }
  if (raw.maxDeployAttempts !== undefined) {
    target.maxDeployAttempts = asPosInt(raw.maxDeployAttempts, target.maxDeployAttempts)
  }
  if (raw.autoRun !== undefined) target.autoRun = asBool(raw.autoRun, target.autoRun)
  if (raw.push !== undefined) target.push = asBool(raw.push, target.push)
  if (raw.prProvider === 'auto' || raw.prProvider === 'skip') target.prProvider = raw.prProvider
  if (raw.stepPaceMs !== undefined) {
    target.stepPaceMs = Math.max(0, asPosInt(raw.stepPaceMs, target.stepPaceMs))
  }
  if (raw.cursorTimeoutMs !== undefined) {
    target.cursorTimeoutMs = asPosInt(raw.cursorTimeoutMs, target.cursorTimeoutMs)
  }
  if (Array.isArray(raw.validateCommands)) {
    target.validateCommands = raw.validateCommands
      .map((x) => String(x || '').trim())
      .filter(Boolean)
  }
  if (isRecord(raw.deploy)) {
    if (raw.deploy.command !== undefined) {
      target.deploy.command = asString(raw.deploy.command, target.deploy.command).trim()
    }
    if (raw.deploy.healthUrl !== undefined) {
      target.deploy.healthUrl = asString(raw.deploy.healthUrl, target.deploy.healthUrl).trim()
    }
    if (raw.deploy.timeoutMs !== undefined) {
      target.deploy.timeoutMs = asPosInt(raw.deploy.timeoutMs, target.deploy.timeoutMs)
    }
  }
  if (isRecord(raw.llm)) {
    if (raw.llm.provider !== undefined) {
      target.llm.provider = asString(raw.llm.provider, target.llm.provider).trim()
    }
    if (raw.llm.model !== undefined) {
      target.llm.model = asString(raw.llm.model, target.llm.model).trim()
    }
  }
}

function readConfigFile(path: string, target: PipelineConfig): void {
  if (!existsSync(path)) return
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    mergeInto(target, raw, path)
  } catch (err) {
    target.warnings.push(`${path} 读取失败：${String(err)}`)
  }
}

export function loadConfig(workspace = ''): PipelineConfig {
  const cfg = defaults()
  readConfigFile(join(cfg.dataRoot, 'config.json'), cfg)
  if (workspace) {
    const ws = expandHome(workspace)
    readConfigFile(join(isAbsolute(ws) ? ws : resolve(ws), '.dsh', 'dev-pipeline.json'), cfg)
  }

  const envBase = String(process.env.DEV_PIPELINE_CURSOR_BASE || '').trim()
  if (envBase) cfg.cursorChatBase = envBase.replace(/\/+$/, '')
  const envRoot = String(process.env.DEV_PIPELINE_DATA_ROOT || '').trim()
  if (envRoot) cfg.dataRoot = expandHome(envRoot)
  cfg.maxFixRounds = envInt('DEV_PIPELINE_MAX_FIX_ROUNDS', cfg.maxFixRounds)
  cfg.maxDeployAttempts = envInt('DEV_PIPELINE_MAX_DEPLOY_ATTEMPTS', cfg.maxDeployAttempts)
  cfg.autoRun = envBool('DEV_PIPELINE_AUTO_RUN', cfg.autoRun)
  cfg.push = envBool('DEV_PIPELINE_PUSH', cfg.push)

  if (cfg.cursorChatBase.endsWith(':18788')) {
    cfg.cursorChatBase = 'http://127.0.0.1:18791'
    cfg.warnings.push('cursorChatBase 指向旧写码口 :18788，已改用对话写码 :18791')
  }
  return cfg
}
