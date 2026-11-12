/**
 * 交付审计（写完 → 同步后 → 目标盘验尸）。
 *
 * 只认权威字段：synced/deleted/deferred/requirement + 沙箱/目标文件指纹。
 * 禁止用 Cursor 结论文案「已完成」当交付证据。
 *
 * 复用已有 apiVerify / menuVerify / deleteVerify；本模块负责编排与落盘一致性。
 */
import { verifyApiMountedOnTarget } from './apiVerify.js'
import {
  validateDeleteCompletion,
  verifyDeleteOnTarget,
} from './deleteVerify.js'
import { isDeleteIntent } from './deleteIntent.js'
import { verifyAddMenuOnTarget } from './menuVerify.js'
import { finishAudit, requirementEvidenceChecks } from './completionAudit.js'
import { verifySyncedFingerprints } from './sandbox.js'

export type DeliveryAuditCheck = {
  name: string
  ok: boolean
  detail: string
}

export type DeliveryAuditResult = {
  ok: boolean
  checks: DeliveryAuditCheck[]
  detail: string
  completion?: { passed: number; total: number; percent: number }
}

export type DeliveryAuditInput = {
  workspace: string
  sandbox: string | null | undefined
  requirement: string
  synced_files: string[]
  deleted_files?: string[]
  deferred_files?: string[]
  assistant_text?: string
}

/** 只有落盘本身没对上时，结果才算未完成。其余核对留在审计行。 */
const LANDING_CHECK = new Set(['synced_bytes', 'delete_target'])

export function auditBlocksDelivery(audit: { ok: boolean; checks?: { name: string; ok: boolean }[] } | null | undefined): boolean {
  if (!audit || audit.ok) return false
  return (audit.checks || []).some((check) => LANDING_CHECK.has(check.name) && check.ok === false)
}

/**
 * 同步后交付审计。无同步且无删除时跳过（空跑闸门另管）。
 * 任一子检查失败则审计 ok=false。只有落盘指纹或删除验尸失败才拦住结果。
 */
export function runDeliveryAudit(input: DeliveryAuditInput): DeliveryAuditResult {
  const synced = Array.isArray(input.synced_files) ? input.synced_files : []
  const deleted = Array.isArray(input.deleted_files) ? input.deleted_files : []
  const deferred = Array.isArray(input.deferred_files) ? input.deferred_files : []
  const requirement = String(input.requirement || '')
  const checks: DeliveryAuditCheck[] = []

  if (!synced.length && !deleted.length) {
    return { ok: true, checks: [], detail: '' }
  }

  // 1) 落盘一致性：沙箱声称同步的文件，目标工程须存在且指纹一致
  if (synced.length && input.sandbox) {
    const fp = verifySyncedFingerprints(input.sandbox, input.workspace, synced)
    checks.push({
      name: 'synced_bytes',
      ok: fp.ok,
      detail: fp.detail || (fp.ok ? '落盘指纹一致' : '落盘不一致'),
    })
  }

  // 2) FastAPI 路由挂载（仅当同步了新 APIRouter 模块时生效）
  {
    const api = verifyApiMountedOnTarget(input.workspace, requirement, {
      synced_files: synced,
    })
    if (api.detail || !api.ok) {
      checks.push({ name: 'api_mount', ok: api.ok, detail: api.detail || '' })
    }
  }

  // 3) 菜单/接线（deferred 接线永久 blocker；新增菜单 intent 才查 catalog）
  {
    const menu = verifyAddMenuOnTarget(input.workspace, requirement, {
      synced_files: synced,
      deferred_files: deferred,
    })
    if (menu.detail || !menu.ok) {
      checks.push({ name: 'menu', ok: menu.ok, detail: menu.detail || '' })
    }
  }

  // 4) 删除类：目标盘菜单/孤儿文件 + 声称删除仍在盘
  if (isDeleteIntent(requirement)) {
    const del = verifyDeleteOnTarget(input.workspace, requirement, {
      synced_files: synced,
      deleted_files: deleted,
    })
    checks.push({
      name: 'delete_target',
      ok: del.ok,
      detail: del.detail || (del.ok ? '删除验尸通过' : '删除验尸失败'),
    })
    const claimErr = validateDeleteCompletion(
      requirement,
      String(input.assistant_text || ''),
      deleted,
      { target_root: input.workspace },
    )
    if (claimErr) {
      checks.push({ name: 'delete_claim', ok: false, detail: claimErr })
    }
  }

  for (const extra of requirementEvidenceChecks(requirement, synced, deleted)) {
    checks.push(extra)
  }

  return finishAudit(checks)
}
