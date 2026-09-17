import { chatComplete } from './llm.js'

const REWRITE_SYSTEM =
  '你是自动化任务「执行指令」改写助手。用户给出草稿意图后，按骨架扩写成更清晰、更易被执行器理解的中文指令。\n' +
  '硬性要求：\n' +
  '1. 不曲解、不增减业务目标；用户没提的指标/步骤不要擅自添加为必须做。\n' +
  '2. 必须保留【目标】【数据来源】【输出格式】区块；步骤/禁止按需。\n' +
  '3. 不要写调度时间、工作目录、企微配置（界面另配）。\n' +
  '4. 禁止引导写码、Git 提交、部署。\n' +
  '5. 只输出改写后的指令正文，不要前言、后记或 Markdown 代码围栏。'

export async function rewriteAutomationPrompt(draft: string, taskName = ''): Promise<string> {
  const text = String(draft || '').trim()
  if (!text) throw new Error('请先填写执行指令草稿')
  const user = taskName.trim() ? `任务名称：${taskName.trim()}\n草稿：\n${text}` : text
  const out = await chatComplete(
    [
      { role: 'system', content: REWRITE_SYSTEM },
      { role: 'user', content: user },
    ],
    { timeoutMs: 45_000 },
  )
  return out.replace(/^```(?:\w+)?\s*/, '').replace(/\s*```$/, '').trim()
}
