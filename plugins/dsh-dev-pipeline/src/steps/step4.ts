/** 第 4 步：规划实现 · validation-first。 */

import { completeJson } from '../llm.js'
import type { Plan, StepContext, StepResult } from '../types.js'
import { detectValidationCommands } from '../workspace.js'
import { fail, getMustFix, pass } from './helpers.js'

interface RawPlan {
  problem?: unknown
  changes?: unknown
  validations?: unknown
  paths?: unknown
}

function asList(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return []
  return v
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .slice(0, max)
}

/** 验证命令只允许单条可执行，拒绝串联、管道、替换与重定向。 */
export function safeCommand(command: string): string {
  const cmd = String(command || '').trim()
  if (!cmd) return ''
  if (cmd.length > 300) return ''
  if (/[;&|`<>\n\r]/.test(cmd)) return ''
  if (cmd.includes('$(')) return ''
  return cmd
}

const ALLOWED_VALIDATION: RegExp[] = [
  /^(?:npm|pnpm|yarn|bun)(?: run)? (?:test|typecheck|lint|build)(?: --if-present)?$/,
  /^mvnw? (?:-q )?test$/,
  /^gradlew? test(?: --console=plain)?$/,
  /^go test (?:\.\/\.\.\.|\.\/[^\s]+)$/,
  /^cargo test(?: --quiet)?$/,
  /^make(?: [A-Za-z0-9_.-]+)?$/,
  /^python3? -m pytest(?: -q)?$/,
  /^pytest(?: -q)?$/,
  /^tsc(?: --noEmit)?$/,
  /^eslint \S+(?: \S+)*$/,
  /^git diff --check$/,
]

/** LLM 生成的验证命令必须命中白名单，避免把模型幻觉变成任意命令执行。 */
export function isAllowedValidationCommand(command: string): boolean {
  const cmd = safeCommand(command)
  if (!cmd) return false
  return ALLOWED_VALIDATION.some((re) => re.test(cmd))
}

function sanitizePath(raw: string): string {
  let p = String(raw || '').trim().replace(/\\/g, '/')
  p = p.replace(/^\.\//, '').replace(/^\/+/, '')
  if (!p || p === '.' || p === '..') return ''
  if (p.split('/').includes('..')) return ''
  return p.slice(0, 240)
}

function mergeCommands(...groups: string[][]): string[] {
  const out: string[] = []
  for (const group of groups) {
    for (const item of group) {
      const cmd = safeCommand(item)
      if (cmd && !out.includes(cmd)) out.push(cmd)
    }
  }
  return out.slice(0, 6)
}

export async function runStep4(sc: StepContext): Promise<StepResult> {
  const prd = sc.epic.prd
  if (!prd) {
    return fail('缺少 PRD，无法规划', '先完成第 2 步', { fatal: true })
  }

  const detected = detectValidationCommands(sc.epic.workspace)
  const configured = sc.cfg.validateCommands

  const pack = sc.epic.context_pack
  const keyContext = (pack?.key_files || [])
    .map((f) => `--- ${f.path} ---\n${f.excerpt.slice(0, 3000)}`)
    .join('\n\n')
  const mustFix = getMustFix(sc.epic)

  const system =
    '你是实现规划师。只输出 JSON，不要解释，不要写代码。' +
    '规划必须落在给定工程目录内，优先复用现有结构，改动越小越好。'
  const prompt = [
    '把 PRD 转成 validation-first 的实现计划。',
    '字段要求：',
    '- problem：这次要解决的核心问题（一句话）',
    '- changes：按顺序列出改动点（1～8 条，说清改哪个文件/模块、怎么改）',
    '- validations：可执行的验证命令（0～5 条，只用工程已具备的工具，一条一个命令）',
    '- paths：预计触碰的相对路径（1～10 条）',
    '只输出 JSON 对象。',
    '',
    '【工程目录】',
    sc.epic.workspace,
    '',
    `【技术栈】${(pack?.stack || []).join(' / ') || '未识别'}`,
    '',
    '【PRD】',
    `what：${prd.what}`,
    `how：${prd.how}`,
    `done：${prd.done.join('；')}`,
    `non_goals：${prd.non_goals.join('；') || '无'}`,
    `change_limit：${prd.change_limit} 个文件`,
    '',
    '【已探测验证命令】',
    detected.join('\n') || '无',
    '',
    '【必须修复（上一轮打回）】',
    mustFix.join('\n') || '无',
    '',
    keyContext ? `【关键文件摘录】\n${keyContext}` : '【关键文件摘录】无',
  ].join('\n')

  let raw: RawPlan = {}
  let degraded = ''
  try {
    raw = await completeJson<RawPlan>(sc.ctx, sc.cfg, {
      system,
      prompt,
      signal: sc.signal,
      maxTokens: 1800,
      temperature: 0.2,
    })
  } catch (err) {
    degraded = `模型规划不可用，已用保守计划：${String(err)}`
    sc.log(degraded)
  }

  let changes = asList(raw.changes, 8)
  if (changes.length === 0) {
    changes = [
      `定位与需求相关的现有模块：${prd.scope.join('、') || prd.what}`,
      `按 PRD 做最小改动：${prd.how}`,
      '补齐或复用现有测试/构建脚本作为验证',
    ]
    if (mustFix.length) changes.unshift(`先修复：${mustFix.join('；')}`)
  }

  const validations = mergeCommands(
    configured,
    detected,
    asList(raw.validations, 5).filter(isAllowedValidationCommand),
  )
  const paths = [...new Set(asList(raw.paths, 10).map(sanitizePath).filter(Boolean))]

  const plan: Plan = {
    rev: (sc.epic.plan?.rev || 0) + 1,
    problem: String(raw.problem || '').trim() || prd.what,
    changes,
    validations,
    paths,
    created_at: new Date().toISOString(),
  }
  sc.epic.plan = plan
  sc.save()

  sc.log(`问题：${plan.problem}`)
  plan.changes.forEach((c, i) => sc.log(`改动[${i + 1}]：${c}`))
  plan.validations.forEach((v, i) => sc.log(`验证[${i + 1}]：${v}`))
  if (plan.paths.length) sc.log(`预计触及：${plan.paths.join('、')}`)
  if (degraded) sc.log(degraded)

  return pass(
    `计划版本 ${plan.rev} 已冻结（${plan.changes.length} 项改动，${plan.validations.length} 条验证）`,
    degraded,
    {
      rev: plan.rev,
      changes: plan.changes.length,
      validations: plan.validations,
      paths: plan.paths,
    },
  )
}
