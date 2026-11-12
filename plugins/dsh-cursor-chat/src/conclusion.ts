/**
 * 聊天正文「本轮结论」：只认 Job 账本字段，不扫用户可见对话原文。
 * 固定友好三段：任务结果 → 做了什么 → 如何验证（格式硬约束）。
 */
import { isLocalDbRel } from './pathScope.js'
import { criticalDeferredFiles } from './scopeCompanions.js'
import { preferredConclusionAssistantText } from './transcript.js'
import { isInventoryOnlyRequirement } from './workKind.js'
import type { CursorCodingJob } from './types.js'

const SECTION_NAMES = [
  '结论',
  '任务结果',
  '一句话结论',
  '结果',
  '做了什么',
  '行为约定',
  '改动说明',
  '处理说明',
  '根因',
  '原因与处理',
  '改动文件',
  '变更文件',
  '如何验证',
  '验收',
  '验收步骤',
  '验证',
  '请确认',
  '质量门控',
] as const

/** 一个已同步路径只归一类，避免同一文件被写成两种审计对象。 */
function syncedFileKind(rel: string): string {
  const r = String(rel || '').replace(/\\/g, '/').replace(/^\.?\//, '')
  const fe = r.startsWith('frontend/') || r.includes('/frontend/')
  const be = r.startsWith('backend/') || r.includes('/backend/')
  if (/\.(vue|tsx|jsx)$/.test(r) && r.includes('/views/')) return '前端页面文件'
  if (fe && (r.includes('/config/') || r.includes('/router/') || r.includes('/layouts/'))) return '菜单配置'
  if (r.includes('/tests/') || /(?:^|\/)test_[^/]+\.py$/.test(r)) return '后端测试'
  if (
    r.startsWith('backend/app/api/') ||
    r.includes('/backend/app/api/') ||
    r.startsWith('backend/app/routers/') ||
    r.includes('/backend/app/routers/') ||
    /(?:^|\/)backend\/(?:app\/)?main\.py$/.test(r)
  ) {
    return '后端接口文件'
  }
  if (fe) return '前端文件'
  if (be) return '后端代码'
  return '已同步文件'
}

function describeSyncedKinds(paths: string[]): string[] {
  const order = ['前端页面文件', '菜单配置', '前端文件', '后端接口文件', '后端代码', '后端测试', '已同步文件']
  const found = new Set<string>()
  for (const raw of paths) {
    const rel = String(raw || '').trim()
    if (!rel) continue
    found.add(syncedFileKind(rel))
  }
  return order.filter((k) => found.has(k))
}

/**
 * 只复述账本里真正跑过的检查。没打开页面、没请求接口，就不能写成审计了界面或服务。
 */
function auditScopeLines(
  checks: { name: string; ok: boolean; detail: string }[],
  syncedPaths: string[],
): string[] {
  const lines: string[] = []
  const seen = new Set<string>()
  for (const c of checks) {
    if (!c || !c.ok || seen.has(c.name)) continue
    seen.add(c.name)
    if (c.name === 'synced_bytes') {
      const kinds = describeSyncedKinds(syncedPaths)
      lines.push(
        kinds.length
          ? `• 落盘：${kinds.join('、')}，本机内容与沙箱一致`
          : '• 落盘：已同步文件的本机内容与沙箱一致',
      )
    } else if (c.name === 'api_mount') {
      lines.push('• 后端接口挂载：读了 FastAPI 挂载文件，新路由已写入')
    } else if (c.name === 'menu') {
      lines.push(
        String(c.detail || '').includes('跳过')
          ? `• 菜单：${String(c.detail).trim()}`
          : '• 菜单注册：读了本机报表目录，对应项已设为可见',
      )
    } else if ((c.name === 'delete_target' || c.name === 'delete_claim') && c.detail) {
      lines.push(`• 删除核对：${String(c.detail).trim()}`)
    } else if (c.name === 'frontend_service') {
      lines.push(`• 前端服务：${String(c.detail || '').trim()}`)
    } else if (c.name === 'backend_service') {
      lines.push(`• 后端服务：${String(c.detail || '').trim()}`)
    } else if (c.name === 'requirement_page') {
      lines.push(`• 需求·页面：${String(c.detail || '').trim()}`)
    } else if (c.name === 'requirement_api') {
      lines.push(`• 需求·接口：${String(c.detail || '').trim()}`)
    } else if (c.name === 'pytest') {
      lines.push(`• 测试：${String(c.detail || '').trim()}`)
    } else if (c.detail) {
      lines.push(`• ${String(c.detail).trim()}`)
    }
  }
  return lines
}

function completionOf(audit: {
  checks?: { ok: boolean }[]
  completion?: { passed: number; total: number; percent: number }
}): { passed: number; total: number; percent: number } | null {
  if (audit.completion && audit.completion.total > 0) return audit.completion
  const checks = audit.checks || []
  if (!checks.length) return null
  const passed = checks.filter((c) => c.ok).length
  return { passed, total: checks.length, percent: Math.round((passed / checks.length) * 100) }
}

function auditHeadline(
  ok: boolean,
  hasItems: boolean,
  completion: { passed: number; total: number; percent: number } | null,
): string {
  const score = completion ? ` 完成度 ${completion.percent}%（${completion.passed}/${completion.total}）` : ''
  if (!ok) return `审计：❌ 未通过${score}`
  if (!hasItems) return `审计：⚠ 没有可核对的检查项${score}`
  return `审计：✅ 通过${score}`
}

function statusHeadline(status: string): string {
  if (status === 'succeeded') return '✅ 已完成'
  if (status === 'failed') return '❌ 未完成'
  if (status === 'cancelled') return '⏹ 已取消'
  if (status === 'pending_review') return '⏳ 待审同步'
  if (status === 'blocked_no_runner') return '⚠ 无法开工'
  return `状态：${status || '未知'}`
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 按 **标题** / ### 标题 切段；支持「**结论**：同行正文」 */
function splitNamedSections(src: string): Record<string, string> {
  const text = String(src || '').replace(/\r\n/g, '\n')
  const out: Record<string, string> = {}
  if (!text.trim()) return out
  const nameAlt = SECTION_NAMES.map(escapeRe).join('|')
  const headerRe = new RegExp(
    `(?:^|\\n)(?:#{1,3}\\s*)?(?:\\*\\*)?(${nameAlt})(?:\\*\\*)?\\s*[:：]?\\s*`,
    'gi',
  )
  const hits: { name: string; start: number; bodyAt: number }[] = []
  let m: RegExpExecArray | null
  while ((m = headerRe.exec(text))) {
    hits.push({
      name: String(m[1] || '').trim(),
      start: m.index,
      bodyAt: m.index + m[0].length,
    })
  }
  for (let i = 0; i < hits.length; i++) {
    const cur = hits[i]!
    const sliceEnd = i + 1 < hits.length ? hits[i + 1]!.start : text.length
    const body = text.slice(cur.bodyAt, sliceEnd).trim()
    if (!body) continue
    if (!out[cur.name] || body.length > out[cur.name]!.length) out[cur.name] = body
  }
  return out
}

function pickSection(map: Record<string, string>, names: string[]): string {
  for (const n of names) {
    const v = map[n]
    if (v && v.trim()) return v.trim()
  }
  // 大小写不敏感兜底
  const keys = Object.keys(map)
  for (const n of names) {
    const hit = keys.find((k) => k.toLowerCase() === n.toLowerCase())
    if (hit && map[hit]?.trim()) return map[hit]!.trim()
  }
  return ''
}

function firstUsefulSentence(src: string, max = 320): string {
  const lines = String(src || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/^#+\s*/, '').replace(/\*\*/g, '').trim())
    .filter((l) => {
      if (!l) return false
      if (/^说明方案$/.test(l)) return false
      if (/^(结论|做了什么|验收|改动文件|质量门控)/.test(l)) return false
      return true
    })
  if (!lines.length) return ''
  const one = lines.join(' ').replace(/\s+/g, ' ').trim()
  if (one.length <= max) return one
  return one.slice(0, max - 1) + '…'
}

function bulletize(block: string, fallback: string[]): string[] {
  const raw = String(block || '').trim()
  if (!raw) return fallback.filter(Boolean)
  const lines = raw
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•]+|\d+[.)、］]|（?\d+）)\s*/, '').trim())
    .filter((l) => l && !/^#{1,3}\s/.test(l) && !/^\*\*[^*]+\*\*$/.test(l))
  if (!lines.length) return fallback.filter(Boolean)
  return lines.slice(0, 12)
}

function uniqPaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of paths) {
    const s = String(p || '').trim()
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

/** 重启/测试/看日志：结论按终端操作写，不提沙箱、不提空跑。 */
function formatOpsConclusion(
  job: CursorCodingJob,
  asst: string,
  sections: Record<string, string>,
): string {
  const resultSec =
    pickSection(sections, ['结论', '任务结果', '一句话结论', '结果']) ||
    firstUsefulSentence(asst) ||
    String(job.detail || '').trim() ||
    '开发操作已结束。'
  const didSec = pickSection(sections, ['做了什么', '处理说明', '根因', '原因与处理'])
  const verifySec = pickSection(sections, ['如何验证', '验收', '验收步骤', '验证', '请确认'])
  const didLines = bulletize(didSec, [String(job.detail || '').trim() || '已在项目目录执行，未改代码']).map((b) =>
    b.replace(/\s+/g, ' ').trim(),
  )
  const verifyLines = bulletize(verifySec, [
    '看进度卡里的终端命令是否已经执行',
    '确认前后端仍是原来的端口，页面或接口能打开',
    '若没起来，把终端报错发回本对话',
  ])
    .map((b) => b.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const failed = job.status === 'failed' || job.status === 'cancelled'
  const status = statusHeadline(job.status || '')
  const resultOne = resultSec.replace(/^说明方案\s*/i, '').replace(/\s+/g, ' ').trim()
  const lines = [
    `## 本轮结论`,
    ``,
    `结果：${status}。${resultOne}`,
    ``,
    `改动：`,
    `• 本轮未改代码`,
    ...didLines.filter(Boolean).map((b) => `• ${b}`),
    ``,
    `请你验收：`,
    ...verifyLines.map((b, i) => `${i + 1}. ${b}`),
  ]
  if (failed && job.detail) {
    lines.push(``)
    lines.push(`说明：${String(job.detail).replace(/\s+/g, ' ').trim()}`)
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

function isStartupFailure(job: CursorCodingJob): boolean {
  const detail = String(job.detail || '')
  const asst = String(job.assistant_text || '').trim()
  if (asst.length >= 80) return false
  return /超时（>|已自动重试 \d+ 次，仍未开始写码/.test(detail)
}

/** 终态结论：写入 DSH 聊天壳正文（卡片外），进度卡完成态亦展示同一份。 */
export function formatChatConclusion(job: CursorCodingJob): string {
  const asst = preferredConclusionAssistantText(job.assistant_text || '')
  const sections = splitNamedSections(asst)
  const synced = uniqPaths(job.synced_files || job.last_synced_files || job.review_in_scope || [])
  const deleted = uniqPaths(job.deleted_files || job.review_deleted || [])
  const deferred = uniqPaths(job.review_deferred || job.deferred_files || [])
  const changedRaw = uniqPaths([...(job.changed_files || []), ...synced])
  // sqlite 等本机库不算「有效代码变更」
  const changed = changedRaw.filter((p) => !isLocalDbRel(p))
  const delivered = synced.length > 0 || deleted.length > 0

  // 开发操作本来就不改文件。禁止套用「写码空跑 / 未交付代码」。
  if (job.work_kind === 'ops') {
    return formatOpsConclusion(job, asst, sections)
  }

  // Cursor 没连上：不是空跑，也还没进入审计。结论只报启动失败。
  if (!delivered && job.status === 'failed' && isStartupFailure(job)) {
    const detail = String(job.detail || '').replace(/\s+/g, ' ').trim()
    const lines = [
      `## 本轮结论`,
      ``,
      `结果：❌ 写码没有开始。Cursor 启动未成功，自动重试后仍未连上，所以没有改任何文件。`,
      ``,
      `说明：`,
      `• ${detail || 'Cursor 未能开始写码。'}`,
      ``,
      `请你验收：`,
      `1. 直接再发一次同样的需求即可。`,
    ]
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
  }

  // 本轮合同就是清单、不改文件。零 diff 时把清单交给用户，不套空跑。
  if (
    !delivered &&
    isInventoryOnlyRequirement(job.requirement) &&
    asst.trim().length >= 80 &&
    (job.status === 'succeeded' || job.status === 'failed')
  ) {
    const lines: string[] = []
    lines.push(`## 本轮结论`)
    lines.push(``)
    lines.push(`结果：✅ 清单已给出。本轮按要求没有改文件，目标工程保持原样。`)
    lines.push(``)
    lines.push(asst.trim())
    lines.push(``)
    lines.push(`请你验收：`)
    lines.push(`1. 对照清单确认范围。`)
    lines.push(`2. 确认后直接回复，下一轮才会改文件。`)
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
  }

  // 空跑：无同步/无删除，却常有 Cursor 长文「改动/验收」——禁止当成已交付
  if (!delivered && (job.status === 'succeeded' || job.status === 'failed')) {
    const onlyNoise =
      (job.changed_files || []).length > 0 &&
      (job.changed_files || []).every((p) => isLocalDbRel(p) || !String(p || '').trim())
    const lines: string[] = []
    lines.push(`## 本轮结论`)
    lines.push(``)
    const mark = job.status === 'failed' ? '❌' : '⚠'
    lines.push(
      `结果：${mark} 未向目标工程交付新代码` +
        (job.status === 'failed' ? `（写码空跑已拦截）。` : `。`) +
        (onlyNoise
          ? `沙箱相对开工快照无有效源码 diff（仅有本地库等噪音）。`
          : `沙箱相对开工快照无可同步变更，且无沙箱↔目标漂移可补。`),
    )
    lines.push(``)
    lines.push(`改动：`)
    lines.push(`• 本轮同步文件数：0（请勿把下方 Cursor 排查文案当成已落盘改动）`)
    if (deferred.length) {
      lines.push(`• 另有范围外未处理 ${deferred.length} 个`)
    }
    lines.push(``)
    lines.push(`说明：`)
    lines.push(
      `• 常见原因：目标工程里相关修复已存在（含未提交改动），拷进沙箱后 Cursor 只做了核对、没有再改文件。`,
    )
    lines.push(`• 也可能是只改了被跳过的本地库（如 \`*.db\`），平台故意不同步。`)
    lines.push(`• Cursor 可能仍输出了「改动/验收」长文——那只是沙箱内核对说明，不是本轮落盘清单。`)
    lines.push(``)
    lines.push(`请你验收：`)
    lines.push(`1. 不要按「已改路由/菜单」去验本轮交付——本轮没有同步。`)
    lines.push(`2. 若页面仍异常：直接续改，说明仍看到的 URL/截图；需要改后端时写明接口路径。`)
    lines.push(`3. 若本机工作区其实已有未提交修复：先确认 Vite/后端是否加载的是当前工作区，再验。`)
    lines.push(``)
    lines.push(`如需微调或修 bug，直接说具体问题即可（小改续改，大改会先澄清）。`)
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
  }

  const resultSec =
    pickSection(sections, ['结论', '任务结果', '一句话结论', '结果']) ||
    firstUsefulSentence(asst) ||
    String(job.detail || '').trim() ||
    '写码流程已结束。'

  const didSec =
    pickSection(sections, ['做了什么', '行为约定', '改动说明', '处理说明', '根因', '原因与处理']) ||
    pickSection(sections, ['改动文件', '变更文件'])

  const verifySec = pickSection(sections, ['如何验证', '验收', '验收步骤', '验证', '请确认'])

  const didBullets = bulletize(didSec, [
    deleted.length ? `已删除 ${deleted.length} 个相关文件/入口` : '',
    changed.length ? `已改动并同步相关文件 ${Math.max(changed.length, synced.length)} 处` : '',
    String(job.detail || '').trim(),
  ])

  const verifyBullets = bulletize(verifySec, [
    '打开系统对应页面，确认功能与菜单是否符合预期',
    deleted.length ? '确认已下线入口在菜单中消失，旧地址不再进入该功能' : '刷新前端后点进相关页面走一遍主流程',
    '若有筛选/导出/保存，各试一次关键路径',
    '如需调整，直接在本对话说明具体现象（可附图）',
  ])

  // 图二样式：短标签 + 冒号、段间空一行、改动用 • 列表。
  // 改动文件列表：不写进正文。交给 DSH 底座「已编辑 N 个文件」卡片（workspace/changes）。
  const audit = job.delivery_audit
  const auditFailed = Boolean(audit && audit.ok === false)
  const svc = job.service_check
  const landingMiss = (audit?.checks || []).find(
    (check) => (check.name === 'synced_bytes' || check.name === 'delete_target') && check.ok === false,
  )
  const landed = delivered && !landingMiss && job.status !== 'cancelled'
  const landingText = [
    synced.length ? `已同步 ${synced.length} 个文件` : '',
    deleted.length ? `已删除 ${deleted.length} 个文件` : '',
  ].filter(Boolean).join('，')
  // 结果只认落盘。审计对不上、服务未就绪，都不改这一行。模型「已完成」也不采信。
  const resultOne = (
    landed
      ? `${landingText}。`
      : landingMiss
        ? String(landingMiss.detail || '落盘未完成').trim()
        : resultSec.replace(/^说明方案\s*/i, '').trim() || '写码流程已结束。'
  ).replace(/\s+/g, ' ')
  const didLines = didBullets.map((b) => b.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const modelPoint = resultSec.replace(/^说明方案\s*/i, '').replace(/\s+/g, ' ').trim()
  const changeLines = [...didLines]
  if (
    landed &&
    modelPoint &&
    !/^已完成[。.]?$/.test(modelPoint) &&
    !changeLines.some((line) => line.includes(modelPoint))
  ) {
    changeLines.unshift(modelPoint)
  }
  const verifyLines = verifyBullets.map((b) => b.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const status = job.status === 'cancelled'
    ? statusHeadline('cancelled')
    : landed
      ? '✅ 已完成'
      : statusHeadline(landingMiss ? 'failed' : job.status || '')
  // synced / deleted / changed 仍参与上方 didBullets 兜底与「未同步」告警；路径清单本身由底座卡片展示

  const lines: string[] = []
  lines.push(`## 本轮结论`)
  lines.push(``)
  lines.push(`结果：${status}。${resultOne}`)
  lines.push(``)
  if (audit && delivered) {
    const score = completionOf(audit)
    if (auditFailed) {
      lines.push(auditHeadline(false, true, score))
      for (const c of audit.checks || []) {
        const text = String(c.detail || c.name || '').trim()
        if (!text) continue
        lines.push(`• ${c.ok ? '通过' : '未过'}：${text}`)
      }
    } else if (audit.ok) {
      const scope = auditScopeLines(audit.checks || [], synced)
      lines.push(auditHeadline(true, scope.length > 0, score))
      for (const line of scope) lines.push(line)
    }
    lines.push(``)
  }
  lines.push(`改动：`)
  if (changeLines.length) {
    for (const b of changeLines) lines.push(`• ${b}`)
  } else {
    lines.push(`• 见上方结果说明`)
  }
  if (deferred.length) {
    const crit = criticalDeferredFiles(deferred)
    lines.push(``)
    lines.push(`范围外未同步 ${deferred.length} 个：`)
    for (const f of deferred.slice(0, 15)) lines.push(`• \`${f}\``)
    if (deferred.length > 15) lines.push(`• …另有 ${deferred.length - 15} 个`)
    if (crit.length) {
      lines.push(
        `⚠ 契约文件未同步（${crit.join(', ')}）：易出现「页面已改但接口失败」。请扩大可写范围后续改，或在设置里补上 \`schemas.py\` / \`models.py\`。`,
      )
    }
  }

  const sandboxSkipped = uniqPaths(job.sandbox_skipped_files || [])
  if (sandboxSkipped.length) {
    lines.push(``)
    lines.push(`未进入沙箱 ${sandboxSkipped.length} 个（拷贝超时/失败，Cursor 未读到）：`)
    for (const f of sandboxSkipped.slice(0, 15)) lines.push(`• \`${f}\``)
    if (sandboxSkipped.length > 15) lines.push(`• …另有 ${sandboxSkipped.length - 15} 个`)
  }

  lines.push(``)
  lines.push(`请你验收：`)
  for (let i = 0; i < verifyLines.length; i++) {
    lines.push(`${i + 1}. ${verifyLines[i]}`)
  }

  const beOffer = job.backend_restart
  const beHint = String(job.backend_restart_hint || '').trim()
  if (svc && svc.required && !svc.skipped) {
    lines.push(``)
    lines.push(`服务：`)
    if (svc.frontend) lines.push(`- 前端：${svc.frontend}`)
    if (svc.backend) lines.push(`- 后端：${svc.backend}`)
    if (svc.api) lines.push(`- 接口：${svc.api}`)
    if (svc.ok) lines.push(`可以打开页面看效果。`)
  } else if (beOffer && beOffer.offered) {
    lines.push(``)
    if (beOffer.executed && beOffer.started_at) {
      lines.push(
        `⚠ 后端已自动重启：本轮改了后端（端口 ${beOffer.port}），本机已新开终端执行重启。` +
          `${beOffer.last_detail ? `（${beOffer.last_detail}）` : ''}请稍候再打开页面验收。`,
      )
    } else if (beOffer.started_at && beOffer.executed === false) {
      lines.push(
        `⚠ 后端重启未执行成功（端口 ${beOffer.port}）：${beOffer.last_detail || '请点结论旁按钮重试'}。`,
      )
    } else {
      lines.push(
        `⚠ 后端将自动重启：本轮改了后端（端口 ${beOffer.port}），由本机写码服务执行重启（会新开终端窗），无需手工停起进程。`,
      )
    }
  } else if (beHint) {
    lines.push(``)
    lines.push(`⚠ ${beHint}`)
  }

  if (job.status === 'succeeded' && !synced.length && !deleted.length && deferred.length) {
    lines.push(``)
    lines.push(`⚠ 本轮未同步有效代码：请补充报错 URL/截图后继续，或说明要改的接口/页面路径。`)
  }

  lines.push(``)
  lines.push(`如需微调或修 bug，直接说具体问题即可（小改续改，大改会先澄清）。`)
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}
