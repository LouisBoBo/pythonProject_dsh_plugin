/**
 * WorkBuddy 公司共享库旁路召回：仅【管理员】自动并入本机挂载检索。
 * 成员自动召回只走本机挂载；需要公司库时用 mes_company_knowledge。
 *
 * 运行在 Node 插件宿主：无浏览器 localStorage。
 * - 角色：GET /api/auth/me（引擎用本机 active.json，无需 Bearer）
 * - 召回：POST /api/cli cmd=company-knowledge-cite（同样绑定 active，与引擎约定一致）
 * 禁止再调须 Bearer 的 /api/company-knowledge/cite，否则永远空结果。
 */

const DEFAULT_ENGINE_ORIGINS = [
  'http://127.0.0.1:8000',
  'http://127.0.0.1:18000',
]

function engineOrigins(config) {
  const cite = String(config?.workbuddyCompanyCiteUrl || '').trim()
  if (cite) {
    try {
      const u = new URL(cite)
      return [`${u.protocol}//${u.host}`]
    } catch {
      /* fall through */
    }
  }
  if (config?.workbuddyCompanyCite === false) return []
  return DEFAULT_ENGINE_ORIGINS
}

/**
 * 读 WorkBuddy 当前会话角色（本机 active / 可选 Bearer 由引擎处理）。
 * @returns {Promise<'admin'|'user'|''>}
 */
export async function fetchWorkbuddyRole(config, signal) {
  for (const origin of engineOrigins(config)) {
    try {
      const res = await fetch(`${origin}/api/auth/me`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal,
      })
      if (!res.ok) continue
      const data = await res.json().catch(() => null)
      if (!data?.authenticated || !data?.user) continue
      const role = String(data.user.role || '').trim()
      if (role === 'admin' || role === 'user') return role
    } catch {
      /* try next */
    }
  }
  return ''
}

/**
 * 仅管理员返回公司库摘录；非管理员 / 未登录 / 未配置 → 空串。
 * @returns {Promise<string>}
 */
export async function fetchCompanySharedRecall(query, config, signal) {
  const q = String(query || '').trim()
  if (q.length < 2) return ''
  if (config?.workbuddyCompanyCite === false) return ''

  const role = await fetchWorkbuddyRole(config, signal)
  if (role !== 'admin') return ''

  const origins = engineOrigins(config)
  if (origins.length === 0) return ''

  for (const origin of origins) {
    try {
      const res = await fetch(`${origin}/api/cli`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ cmd: 'company-knowledge-cite', args: [q] }),
        signal,
      })
      if (!res.ok) continue
      const data = await res.json().catch(() => null)
      if (!data || data.ok === false) {
        const code = String(data?.code || '')
        if (code === 'not_configured' || code === 'auth_required' || code === 'acl_denied') return ''
        continue
      }
      const count = Number(data.count || 0)
      const reply = String(data.reply || data.detail || '').trim()
      if (!reply) continue
      if (count <= 0 && /未找到|尚未接入|不可用|请先登录/.test(reply)) continue
      return `【公司共享知识库】\n${reply}`
    } catch {
      /* try next engine */
    }
  }
  return ''
}

export function mergeLocalAndCompanyRecall(localText, companyText, maxChars) {
  const parts = []
  const local = String(localText || '').trim()
  const company = String(companyText || '').trim()
  if (local) parts.push(local)
  if (company) parts.push(company)
  if (parts.length === 0) return ''
  let out = parts.join('\n\n')
  const cap = Math.max(500, Number(maxChars) || 5000)
  if (out.length > cap) out = `${out.slice(0, cap - 1)}…`
  return out
}
