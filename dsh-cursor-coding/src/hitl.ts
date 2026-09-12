/**
 * HITL 一次性 nonce（改编自 WorkBuddy engine/app/hitl 语义；独立实现，不依赖 WB 进程）。
 * 确认/同步必须由面板签发，禁止仅凭 Agent confirmed=true 开工。
 */
import { createHash, randomBytes } from 'node:crypto'
import type { HitlAction, HitlRecord } from './types.js'

const DEFAULT_TTL_SEC = 600
const STORE = new Map<string, HitlRecord>()

function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

export function hashRequirement(requirement: string): string {
  return createHash('sha256').update(String(requirement || '').trim()).digest('hex').slice(0, 16)
}

export function issue(opts: {
  action: HitlAction
  workspace?: string
  requirement?: string
  job_id?: string
  ttl_sec?: number
}): { ok: true; nonce: string; action: HitlAction; exp: number } {
  const ttl = Math.max(60, Math.min(3600, opts.ttl_sec ?? DEFAULT_TTL_SEC))
  const nonce = 'htl_' + randomBytes(18).toString('base64url')
  const exp = nowSec() + ttl
  const rec: HitlRecord = {
    action: opts.action,
    exp,
    used: false,
  }
  if (opts.workspace) rec.workspace = String(opts.workspace).trim()
  if (opts.requirement !== undefined) rec.requirement_hash = hashRequirement(opts.requirement)
  if (opts.job_id) rec.job_id = String(opts.job_id).trim()
  STORE.set(nonce, rec)
  return { ok: true, nonce, action: opts.action, exp }
}

export function consume(opts: {
  nonce: string
  action: HitlAction
  workspace?: string
  requirement?: string
  job_id?: string
}): { ok: boolean; detail?: string; code?: string } {
  const token = String(opts.nonce || '').trim()
  if (!token) {
    return {
      ok: false,
      detail: '缺少 HITL nonce：请在确认卡点击确认（勿仅用 Agent 参数开工）',
      code: 'hitl_nonce_missing',
    }
  }
  const rec = STORE.get(token)
  if (!rec || rec.used) {
    return {
      ok: false,
      detail: 'HITL nonce 无效或已使用/过期，请重新在确认卡操作',
      code: 'hitl_nonce_invalid',
    }
  }
  if (rec.action !== opts.action) {
    return {
      ok: false,
      detail: `HITL nonce 动作不匹配（期望 ${opts.action}）`,
      code: 'hitl_nonce_action',
    }
  }
  if (nowSec() > rec.exp) {
    STORE.delete(token)
    return { ok: false, detail: 'HITL nonce 已过期，请重新确认', code: 'hitl_nonce_expired' }
  }
  if (rec.workspace && opts.workspace && rec.workspace !== String(opts.workspace).trim()) {
    return { ok: false, detail: 'HITL nonce 与 workspace 不匹配', code: 'hitl_workspace' }
  }
  if (rec.requirement_hash && opts.requirement !== undefined) {
    if (rec.requirement_hash !== hashRequirement(opts.requirement)) {
      return {
        ok: false,
        detail: 'HITL nonce 与需求摘要不匹配（请重新点确认卡）',
        code: 'hitl_requirement',
      }
    }
  }
  if (rec.job_id && opts.job_id && rec.job_id !== String(opts.job_id).trim()) {
    return { ok: false, detail: 'HITL nonce 与 job_id 不匹配', code: 'hitl_job' }
  }
  rec.used = true
  STORE.set(token, rec)
  return { ok: true }
}

/** 测试用：清空内存表 */
export function _resetHitlStoreForTests(): void {
  STORE.clear()
}
