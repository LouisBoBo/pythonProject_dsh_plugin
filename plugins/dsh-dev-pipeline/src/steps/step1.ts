/** 第 1 步：多模态需求采集（只记账，不改代码）。 */

import type { StepContext, StepResult } from '../types.js'
import { cleanRequirement, fail, oneLiner, pass } from './helpers.js'

export async function runStep1(sc: StepContext): Promise<StepResult> {
  const raw = String(sc.run.message || '').trim()
  const text = cleanRequirement(raw)
  const images = Array.isArray(sc.epic.raw_intake.images) ? sc.epic.raw_intake.images : []

  if (!text && images.length === 0) {
    return fail('需求为空：至少提供一段需求文字或一张图', '原始 input 为空', { fatal: true })
  }

  sc.epic.raw_intake = {
    text,
    chars: text.length,
    images,
    one_liner: oneLiner(text) || (images.length ? `看图实现（${images.length} 张图）` : ''),
    source: text && images.length ? 'mixed' : images.length ? 'image' : 'text',
  }
  sc.save()

  sc.log(`需求字数：${text.length}`)
  if (images.length) {
    sc.log(`附图 ${images.length} 张：第 5 步写码时会一并转交（仅支持本机文件或 base64）`)
  }
  sc.log(`需求摘要：${sc.epic.raw_intake.one_liner || '（无文字）'}`)

  return pass(
    `需求已写入账本（${text.length} 字${images.length ? `，${images.length} 张图` : ''}）`,
    '',
    { chars: text.length, images: images.length },
  )
}
