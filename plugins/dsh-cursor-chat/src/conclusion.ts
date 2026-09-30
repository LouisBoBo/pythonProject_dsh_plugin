/**
 * 聊天正文「本轮结论」：只认 Job 账本字段，不扫用户可见对话原文。
 */
import { criticalDeferredFiles } from './scopeCompanions.js'
import { preferredConclusionAssistantText } from './transcript.js'
import type { CursorCodingJob } from './types.js'

/** 终态结论：写入 DSH 聊天壳正文（卡片外），进度卡完成态亦展示同一份。 */
export function formatChatConclusion(job: CursorCodingJob): string {
  const asst = preferredConclusionAssistantText(job.assistant_text || '')
  const synced = job.synced_files || job.last_synced_files || job.review_in_scope || []
  const deferred = job.review_deferred || job.deferred_files || []
  const lines: string[] = [`## 本轮结论`, ``]
  if (asst) {
    lines.push(asst, ``)
  } else {
    lines.push(job.detail || '写码流程已结束。', ``)
  }
  lines.push(`---`, ``)
  lines.push(`**状态：** ${job.status}`)
  if (job.status === 'succeeded') {
    lines.push(`**同步：** 已自动同步 ${synced.length} 个文件到本机，并尝试刷新前端。`)
    if (synced.length) {
      lines.push(``)
      for (const f of synced.slice(0, 30)) lines.push(`- ${f}`)
      if (synced.length > 30) lines.push(`- …另有 ${synced.length - 30} 个`)
    }
  } else if (job.status === 'pending_review') {
    lines.push(`**同步：** 待审（自动同步未开启或范围内无文件）。`)
  } else {
    lines.push(`**说明：** ${job.detail || job.status}`)
  }
  if (deferred.length) {
    const crit = criticalDeferredFiles(deferred)
    lines.push(``, `**范围外未同步 ${deferred.length} 个**：`)
    for (const f of deferred.slice(0, 15)) lines.push(`- ${f}`)
    if (deferred.length > 15) lines.push(`- …另有 ${deferred.length - 15} 个`)
    if (crit.length) {
      lines.push(
        ``,
        `⚠ **契约文件未同步**（${crit.join(', ')}）：易导致「页面已改但接口请求失败」。请扩大可写范围后走续改，或设置里补上 \`schemas.py\` / \`models.py\`。`,
      )
    } else {
      lines.push(`（可扩大写范围后重试）`)
    }
  }
  lines.push(``)
  lines.push(`请自行打开页面确认编码效果。`)
  lines.push(``)
  lines.push(
    `如需调整或修 bug，请直接在本对话说明具体问题（例如：写入成功但提示请求失败）。小改直接续改确认卡；大改先选择题澄清。`,
  )
  return lines.join('\n')
}
