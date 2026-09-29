import { classifyCall, type CallMeta } from './classify.js'
import { buildEvent, clipError, type MeterEvent } from './event.js'
import type { MeterSink } from './store.js'
import { pickUsage, type TokenBreakdown } from './usage.js'

export type MeterLogger = {
  warn?: (msg: string) => void
}

export type WrapMeterArgs = {
  store: MeterSink
  started?: number
  classify?: (options: unknown) => CallMeta
  isAgentLoop?: (options: object) => boolean
  logger?: MeterLogger
  now?: () => Date
}

function finishKindOf(chunk: Record<string, unknown>): string {
  if (chunk.type === 'finish') {
    const reason = chunk.reason && typeof chunk.reason === 'object'
      ? chunk.reason as Record<string, unknown>
      : undefined
    const nested = chunk.finish && typeof chunk.finish === 'object'
      ? chunk.finish as Record<string, unknown>
      : undefined
    const kind = reason?.kind ?? nested?.kind
    return typeof kind === 'string' && kind ? kind : 'finish'
  }
  if (chunk.type === 'error' || chunk.type === 'aborted') return String(chunk.type)
  return ''
}

function errorOf(chunk: Record<string, unknown>, kind: string): string {
  if (kind !== 'error' && kind !== 'aborted') return ''
  const reason = chunk.reason && typeof chunk.reason === 'object'
    ? chunk.reason as Record<string, unknown>
    : undefined
  const failure = (reason?.failure ?? chunk.failure) && typeof (reason?.failure ?? chunk.failure) === 'object'
    ? (reason?.failure ?? chunk.failure) as Record<string, unknown>
    : undefined
  return clipError(failure?.message ?? chunk.message ?? '')
}

function okOf(finishKind: string, errMsg: string): boolean {
  return !errMsg && finishKind !== 'error' && finishKind !== 'aborted' && finishKind !== 'throw'
}

function safeWarn(logger: MeterLogger | undefined, msg: string): void {
  try {
    logger?.warn?.(msg)
  } catch {
    // ignore
  }
}

function inspectChunk(chunk: unknown): { usage: TokenBreakdown | null, finishKind: string, errMsg: string } {
  if (!chunk || typeof chunk !== 'object') {
    return { usage: null, finishKind: '', errMsg: '' }
  }
  const rec = chunk as Record<string, unknown>
  return {
    usage: pickUsage(rec),
    finishKind: finishKindOf(rec),
    errMsg: errorOf(rec, finishKindOf(rec)),
  }
}

/**
 * 包装 next()：原样透传每一个 chunk；记账失败只 warn，不打断业务异常语义。
 * 同一 stream 只落盘一行（正常结束或 throw）。
 */
export async function* wrapMeteredStream<T>(
  options: unknown,
  next: () => AsyncIterable<T>,
  args: WrapMeterArgs,
): AsyncGenerator<T, void, undefined> {
  const started = args.started ?? Date.now()
  const meta = (args.classify ?? ((o: unknown) => classifyCall(o, { isAgentLoop: args.isAgentLoop })))(options)
  let usage: TokenBreakdown | null = null
  let finishKind = ''
  let errMsg = ''
  let settled = false

  const settle = (kind: string, message: string, thrown: boolean) => {
    if (settled) return
    settled = true
    const event: MeterEvent = buildEvent({
      meta,
      usage,
      started,
      ended: Date.now(),
      finishKind: kind,
      errMsg: message,
      ok: thrown ? false : okOf(kind, message),
      now: args.now?.(),
    })
    void args.store.append(event).catch((err: unknown) => {
      safeWarn(args.logger, `llm-meter: persist failed: ${err instanceof Error ? err.message : String(err)}`)
    })
  }

  try {
    const iterable = next()
    for await (const chunk of iterable) {
      try {
        const parsed = inspectChunk(chunk)
        if (parsed.usage) usage = parsed.usage
        if (parsed.finishKind) {
          finishKind = parsed.finishKind
          if (parsed.errMsg) errMsg = parsed.errMsg
        }
      } catch (err) {
        safeWarn(args.logger, `llm-meter: parse skipped: ${err instanceof Error ? err.message : String(err)}`)
      }
      yield chunk
    }
  } catch (err) {
    const message = clipError(err instanceof Error ? err.message : err)
    settle('throw', message, true)
    throw err
  } finally {
    settle(finishKind, errMsg, false)
  }
}
