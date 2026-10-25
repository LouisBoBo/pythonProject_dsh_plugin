export type Snap = {
  used: number
  limitTokens: number | null
  blocked: boolean
  period: string
}

export type DecideCode = '' | 'quota_exceeded' | 'quota_unreachable' | 'key_blocked'

export type DecideResult = {
  allow: boolean
  code: DecideCode
  used: number
  limitTokens: number | null
}

function samePeriod(snap: Snap | null, period: string): Snap | null {
  if (!snap || snap.period !== period) return null
  return snap
}

/** 限额判断只认这些字段，不读对话正文。 */
export function decide(input: {
  quotaBaseUrl: string
  period: string
  snap: Snap | null
  lastServer: Snap | null
  pendingTotal: number
}): DecideResult {
  if (!input.quotaBaseUrl.trim()) {
    return { allow: true, code: '', used: 0, limitTokens: null }
  }
  const base = samePeriod(input.snap, input.period) ?? samePeriod(input.lastServer, input.period)
  if (!base) {
    return { allow: false, code: 'quota_unreachable', used: 0, limitTokens: null }
  }
  const pending = Number.isFinite(input.pendingTotal) ? Math.max(0, Math.floor(input.pendingTotal)) : 0
  const used = base.used + pending
  if (base.blocked) {
    return { allow: false, code: 'key_blocked', used, limitTokens: base.limitTokens }
  }
  if (base.limitTokens == null) {
    return { allow: true, code: '', used, limitTokens: null }
  }
  if (used >= base.limitTokens) {
    return { allow: false, code: 'quota_exceeded', used, limitTokens: base.limitTokens }
  }
  return { allow: true, code: '', used, limitTokens: base.limitTokens }
}

export function denyMessage(code: DecideCode, used: number, limitTokens: number | null): string {
  if (code === 'quota_exceeded') {
    return `本月 token 已用完：已用 ${used}，上限 ${limitTokens ?? 0}。请联系管理员提高上限。`
  }
  if (code === 'key_blocked') return '这把 Key 已停用。请联系管理员。'
  if (code === 'quota_unreachable') return '额度服务不可达，已暂停模型调用。请确认管理员电脑上的限额服务已开启。'
  return '本次调用被限额策略拒绝。'
}
