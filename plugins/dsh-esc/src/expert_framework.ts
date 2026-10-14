/**
 * 自建专家人设框架 + 按框架 AI 扩写。
 * LLM 只读 WorkBuddy 系统配置 deepseek.*；未配置时返回明确错误。
 */
import { USER_EXPERT_BODY_MAX } from './types.js'
import { readWorkbuddyLlm } from './workbuddy_mes.js'

export const EXPERT_BODY_FRAMEWORK = `你是【身份：岗位 + 几年经验 / 熟悉什么】。读者是【主管 / 工艺 / 质量 / …】。语气【专业、短句、表格优先】。不写代码、不部署、不闲聊。

职责边界：
1. 做什么：【本专家负责的分析 / 评审 / 辅导范围】
2. 不做什么：【明确排除项；查数步骤放技能手册，这里不写 kind、不写几节几张图】
3. 证据与禁编造：只解读当前技能 SOP 允许且工具已返回的数字；失败写 error.code，禁止编造。
4. 与其它能力并存：【例如未召唤本专家时不抢 mes_pcb】

## 排版

- 能成表的一律表格；不能成表用短段落，每段一个判断。
- 禁止大段连续叙述。
`

export type ExpertBriefInput = {
  title?: string
  role?: string
  tags?: string[]
  body?: string
}

/** 有名称 + 人设正文里能看出身份，才允许推荐技能。 */
export function expertIdentityReady(input: ExpertBriefInput): { ok: boolean; detail: string } {
  const title = String(input.title || '')
    .replace(/\s+/g, ' ')
    .trim()
  const body = String(input.body || '').trim()
  if (title.length < 2) return { ok: false, detail: '请先填写专家名称' }
  if (body.length < 40) return { ok: false, detail: '请先写满人设框架（至少身份与边界），再推荐技能' }
  const hasIdentity =
    /你是|身份|岗位|负责|擅长|读者|语气|职责|不做什么|不做/.test(body) ||
    (String(input.role || '').trim().length >= 2 && body.length >= 80)
  if (!hasIdentity) return { ok: false, detail: '人设里还看不出身份（建议用「填入框架」后补全【】占位）' }
  const placeholders = (body.match(/【[^】]*】/g) || []).length
  // 仍留着框架占位 = 身份未写实，禁止据此推荐技能
  if (placeholders >= 2) {
    return { ok: false, detail: '请先把框架里的【】占位改成具体内容，再推荐技能' }
  }
  return { ok: true, detail: '' }
}

function chatCompletionsUrl(base: string): string {
  const raw = String(base || '').trim()
  if (!raw) return ''
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return ''
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
  if (u.username || u.password) return ''
  let path = u.pathname.replace(/\/+$/, '')
  if (path.endsWith('/chat/completions')) return `${u.origin}${path}`
  if (/^api\.deepseek\.com$/i.test(u.hostname) && !/\/v\d+$/i.test(path)) {
    path = path && path !== '/' ? `${path}/v1` : '/v1'
  }
  const prefix = !path || path === '/' ? '' : path
  return `${u.origin}${prefix}/chat/completions`
}

function readLlm(): { base: string; key: string; model: string } {
  const sec = readWorkbuddyLlm()
  return {
    base: sec.baseUrl,
    key: sec.apiKey,
    model: sec.model || 'deepseek-chat',
  }
}

export function llmConfiguredForEsc(): boolean {
  const c = readLlm()
  return Boolean(c.base && c.key)
}

/** 按固定框架扩写人设；禁止发明技能 id / 连接器步骤。 */
export async function expandExpertBody(input: ExpertBriefInput): Promise<{ body: string }> {
  const title = String(input.title || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (title.length < 2) throw Object.assign(new Error('请先填写专家名称，再 AI 扩写'), { code: 'empty_title' })
  const role = String(input.role || '').trim()
  const tags = (input.tags || []).map((t) => String(t).trim()).filter(Boolean)
  const draft = String(input.body || '').trim() || EXPERT_BODY_FRAMEWORK
  const cred = readLlm()
  if (!cred.base || !cred.key) {
    throw Object.assign(
      new Error('未配置对话模型。请到 WorkBuddy「系统配置」填写 DeepSeek / 对话模型后再扩写。'),
      { code: 'llm_unconfigured' },
    )
  }
  const url = chatCompletionsUrl(cred.base)
  if (!url) throw Object.assign(new Error('对话模型 Base URL 不合法'), { code: 'llm_unconfigured' })

  const system = [
    '你是专家人设编辑器。只输出完整人设正文（Markdown 纯文本），不要解释、不要代码块围栏。',
    '必须保留并填满下列结构：开篇「你是…读者是…语气…」→「职责边界」编号列表 →「## 排版」。',
    '只写身份、读者、语气、做什么/不做什么、证据与禁编造、排版。',
    '禁止写具体查数 kind、禁止写几节几张图、禁止点名技能 id、禁止写工具调用步骤、禁止 Glob/Bash/写码。',
    `全文不超过 ${USER_EXPERT_BODY_MAX} 字。`,
  ].join('')

  const user = [
    `专家名称：${title}`,
    role ? `岗位：${role}` : '',
    tags.length ? `标签：${tags.join('、')}` : '',
    '',
    '请在下列草稿 / 框架上扩写（保留结构，把【】占位换成具体内容）：',
    draft,
  ]
    .filter(Boolean)
    .join('\n')

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 45000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cred.key}`,
      },
      body: JSON.stringify({
        model: cred.model,
        temperature: 0.3,
        max_tokens: 1800,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    })
    const text = await res.text()
    let data: { choices?: { message?: { content?: string | null } }[] }
    try {
      data = JSON.parse(text) as typeof data
    } catch {
      throw Object.assign(new Error('AI 返回异常，请稍后重试'), { code: 'llm_failed' })
    }
    if (!res.ok) {
      throw Object.assign(new Error('AI 暂时不可用，请稍后重试或手工填写'), { code: 'llm_failed' })
    }
    let body = String(data.choices?.[0]?.message?.content || '').trim()
    body = body.replace(/^```(?:markdown|md)?\s*/i, '').replace(/\s*```$/i, '').trim()
    if (!body) throw Object.assign(new Error('AI 未返回人设正文'), { code: 'llm_failed' })
    if (!/你是|职责|排版/.test(body)) {
      throw Object.assign(new Error('扩写结果未按框架输出，请重试或手工改'), { code: 'llm_bad_shape' })
    }
    if (body.length > USER_EXPERT_BODY_MAX) body = body.slice(0, USER_EXPERT_BODY_MAX).trim()
    return { body }
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e) throw e
    const aborted = e instanceof Error && e.name === 'AbortError'
    throw Object.assign(new Error(aborted ? 'AI 扩写超时，请重试' : 'AI 暂时不可用，请稍后重试或手工填写'), {
      code: aborted ? 'llm_timeout' : 'llm_failed',
    })
  } finally {
    clearTimeout(timer)
  }
}
