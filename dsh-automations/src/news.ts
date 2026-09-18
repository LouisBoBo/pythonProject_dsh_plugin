import { AutomationError } from './types.js'
import { searchWeb, webSearchEnabled, type RecencyFilter } from './web_search.js'

type NewsItem = {
  title: string
  link: string
  summary: string
  media?: string
  publishDate?: string
}

export async function fetchPcbAiNews(): Promise<{ items: NewsItem[]; recency: RecencyFilter }> {
  if (!webSearchEnabled()) {
    throw new AutomationError(
      'tool_unavailable',
      '未配置智谱 API Key，无法联网搜索。请到 WorkBuddy「系统配置 → 视觉模型」填写智谱 Key（与 simplified VISION_API_KEY 相同）。',
    )
  }
  const attempts: { query: string; search_recency_filter: RecencyFilter }[] = [
    { query: '今日 PCB+AI 新闻', search_recency_filter: 'oneDay' },
    { query: 'PCB AI 新闻', search_recency_filter: 'oneWeek' },
  ]
  let lastErr = '检索失败'
  for (const attempt of attempts) {
    const out = await searchWeb({ query: attempt.query, count: 10, search_recency_filter: attempt.search_recency_filter })
    if (!out.ok) {
      lastErr = out.error || '检索失败'
      continue
    }
    const items: NewsItem[] = []
    for (const row of out.results || []) {
      if (!row.title) continue
      const meta = [row.media, row.publish_date].filter(Boolean).join(' ')
      const summary = [row.content, meta].filter(Boolean).join(' ').trim().slice(0, 180)
      items.push({
        title: row.title,
        link: row.link,
        summary,
        media: row.media,
        publishDate: row.publish_date,
      })
      if (items.length >= 5) break
    }
    if (items.length) return { items, recency: attempt.search_recency_filter }
    lastErr = '无匹配结果'
  }
  throw new AutomationError('tool_unavailable', `新闻检索不可用：${lastErr}`)
}

export function formatNewsSummary(items: NewsItem[], recency: RecencyFilter = 'oneWeek'): string {
  if (!items.length) return '今日未检索到 PCB+AI 相关新闻。'
  const scope = recency === 'oneDay' ? '今日' : '近一周'
  const lines = [
    `📰 PCB+AI 领域重要新闻摘要（${scope}）`,
    `以下为检索到的${scope} PCB+AI 领域重要动态，聚焦 AI 算力对 PCB 产业链的驱动（来源为公开资讯，链接为空处为检索结果未提供具体 URL，均已注明发布日期）：`,
    '',
  ]
  items.forEach((it, i) => {
    const source = [it.media, it.publishDate].filter(Boolean).join(' ') || it.link
    lines.push(`${i + 1}. ${it.title}`)
    if (it.summary) lines.push(`要点：${it.summary}`)
    if (source) lines.push(`来源：${source}`)
    if (i < items.length - 1) lines.push('')
  })
  return lines.join('\n')
}
