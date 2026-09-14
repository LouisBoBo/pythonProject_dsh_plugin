/**
 * HITL 一次性 nonce（改编自 WorkBuddy engine/app/hitl 语义；独立实现，不依赖 WB 进程）。
 * 确认/同步必须由面板签发，禁止仅凭 Agent confirmed=true 开工。
 * 落盘：宿主工具与（可选）子进程 HTTP 共享同一账本。
 */
import { createHash, randomBytes } from 'node:crypto'
import { join } from 'node:path'
import type { HitlAction, HitlRecord } from './types.js'
import { readJsonFile, storeDir, withFileLock, writeJsonAtomic } from './diskStore.js'

const DEFAULT_TTL_SEC = 600

type HitlDisk = Record<string, HitlRecord>

function storePath(): string {
  return join(storeDir('state'), 'hitl-nonces.json')
}

function lockPath(): string {
  return storePath() + '.lock'
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

function purgeExpired(map: HitlDisk): void {
  const now = nowSec()
  for (const [k, rec] of Object.entries(map)) {
    if (!rec || rec.used || now > rec.exp) delete map[k]
  }
}

function mutate<T>(fn: (map: HitlDisk) => T): T {
  return withFileLock(lockPath(), () => {
    const map = readJsonFile<HitlDisk>(storePath(), {})
    purgeExpired(map)
    const out = fn(map)
    writeJsonAtomic(storePath(), map)
    return out
  })
}

export function hashRequirement(requirement: string): string {
  return createHash('sha256').update(String(requirement || '').trim()).digest('hex').slice(0, 16)
}

export function issue(opts: {
  action: HitlAction
  workspace?: string
  requirement?: string
  job_id?: string
  confirm_token?: string
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
  if (opts.confirm_token) rec.confirm_token = String(opts.confirm_token).trim()
  mutate((map) => {
    map[nonce] = rec
  })
  return { ok: true, nonce, action: opts.action, exp }
}

export function consume(opts: {
  nonce: string
  action: HitlAction
  workspace?: string
  requirement?: string
  job_id?: string
  confirm_token?: string
}): { ok: boolean; detail?: string; code?: string } {
  const token = String(opts.nonce || '').trim()
  if (!token) {
    return {
      ok: false,
      detail: '缺少 HITL nonce：请在确认卡点击确认（勿仅用 Agent 参数开工）',
      code: 'hitl_nonce_missing',
    }
  }
  return mutate((map) => {
    const rec = map[token]
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
      delete map[token]
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
    if (rec.confirm_token) {
      if (!opts.confirm_token || rec.confirm_token !== String(opts.confirm_token).trim()) {
        return {
          ok: false,
          detail: 'HITL nonce 与 confirm_token 不匹配',
          code: 'hitl_confirm_token',
        }
      }
    }
    rec.used = true
    map[token] = rec
    return { ok: true }
  })
}

/** 测试用：清空落盘表 */
export function _resetHitlStoreForTests(): void {
  mutate((map) => {
    for (const k of Object.keys(map)) delete map[k]
  })
}
