/**
 * 自定义自动化指令：对照 simplified-workbuddy/apps/automations/prompt_rewrite.py
 * 用户草稿（或任务名称）按骨架扩写，不曲解意图。
 */
import { chatComplete } from './llm.js'
import { PROMPT_SKELETON } from './templates.js'

const REWRITE_SYSTEM =
  '你是自动化任务「执行指令」改写助手。用户给出草稿意图后，按骨架扩写成更清晰、更易被执行器理解的中文指令。\n' +
  '硬性要求：\n' +
  '1. 不曲解、不增减业务目标；用户没提的指标/步骤不要擅自添加为必须做。\n' +
  '2. 可补充结构与可执行表述，使执行器更容易一次完成。\n' +
  '3. 必须保留【目标】【数据来源】【输出格式】区块；【查数或检索步骤】【禁止】按需。\n' +
  '4. 不要写调度时间、工作目录、企微/飞书/语雀配置（界面另配）。\n' +
  '5. 禁止引导写码、Git 提交、部署。\n' +
  '6. 只输出改写后的指令正文，不要前言、后记或 Markdown 代码围栏。'

export function isPromptSkeleton(text: string): boolean {
  const t = String(text || '').trim()
  if (!t) return false
  if (t === PROMPT_SKELETON.trim()) return true
  if (/（一句话：要产出什么）/.test(t)) return true
  if (/【数据来源】MES 查数 \/ 联网检索/.test(t) && /1\.\s*…/.test(t)) return true
  return false
}

/** 对照 simplified：草稿优先；空草稿或未改骨架时可用任务名称当意图。 */
export function resolveRewriteDraft(draft: string, taskName = ''): string {
  const raw = String(draft || '').trim()
  const name = String(taskName || '').trim().slice(0, 120)
  if (raw && !isPromptSkeleton(raw)) return raw.slice(0, 8000)
  return name
}

function stripFences(text: string): string {
  let raw = String(text || '').trim()
  if (raw.startsWith('```')) {
    raw = raw.replace(/^```(?:\w+)?\s*/, '').replace(/\s*```$/, '')
  }
  return raw.trim()
}

export async function rewriteAutomationPrompt(draft: string, taskName = ''): Promise<string> {
  const text = resolveRewriteDraft(draft, taskName)
  if (!text) throw new Error('请先写几句任务意图，或填写任务名称，再使用 AI 改写')
  const name = String(taskName || '').trim().slice(0, 120)
  const user = [
    name ? `【任务名称】${name}` : '',
    '【指令骨架参考】',
    PROMPT_SKELETON,
    '',
    '【用户草稿】',
    text,
    '',
    '请输出改写后的完整执行指令：',
  ].join('\n')
  let out = ''
  try {
    out = await chatComplete(
      [
        { role: 'system', content: REWRITE_SYSTEM },
        { role: 'user', content: user },
      ],
      { timeoutMs: 45_000, maxTokens: 2048 },
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('未配置') || msg.includes('未返回')) throw new Error(msg)
    throw new Error('AI 改写暂时不可用，请稍后重试或手工完善指令')
  }
  out = stripFences(out)
  if (!out) throw new Error('AI 未返回有效指令，请重试或手工完善')
  return out.slice(0, 8000)
}
