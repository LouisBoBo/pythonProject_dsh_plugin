import { randomBytes } from 'node:crypto'
import { classifyCall, countsTowardQuota } from './classify.js'
import { decide, denyMessage, type Snap } from './decide.js'
import { keyIdOf, tailOf } from './key-id.js'
import { pickUsage } from './usage.js'

export type GateArgs = {
  quotaBaseUrl: string
  apiKey: string
  period: string
  pendingTotal: number
  snap: Snap | null
  lastServer: Snap | null
  report: (row: Record<string, unknown>) => Promise<void>
}

export function quotaFinishChunk(code: string, message: string) {
  return {
    type: 'finish' as const,
    reason: {
      kind: 'error' as const,
      failure: { code, message },
    },
  }
}

function callId(): string {
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)
  return `kq_${stamp}_${randomBytes(3).toString('hex')}`
}

/**
 * 未配置额度地址、非 DeepSeek、没有 Key：原样透传，不计数。
 * 超额、停用、服务不可达：不调用 next()。
 * 上报失败不改变已经开始的成功流。
 */
export async function* gateStream<T>(
  options: unknown,
  next: () => AsyncIterable<T>,
  args: GateArgs,
): AsyncGenerator<T | ReturnType<typeof quotaFinishChunk>, void, undefined> {
  if (!args.quotaBaseUrl.trim() || !countsTowardQuota(options) || !args.apiKey.trim()) {
    yield* next()
    return
  }

  const decision = decide({
    quotaBaseUrl: args.quotaBaseUrl,
    period: args.period,
    snap: args.snap,
    lastServer: args.lastServer,
    pendingTotal: args.pendingTotal,
  })
  if (!decision.allow) {
    yield quotaFinishChunk(decision.code, denyMessage(decision.code, decision.used, decision.limitTokens))
    return
  }

  const meta = classifyCall(options)
  let usage = pickUsage(null)
  try {
    for await (const chunk of next()) {
      const parsed = pickUsage(chunk)
      if (parsed) usage = parsed
      yield chunk
    }
  } catch (err) {
    await safeReport(args, meta, args.apiKey, args.period, usage)
    throw err
  }
  await safeReport(args, meta, args.apiKey, args.period, usage)
}

async function safeReport(
  args: GateArgs,
  meta: ReturnType<typeof classifyCall>,
  apiKey: string,
  period: string,
  usage: ReturnType<typeof pickUsage>,
): Promise<void> {
  try {
    await args.report({
      callId: callId(),
      keyId: keyIdOf(apiKey),
      tail: tailOf(apiKey),
      period,
      source: meta.source,
      model: meta.model,
      quality: usage ? 'provider' : 'missing',
      prompt_tokens: usage?.input ?? 0,
      completion_tokens: usage?.output ?? 0,
      cache_read_tokens: usage?.cacheRead ?? 0,
      cache_write_tokens: usage?.cacheWrite ?? 0,
      reasoning_tokens: usage?.reasoning ?? 0,
      total_tokens: usage?.total ?? 0,
    })
  } catch {
    // 模型结果已经交给上层，记账失败不得改写对话
  }
}
