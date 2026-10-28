import { createHash } from 'node:crypto'

/** 账本主键。不保存原始 API Key。 */
export function keyIdOf(apiKey: string): string {
  return createHash('sha256').update(apiKey.trim(), 'utf8').digest('hex')
}

export function tailOf(apiKey: string): string {
  const text = apiKey.trim()
  return text.length <= 4 ? text : text.slice(-4)
}

/** 页面上的 Key。固定露出前 8 位和后 4 位，中间用 *****。太短或会露出原文时不返回。 */
export function maskApiKey(apiKey: string): string {
  const text = apiKey.trim()
  const head = 8
  const tail = 4
  if (text.length < head + tail + 4) return ''
  const shown = `${text.slice(0, head)}*****${text.slice(-tail)}`
  if (shown === text || shown.includes(text) || text.includes(shown)) return ''
  return shown
}
