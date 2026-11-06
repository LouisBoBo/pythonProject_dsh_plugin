/**
 * 为中软模型网关挂上有界自动重试。
 *
 * 现象：网关瞬时失败常被宿主标成 HTTP 400 + code=INVALID_REQUEST，
 * 而官方 dsh-llm-retry 默认可重试集合不含 INVALID_REQUEST → 本轮直接「处理失败」。
 *
 * 重要：cordis 对同一 `id` 的补丁是整段替换 `config`，不是深合并。
 * 以前在 gateway 块外再写一个只含 retryPolicy 的 `- id: llm-pi-ai`，
 * 会把 models 冲掉，触发
 * `provider "zr-gateway" resolves no models` / INVALID_CONFIG。
 *
 * 现行策略：删掉遗留的独立 retry 块；若 gateway 再生块里还没有 retryPolicy，
 * 就写进该块的 `zr-gateway` 对象（与桌面 ensureGatewayProfile 一致）。
 */
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { gatewayProfilePaths } from './gateway-catalog.js'
import { stripGatewayUsageReportUrl } from './gateway-usage.js'

export const LLM_RETRY_BEGIN = '# zr-llm-retry:begin (idempotent; keep outside zr-model-gateway block)'
export const LLM_RETRY_END = '# zr-llm-retry:end'

export const GATEWAY_PATCH_BEGIN = '# zr-model-gateway:begin (regenerated on launch; edits inside this block are lost)'
export const GATEWAY_PATCH_END = '# zr-model-gateway:end'

/** 与官方 DEFAULT_RETRYABLE_CODES 对齐，并补上网关误标的瞬时 400。 */
export const GATEWAY_RETRY_POLICY_YAML = [
  '        retryPolicy:',
  '          mode: normal',
  '          maxRetries: 5',
  '          retryableCodes:',
  '            - EMPTY_RESPONSE',
  '            - RATE_LIMIT',
  '            - SERVER',
  '            - TIMEOUT',
  '            - TRANSPORT',
  '            - INVALID_REQUEST',
  '            - PI_AI_ERROR',
  '          backoff:',
  '            initialDelayMs: 800',
  '            maxDelayMs: 12000',
  '            jitterRatio: 0.15',
].join('\n')

/**
 * @deprecated 旧的独立补丁整段替换 config，会冲掉 models；仅保留常量供测试识别。
 */
export const GATEWAY_RETRY_BLOCK = [
  LLM_RETRY_BEGIN,
  '# removed: standalone retry patch wiped zr-gateway models',
  LLM_RETRY_END,
].join('\n')

/** 去掉会冲掉 models 的独立 retry 补丁。 */
export function stripLlmRetryBlock(text: string): string {
  const begin = text.indexOf(LLM_RETRY_BEGIN)
  const end = text.indexOf(LLM_RETRY_END)
  if (begin < 0 || end < begin) return text
  const before = text.slice(0, begin).replace(/\s+$/u, '')
  const after = text.slice(end + LLM_RETRY_END.length).replace(/^\s+/u, '')
  return `${before}${after ? `\n\n${after}` : '\n'}`
}

/**
 * 把 retryPolicy 写进 gateway 再生块的 zr-gateway；已有则不动。
 * 同时清掉遗留的独立 retry 补丁。
 */
export function upsertLlmRetryBlock(text: string): string {
  let next = stripLlmRetryBlock(text)
  const begin = next.indexOf(GATEWAY_PATCH_BEGIN)
  const end = next.indexOf(GATEWAY_PATCH_END)
  if (begin < 0 || end < begin) return next
  const block = next.slice(begin, end + GATEWAY_PATCH_END.length)
  // 行内写法 `retryPolicy: {...}` 也算已有，重复插入会触发 YAML 重复键解析失败
  if (/\n\s*retryPolicy\s*:/.test(block)) return next

  const modelsAt = block.search(/\n        models:\s*\n/)
  if (modelsAt < 0) return next
  const absolute = begin + modelsAt
  return `${next.slice(0, absolute)}\n${GATEWAY_RETRY_POLICY_YAML}${next.slice(absolute)}`
}

/**
 * 扫描本机 desktop profile，把重试策略收进网关块，并清掉有害的独立补丁。
 * @returns 实际改写的文件路径列表。
 */
export function ensureGatewayLlmRetry(
  env: NodeJS.ProcessEnv = process.env,
  home?: string,
): string[] {
  const changed: string[] = []
  for (const path of gatewayProfilePaths(env, home)) {
    if (!existsSync(path)) continue
    let prev: string
    try {
      prev = readFileSync(path, 'utf8')
    } catch {
      continue
    }
    const next = upsertLlmRetryBlock(stripGatewayUsageReportUrl(prev))
    if (next === prev) continue
    // 先写临时文件再原子替换：写一半崩溃会留下残缺 YAML，宿主将无法启动
    const tmp = `${path}.zr-${process.pid}.tmp`
    try {
      writeFileSync(tmp, next, 'utf8')
      renameSync(tmp, path)
      changed.push(path)
    } catch {
      // 无写权限时跳过，不影响限额主路径
      try {
        if (existsSync(tmp)) unlinkSync(tmp)
      } catch {
        /* ignore */
      }
    }
  }
  return changed
}
