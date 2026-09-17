import { homedir } from 'node:os'
import { isAbsolute, join, resolve, sep } from 'node:path'
import Schema from '@deepseek-ai/schemastery'

export const DEFAULT_MAX_FILE_BYTES = 52_428_800

export interface MeterConfig {
  enabled?: boolean
  eventsPath?: string
  maxFileBytes?: number
}

export const Config = Schema.object({
  enabled: Schema.boolean().default(true).description('是否在 llm/stream 出口记账'),
  eventsPath: Schema.string().description('events.jsonl 绝对路径；默认 $DSH_HOME/llm-meter/events.jsonl'),
  maxFileBytes: Schema.number().min(1024).default(DEFAULT_MAX_FILE_BYTES).description('单文件软上限（字节），超出则轮转且不删除近期文件'),
})

export function dshHome(): string {
  return process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
}

export function defaultEventsPath(): string {
  return join(dshHome(), 'llm-meter', 'events.jsonl')
}

/** 落盘路径必须落在 DSH_HOME 下，防止配置被改写到任意路径。 */
export function resolveEventsPath(raw: string | undefined): string {
  const home = resolve(dshHome())
  const fallback = join(home, 'llm-meter', 'events.jsonl')
  const text = String(raw ?? '').trim()
  if (!text) return fallback
  const candidate = resolve(isAbsolute(text) ? text : join(home, text))
  const prefix = home.endsWith(sep) ? home : home + sep
  if (candidate === home || !candidate.startsWith(prefix)) return fallback
  return candidate
}

export function resolveConfig(config: MeterConfig | undefined): Required<MeterConfig> {
  const enabled = config?.enabled !== false
  const eventsPath = resolveEventsPath(config?.eventsPath)
  const maxFileBytes = Number(config?.maxFileBytes)
  return {
    enabled,
    eventsPath,
    maxFileBytes: Number.isFinite(maxFileBytes) && maxFileBytes >= 1024
      ? Math.floor(maxFileBytes)
      : DEFAULT_MAX_FILE_BYTES,
  }
}
