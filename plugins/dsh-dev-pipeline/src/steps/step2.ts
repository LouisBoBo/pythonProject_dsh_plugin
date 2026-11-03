/** 第 2 步：需求理解 · PRD-lite。 */

import { completeJson } from '../llm.js'
import type { Prd, StepContext, StepResult } from '../types.js'
import { cleanRequirement, fail, oneLiner, pass } from './helpers.js'

interface RawPrd {
  what?: unknown
  how?: unknown
  done?: unknown
  non_goals?: unknown
  scope?: unknown
  scenario?: unknown
  delivery?: unknown
  change_limit?: unknown
}

function asList(v: unknown, max = 10): string[] {
  if (!Array.isArray(v)) return []
  return v
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .slice(0, max)
}

function deterministicPrd(text: string): RawPrd {
  return {
    what: oneLiner(text) || '按用户需求完成实现',
    how: '在现有工程结构内做最小改动，复用已有组件与接口，不新增无关依赖。',
    done: ['需求描述的功能可用', '工程现有测试/构建通过'],
    non_goals: ['不重构无关模块', '不引入与需求无关的依赖'],
    scope: [],
    scenario: 'custom',
    delivery: 'incremental',
    change_limit: 20,
  }
}

export async function runStep2(sc: StepContext): Promise<StepResult> {
  const text = cleanRequirement(sc.epic.raw_intake?.text || sc.run.message || '')
  if (!text) {
    return fail('没有可提炼的需求文字', '第 1 步未产出有效文本', { fatal: true })
  }

  const system =
    '你是需求分析师。只输出 JSON，不要解释。' +
    '严格依据用户原话，不要套用任何行业模板，不要发明用户未点名的菜单或页面。'
  const prompt = [
    '把下面的需求整理成 PRD-lite。',
    '字段要求：',
    '- what：要做什么（一句话）',
    '- how：怎么干（技术路径，结合工程，不写代码）',
    '- done：干成啥（可验收标准，1～5 条）',
    '- non_goals：非目标（1～5 条）',
    '- scope：范围内（1～6 条，可为空数组）',
    '- scenario：场景（frontend/backend/fullstack/data/infra/custom）',
    '- delivery：交付方式（incremental/new_module/refactor）',
    '- change_limit：预计最多改多少个文件（整数，默认 12）',
    '只输出 JSON 对象。',
    '',
    '【工程目录】',
    sc.epic.workspace,
    '',
    '【附图数量】',
    String(sc.epic.raw_intake?.images?.length || 0),
    '',
    '【用户原话】',
    text,
  ].join('\n')

  let raw: RawPrd
  let degraded = ''
  try {
    raw = await completeJson<RawPrd>(sc.ctx, sc.cfg, {
      system,
      prompt,
      signal: sc.signal,
      maxTokens: 1600,
      temperature: 0.2,
    })
  } catch (err) {
    raw = deterministicPrd(text)
    degraded = `模型 PRD 不可用，已用保守 PRD：${String(err)}`
    sc.log(degraded)
  }

  const done = asList(raw.done, 6)
  if (done.length === 0) done.push('需求描述的功能可用')
  const what = String(raw.what || '').trim() || oneLiner(text) || '按用户需求完成实现'
  const how = String(raw.how || '').trim() || '在现有工程结构内做最小改动。'
  const changeLimitRaw = Number(raw.change_limit)
  const changeLimit =
    Number.isFinite(changeLimitRaw) && changeLimitRaw > 0
      ? Math.min(100, Math.floor(changeLimitRaw))
      : 12

  const prd: Prd = {
    rev: (sc.epic.prd?.rev || 0) + 1,
    what,
    how,
    done,
    non_goals: asList(raw.non_goals, 6),
    scope: asList(raw.scope, 8),
    scenario: String(raw.scenario || 'custom').trim() || 'custom',
    delivery: String(raw.delivery || 'incremental').trim() || 'incremental',
    change_limit: changeLimit,
    created_at: new Date().toISOString(),
  }
  sc.epic.prd = prd
  sc.save()

  sc.log(`要做什么：${prd.what}`)
  sc.log(`怎么干：${prd.how}`)
  prd.done.forEach((d, i) => sc.log(`干成啥[${i + 1}]：${d}`))
  if (degraded) sc.log(degraded)

  return pass(
    `PRD 版本 ${prd.rev} 已冻结`,
    degraded,
    { rev: prd.rev, scenario: prd.scenario, change_limit: prd.change_limit },
  )
}
