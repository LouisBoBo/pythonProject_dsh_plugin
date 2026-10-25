import { createHash } from 'node:crypto'

/** 账本主键。不保存原始 API Key。 */
export function keyIdOf(apiKey: string): string {
  return createHash('sha256').update(apiKey.trim(), 'utf8').digest('hex')
}

export function tailOf(apiKey: string): string {
  const text = apiKey.trim()
  return text.length <= 4 ? text : text.slice(-4)
}
