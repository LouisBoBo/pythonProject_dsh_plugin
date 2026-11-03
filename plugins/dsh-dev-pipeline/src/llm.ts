/** 宿主 LLM：不读 WorkBuddy 的 config.yaml，走 ctx.llm。 */

import type { PipelineConfig, PipelineCtx } from './types.js'

export interface LlmOptions {
  system?: string
  prompt: string
  signal?: AbortSignal
  maxTokens?: number
  temperature?: number
}

interface ResolvedModel {
  provider: string
  model: string
}

let cachedModel: ResolvedModel | null = null

export async function resolveModel(
  ctx: PipelineCtx,
  cfg: PipelineConfig,
): Promise<ResolvedModel> {
  if (cfg.llm.provider && cfg.llm.model) {
    return { provider: cfg.llm.provider, model: cfg.llm.model }
  }
  if (cachedModel && !cfg.llm.provider && !cfg.llm.model) return cachedModel

  const providers = ctx.llm.listProviders()
  if (!providers.length) {
    throw new Error('宿主没有可用的 LLM 提供方；请先在 DSH 设置里配置模型')
  }
  const provider =
    (cfg.llm.provider && providers.find((p) => p.id === cfg.llm.provider)?.id) ||
    providers[0].id
  let model = cfg.llm.model
  if (!model) {
    const models = await ctx.llm.listModels(provider)
    const first = models.find((m) => m.id)?.id
    if (!first) {
      throw new Error(`提供方 ${provider} 没有可用模型；请在设置里选择默认模型`)
    }
    model = first
  }
  cachedModel = { provider, model }
  return cachedModel
}

function userMessage(prompt: string): Record<string, unknown> {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: 'user',
    content: [{ type: 'text', text: prompt }],
    source: { kind: 'user' },
  }
}

export async function completeText(
  ctx: PipelineCtx,
  cfg: PipelineConfig,
  opts: LlmOptions,
): Promise<string> {
  const { provider, model } = await resolveModel(ctx, cfg)
  let text = ''
  let failure = ''

  const stream = ctx.llm.stream({
    provider,
    model,
    system: opts.system,
    messages: [userMessage(opts.prompt)],
    maxTokens: opts.maxTokens ?? 2400,
    temperature: opts.temperature ?? 0.2,
    signal: opts.signal,
  })

  for await (const chunk of stream) {
    const type = String(chunk.type || '')
    if (type === 'text-delta') text += String(chunk.text || '')
    else if (type === 'block-end') {
      const block = chunk.block as { type?: string; text?: string } | undefined
      if (block?.type === 'text' && !text) text += String(block.text || '')
    } else if (type === 'finish') {
      const reason = chunk.reason as { kind?: string; failure?: { message?: string } } | undefined
      if (reason?.kind === 'error' || reason?.kind === 'aborted') {
        failure = String(reason.failure?.message || reason.kind)
      }
    }
  }

  if (failure) throw new Error(`模型调用失败：${failure}`)
  const out = text.trim()
  if (!out) throw new Error('模型返回为空')
  return out
}

export function parseJsonLoose<T>(text: string): T {
  let raw = String(text || '').trim()
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) raw = fence[1].trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start >= 0 && end > start) raw = raw.slice(start, end + 1)
  try {
    return JSON.parse(raw) as T
  } catch (err) {
    throw new Error(`模型未返回合法 JSON：${String(err)}；片段：${raw.slice(0, 300)}`)
  }
}

export async function completeJson<T>(
  ctx: PipelineCtx,
  cfg: PipelineConfig,
  opts: LlmOptions,
): Promise<T> {
  const text = await completeText(ctx, cfg, opts)
  return parseJsonLoose<T>(text)
}
