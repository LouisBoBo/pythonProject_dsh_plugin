import { AutomationError } from './types.js'

type NewsItem = { title: string; link: string; summary: string }

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function parseRss(xml: string): NewsItem[] {
  const items: NewsItem[] = []
  const re = /<item>([\s\S]*?)<\/item>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const block = m[1]
    const title = decodeXml((block.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '').trim()
    const link = decodeXml((block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '').trim()
    const desc = decodeXml((block.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180)
    if (title) items.push({ title, link, summary: desc })
    if (items.length >= 8) break
  }
  return items
}

async function fetchText(url: string): Promise<string> {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), 12_000)
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': 'dsh-automations/0.1 (read-only news digest)' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(t)
  }
}

export async function fetchPcbAiNews(): Promise<NewsItem[]> {
  const urls = [
    'https://news.google.com/rss/search?q=PCB+AI&hl=zh-CN&gl=CN&ceid=CN:zh-Hans',
    'https://news.google.com/rss/search?q=PCB+artificial+intelligence&hl=en-US&gl=US&ceid=US:en',
  ]
  let lastErr = '检索失败'
  for (const url of urls) {
    try {
      const xml = await fetchText(url)
      const items = parseRss(xml)
      if (items.length) return items.slice(0, 5)
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
    }
  }
  throw new AutomationError('tool_unavailable', `新闻检索不可用：${lastErr}`)
}

export function formatNewsSummary(items: NewsItem[]): string {
  if (!items.length) return '今日未检索到 PCB+AI 相关新闻。'
  const lines = items.map((it, i) => {
    const link = it.link ? ` ${it.link}` : ''
    const body = it.summary ? `要点：${it.summary}` : ''
    return `${i + 1}. ${it.title}${link}\n${body}`.trim()
  })
  return `今日 PCB+AI 要闻（${items.length} 条）\n\n${lines.join('\n\n')}`
}
