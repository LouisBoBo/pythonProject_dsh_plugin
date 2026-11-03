/** 步骤返回值与通用清洗。 */

import type { Epic, StepResult } from '../types.js'

export function pass(summary: string, detail = '', evidence: Record<string, unknown> = {}): StepResult {
  return { status: 'pass', summary, detail, evidence }
}

export function skip(summary: string, detail = '', evidence: Record<string, unknown> = {}): StepResult {
  return { status: 'skipped', summary, detail, evidence }
}

export function wait(summary: string, detail = '', evidence: Record<string, unknown> = {}): StepResult {
  return { status: 'waiting_hitl', summary, detail, evidence }
}

export function fail(
  summary: string,
  detail = '',
  opts: {
    fatal?: boolean
    retryable?: 'infra'
    evidence?: Record<string, unknown>
  } = {},
): StepResult {
  return {
    status: 'fail',
    summary,
    detail,
    fatal: Boolean(opts.fatal),
    retryable: opts.retryable,
    evidence: opts.evidence || {},
  }
}

export function oneLiner(text: string, max = 120): string {
  const line = String(text || '')
    .split(/\r?\n/)
    .map((s) => s.replace(/^#+\s*/, '').trim())
    .find(Boolean)
  if (!line) return ''
  return line.length > max ? `${line.slice(0, max)}…` : line
}

/** 去掉宿主 runtime / 记忆库注入，避免把系统噪音当业务需求。 */
export function cleanRequirement(text: string, max = 6000): string {
  const lines = String(text || '').split(/\r?\n/)
  const kept = lines.filter((line) => {
    const s = line.trim()
    if (!s) return true
    if (/^<\/?(?:runtime|memory|knowledge|system|tool)[\s>]/i.test(s)) return false
    if (/^(?:runtime|memory|knowledge)\s*(?:context|protocol|库|偏好)/i.test(s)) return false
    if (/^【(?:runtime|记忆库|知识库)/.test(s)) return false
    return true
  })
  return kept.join('\n').trim().slice(0, max)
}

export function getMustFix(epic: Epic): string[] {
  const mandate = epic.artifacts.implement_fix_mandate
  return Array.isArray(mandate?.must_fix) ? mandate.must_fix.slice(0, 12) : []
}
