/**
 * 把「本轮结论」对上底座「已编辑 N 个文件」卡。
 * 只认文件名重合，不扫用户原话，也不按单个公共文件乱挂。
 * client.js 里有同名函数，改这里必须同步那一份。
 */

export type ConclusionAnchorItem = {
  id?: string
  updated_at?: string
  chat_conclusion?: string
  synced_files?: string[]
  deleted_files?: string[]
}

export function fileBasename(p: string): string {
  const s = String(p || '').trim().replace(/\\/g, '/')
  const i = s.lastIndexOf('/')
  return (i >= 0 ? s.slice(i + 1) : s).toLowerCase()
}

/** 从改动卡正文里抽出文件名（含路径时取最后一段）。 */
export function cardFileNames(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const re = /[A-Za-z0-9_.-]+\.[A-Za-z0-9]+/g
  const t = String(text || '')
  let m: RegExpExecArray | null
  while ((m = re.exec(t))) {
    const name = m[0].toLowerCase()
    if (name.length < 5) continue
    if (seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

/**
 * 在候选结论里选能对上这张改动卡的一条。
 * 卡上 ≥3 个文件时，至少重合 2 个才算；并列取更新的一条。
 */
export function pickConclusionForCard(
  items: readonly ConclusionAnchorItem[],
  cardNames: readonly string[],
): ConclusionAnchorItem | null {
  const names = cardNames.map((n) => String(n || '').toLowerCase()).filter(Boolean)
  if (!names.length) return null
  const need = names.length === 1 ? 1 : 2
  let best: ConclusionAnchorItem | null = null
  let bestScore = 0
  let bestTime = -1
  for (const it of items) {
    if (!it || !it.id) continue
    const body = String(it.chat_conclusion || '')
    if (!body.includes('本轮结论')) continue
    const files = [...(it.synced_files || []), ...(it.deleted_files || [])].map(fileBasename)
    const set = new Set(files)
    let score = 0
    for (const n of names) if (set.has(n)) score += 1
    if (score < need) continue
    if (names.length >= 3 && score < 2) continue
    const t = Date.parse(String(it.updated_at || '')) || 0
    if (score > bestScore || (score === bestScore && t > bestTime)) {
      best = it
      bestScore = score
      bestTime = t
    }
  }
  return best
}
