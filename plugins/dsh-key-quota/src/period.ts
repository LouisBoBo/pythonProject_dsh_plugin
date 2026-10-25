const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000

/** 自然月。与 llm-meter 的 formatTsShanghai 同一偏移，不用 UTC 日期。 */
export function periodOf(d = new Date()): string {
  const shanghai = new Date(d.getTime() + SHANGHAI_OFFSET_MS)
  const year = shanghai.getUTCFullYear()
  const month = String(shanghai.getUTCMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}
