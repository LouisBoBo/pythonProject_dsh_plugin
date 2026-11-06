/**
 * 聊天正文「本轮结论」：只认 Job 账本字段，不扫用户可见对话原文。
 * 固定友好三段：任务结果 → 做了什么 → 如何验证（格式硬约束）。
 */
import { criticalDeferredFiles } from './scopeCompanions.js'
import { preferredConclusionAssistantText } from './transcript.js'
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

/** 终态结论：写入 DSH 聊天壳正文（卡片外），进度卡完成态亦展示同一份。 */
export function formatChatConclusion(job: CursorCodingJob): string {
  const asst = preferredConclusionAssistantText(job.assistant_text || '')
  const sections = splitNamedSections(asst)
  const synced = uniqPaths(job.synced_files || job.last_synced_files || job.review_in_scope || [])
  const deleted = uniqPaths(job.deleted_files || job.review_deleted || [])
  const deferred = uniqPaths(job.review_deferred || job.deferred_files || [])
  const changed = uniqPaths([...(job.changed_files || []), ...synced])

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
  const resultOne = (resultSec.replace(/^说明方案\s*/i, '').trim() || '写码流程已结束。').replace(/\s+/g, ' ')
  const didLines = didBullets.map((b) => b.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const verifyLines = verifyBullets.map((b) => b.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const status = statusHeadline(job.status || '')
  // synced / deleted / changed 仍参与上方 didBullets 兜底与「未同步」告警；路径清单本身由底座卡片展示

  const lines: string[] = []
  lines.push(`## 本轮结论`)
  lines.push(``)
  lines.push(`结果：${status}。${resultOne}`)
  lines.push(``)
  lines.push(`改动：`)
  if (didLines.length) {
    for (const b of didLines) lines.push(`• ${b}`)
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
  lines.push(`验收：`)
  for (let i = 0; i < verifyLines.length; i++) {
    lines.push(`${i + 1}. ${verifyLines[i]}`)
  }

  if (job.status === 'succeeded' && !synced.length && !deleted.length && deferred.length) {
    lines.push(``)
    lines.push(`⚠ 本轮未同步有效代码：请补充报错 URL/截图后继续，或说明要改的接口/页面路径。`)
  }

  lines.push(``)
  lines.push(`如需微调或修 bug，直接说具体问题即可（小改续改，大改会先澄清）。`)
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}
