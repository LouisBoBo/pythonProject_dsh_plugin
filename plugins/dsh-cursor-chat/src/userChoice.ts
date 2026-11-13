/**
 * 写码/运维过程中需要用户拍板时：Cursor 调 ask_user_choice → 进度卡弹选项 → 答完再继续。
 * 只认本模块登记的 pending；取消任务必须 reject，避免工具回调永久挂起。
 */

export type UserChoiceOption = { id: string; label: string }

export type PendingUserChoice = {
  job_id: string
  call_id: string
  question: string
  options: UserChoiceOption[]
  created_at: string
}

type Waiter = {
  pending: PendingUserChoice
  resolve: (answer: string) => void
  reject: (err: Error) => void
  timer?: ReturnType<typeof setTimeout>
}

const waiters = new Map<string, Waiter>()

const DEFAULT_TTL_MS = 15 * 60_000

function normalizeOptions(raw: unknown): UserChoiceOption[] {
  if (!Array.isArray(raw)) return []
  const out: UserChoiceOption[] = []
  for (let i = 0; i < raw.length && out.length < 6; i += 1) {
    const item = raw[i]
    if (typeof item === 'string') {
      const label = item.replace(/\s+/g, ' ').trim()
      if (!label) continue
      out.push({ id: String(i + 1), label: label.slice(0, 200) })
      continue
    }
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const label = String(o.label || o.text || o.value || o.id || '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!label) continue
    const id = String(o.id || i + 1).trim() || String(i + 1)
    out.push({ id: id.slice(0, 64), label: label.slice(0, 200) })
  }
  return out
}

export function getPendingUserChoice(jobId: string): PendingUserChoice | null {
  const w = waiters.get(String(jobId || '').trim())
  return w ? w.pending : null
}

/**
 * 阻塞直到用户选择、超时或任务取消。
 * 同一 job 重复询问会先结束上一次（返回「已被新的提问替换」）。
 */
export function waitForUserChoice(opts: {
  jobId: string
  callId?: string
  question: string
  options: unknown
  ttlMs?: number
}): Promise<{ ok: true; answer: string; pending: PendingUserChoice } | { ok: false; detail: string }> {
  const jobId = String(opts.jobId || '').trim()
  const question = String(opts.question || '').replace(/\s+/g, ' ').trim()
  const options = normalizeOptions(opts.options)
  if (!jobId) return Promise.resolve({ ok: false, detail: '缺少 jobId' })
  if (!question) return Promise.resolve({ ok: false, detail: '缺少问题' })
  if (options.length < 2) return Promise.resolve({ ok: false, detail: '至少需要 2 个选项' })

  const prev = waiters.get(jobId)
  if (prev) {
    clearTimeout(prev.timer)
    prev.resolve('（提问已被新的选择题替换，请按最新问题回答）')
    waiters.delete(jobId)
  }

  const pending: PendingUserChoice = {
    job_id: jobId,
    call_id: String(opts.callId || '').trim() || `ask-${Date.now().toString(36)}`,
    question: question.slice(0, 400),
    options,
    created_at: new Date().toISOString(),
  }

  const ttl = Math.max(60_000, Math.min(30 * 60_000, opts.ttlMs ?? DEFAULT_TTL_MS))

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const cur = waiters.get(jobId)
      if (!cur || cur.pending.call_id !== pending.call_id) return
      waiters.delete(jobId)
      resolve({
        ok: false,
        detail: `用户未在 ${Math.round(ttl / 60000)} 分钟内选择。请按推荐方案继续，或在结论里写清待确认项后收口。`,
      })
    }, ttl)

    waiters.set(jobId, {
      pending,
      timer,
      resolve: (answer: string) => {
        clearTimeout(timer)
        waiters.delete(jobId)
        resolve({ ok: true, answer, pending })
      },
      reject: (err: Error) => {
        clearTimeout(timer)
        waiters.delete(jobId)
        resolve({ ok: false, detail: err.message || '已取消' })
      },
    })
  })
}

/** 用户点选后调用。只认 option.id 或完整 label，禁止模糊/自由文本。 */
export function answerUserChoice(
  jobId: string,
  choice: string,
): { ok: true; answer: string } | { ok: false; detail: string } {
  const id = String(jobId || '').trim()
  const raw = String(choice || '').replace(/\s+/g, ' ').trim()
  if (!id) return { ok: false, detail: '缺少 jobId' }
  if (!raw) return { ok: false, detail: '请选择或填写一项' }
  const w = waiters.get(id)
  if (!w) return { ok: false, detail: '当前没有待确认的问题' }

  // 只认 option.id 或完整 label；禁止 includes 模糊匹配（短串会误选）
  const hit = w.pending.options.find((o) => o.id === raw || o.label === raw)
  if (!hit) {
    return {
      ok: false,
      detail: '请点选给出的选项（须与选项全文一致）',
    }
  }
  w.resolve(hit.label)
  return { ok: true, answer: hit.label }
}

export function cancelUserChoice(jobId: string, reason = '用户取消'): void {
  const id = String(jobId || '').trim()
  if (!id) return
  const w = waiters.get(id)
  if (!w) return
  w.reject(new Error(reason))
}
