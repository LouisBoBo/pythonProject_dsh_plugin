/** 上海时区，无夏令时，固定 +08:00。不用 UTC 日期切目录。 */
export function shanghaiIso(date = new Date()): string {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}+08:00`
}
