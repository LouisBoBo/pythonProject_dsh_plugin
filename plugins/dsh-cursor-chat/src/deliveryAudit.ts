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
import { verifyPageSizeContractOnTarget } from './paramContractVerify.js'
import { verifySchemaDriftOnTarget } from './schemaDriftVerify.js'
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

/** 只有落盘/删除验尸没对上时，结果才算未完成（修不了只能失败）。 */
const LANDING_CHECK = new Set(['synced_bytes', 'delete_target'])

/**
 * 可交给 Cursor 续修的审计项。
 * 流程：写码 → 审计发现问题 → 自动续修 → 再验；禁止把这些问题留给用户。
 */
export const FIXABLE_AUDIT = new Set([
  'param_contract',
  'api_mount',
  'menu',
  'requirement_page',
  'schema_drift',
])

export function auditBlocksDelivery(audit: { ok: boolean; checks?: { name: string; ok: boolean }[] } | null | undefined): boolean {
  if (!audit || audit.ok) return false
  return (audit.checks || []).some((check) => LANDING_CHECK.has(check.name) && check.ok === false)
}

export function fixableAuditFailures(
  audit: { checks?: { name: string; ok: boolean; detail: string }[] } | null | undefined,
): { name: string; ok: boolean; detail: string }[] {
  return (audit?.checks || []).filter((c) => c && c.ok === false && FIXABLE_AUDIT.has(c.name))
}

/** 还有可修的审计失败 → 不得标「已完成」，须续修后再验。 */
export function auditNeedsRepair(
  audit: { ok?: boolean; checks?: { name: string; ok: boolean; detail: string }[] } | null | undefined,
): boolean {
  return fixableAuditFailures(audit).length > 0
}

/** 把审计失败项写成 Cursor 续修提示（只含权威检查 detail，不扫用户正文）。 */
export function buildAuditRepairPrompt(
  requirement: string,
  failures: { name: string; detail: string }[],
): string {
  const lines = failures
    .map((f) => `- [${f.name}] ${String(f.detail || '').trim()}`)
    .filter((l) => l.length > 4)
  return (
    `交付审计未通过，请在沙箱内直接修好下列问题后收工（不要只改说明文案）。\n\n` +
    `【审计失败项】\n${lines.join('\n') || '-（无明细）'}\n\n` +
    `【要求】\n` +
    `- 按失败项最小必要改动；分页超限就把 page_size 调到 ≤ 后端 le。\n` +
    `- 未挂载就把 router include 进挂载文件；缺页面就补 views 与路由/菜单接线。\n` +
    `- 库缺 ORM 列：在项目既有 db_migrate / 启动迁移里补 ALTER（或空表重建），禁止只改模型不改库。\n` +
    `- 终稿仍须含「## 说明方案」。\n\n` +
    `【原始诉求】\n${String(requirement || '').trim()}\n`
  )
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

  // 2b) 分页契约：前端 page_size 字面量不得超过后端 Query le（否则首屏 422）
  {
    const pageSize = verifyPageSizeContractOnTarget(input.workspace, {
      synced_files: synced,
    })
    if (pageSize.detail || !pageSize.ok) {
      checks.push({ name: 'param_contract', ok: pageSize.ok, detail: pageSize.detail || '' })
    }
  }

  // 2c) ORM↔SQLite 列漂移（缺列会列表 500，OpenAPI 有路径仍假通过）
  {
    const schema = verifySchemaDriftOnTarget(input.workspace, {
      synced_files: synced,
    })
    if (schema.detail || !schema.ok) {
      checks.push({ name: 'schema_drift', ok: schema.ok, detail: schema.detail || '' })
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
