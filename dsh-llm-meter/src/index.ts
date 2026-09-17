import type { Context } from '@deepseek-ai/cordis'
import { isAgentLoopRequest, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { Config, resolveConfig, type MeterConfig } from './config.js'
import { classifyCall } from './classify.js'
import { JsonlStore } from './store.js'
import { wrapMeteredStream } from './wrap.js'

export { Config }
export type { MeterConfig }

/** Cordis 短名，必须与 cordis.patch.yml 的 id 一致。 */
export const name = 'llm-meter'

/** 只注入 llm，避免拉起用不到的服务。 */
export const inject = ['llm'] as const

function tryIsAgentLoop(options: object): boolean {
  try {
    return isAgentLoopRequest(options as GenerateOptions)
  } catch {
    return false
  }
}

export function apply(ctx: Context, config: MeterConfig | undefined): void {
  const resolved = resolveConfig(config)
  if (!resolved.enabled) return

  const logger = {
    warn: (msg: string) => {
      try {
        ctx.logger.warn(msg)
      } catch {
        // ignore
      }
    },
  }

  const store = new JsonlStore(resolved.eventsPath, resolved.maxFileBytes, logger)

  try {
    ctx.logger.info(`llm-meter: llm/stream → ${resolved.eventsPath}`)
  } catch {
    // ignore
  }

  // global：知识库抽取等旁路 fiber 也要记；不 prepend，避免挤掉宿主 invariant。
  ctx.on('llm/stream', (options: GenerateOptions, next: () => AsyncIterable<StreamChunk>) => wrapMeteredStream(options, next, {
    store,
    logger,
    classify: (opts) => classifyCall(opts, { isAgentLoop: tryIsAgentLoop }),
  }), { global: true })
}
