/**
 * 运行摘要 → 企微推送正文。
 * 对照 simplified-workbuddy `apps/automations/run_summary_text.py`，禁止另起版式。
 */

export const WECOM_TEXT_SEP = '- - - - - - - - - - - - - - -'
const WECOM_TEXT_MAX_BYTES = 2040
const WECOM_MD_MAX_BYTES = 4090
const NEWS_INTRO_DEFAULT =
  '📰 PCB+AI 领域重要新闻摘要（近一周）\n以下为检索到的近一周 PCB+AI 领域重要动态，聚焦 AI 算力对 PCB 产业链的驱动（来源为公开资讯，链接为空处为检索结果未提供具体 URL，均已注明发布日期）：'
const NEWS_INTRO_META_RE = /整理后的|仅基于已提供|未补充或编造|未编造链接|标题、要点、链接/

const URL_RE = /https?:\/\/[^\s<>[\]()，。；;]+/gi
const SOURCE_META_PAREN_RE =
  /[（(][^）)]*(?:接口未返回|检索接口|未返回\s*URL|未返回可直接引用|检索结果未附|检索结果未返回|搜索结果未返回|未附可点击链接|未返回可点击链接)[^）)]*[）)]/gi
const TRAILING_DATE_SOURCE_RE = /[（(]([^）)]*\d{4}-\d{2}-\d{2}[^）)]*)[）)]\s*$/
const LEADING_DATE_BODY_RE = /^\s*[（(]([^）)]*\d{4}-\d{2}-\d{2}[^）)]*)[）)]\s*/
const TITLE_DATE_RE = /[（(]([^）)]*\d{4}-\d{2}-\d{2}[^）)]*)[）)]/g
const META_FOOTER_RE = /\n---+\s*\n+\s*(?:\*\*)?(?:说明|数据说明)(?:\*\*)?[：:][\s\S]*$/
const META_INLINE_RE = /\n\s*(?:说明|数据说明)[：:][\s\S]*$/
/** 链接 作为 来源 别名：当前新闻 LLM 偶发输出「链接：」，推送仍展示为「来源：」 */
const SOURCE_LINE_RE =
  /(?:^|\n)\s*(?:[-*]\s+)?(?:来源|链接)[：:]\s*([\s\S]*?)(?=\n---|\n\s*(?:\*\*)?(?:说明|补充说明|趋势小结|小结|数据缺口|数据说明)[：:]|$)/
const DETAIL_LINE_RE =
  /(?:^|\n)\s*(?:[-*]\s+)?细分[：:]\s*([\s\S]*?)(?=\n---|\n\s*(?:\*\*)?(?:说明|补充说明|趋势小结|小结|数据缺口|数据说明)[：:]|$)/
const POINTS_LINE_RE =
  /(?:^|\n)\s*(?:[-*]\s+)?要点[：:]\s*([\s\S]*?)(?=\n\s*(?:[-*]\s+)?(?:来源|链接|细分)[：:]|$)/
const NEWS_ITEM_RE = /\*\*(\d+)\.\s*([\s\S]*?)\*\*/g
const PLAIN_NEWS_ITEM_RE = /(?:^|\n)\s*(\d+)\.\s*([^\n]+)/g
const REPORT_SECTION_RE =
  /(?:^|\n)\s*(?:#{1,3}\s*)?(?:\*\*)?([一二三四五六七八九十]+、[^\n*]+?)(?:\*\*)?\s*(?:\n|$)/g
const NUMBERED_LINE_RE = /(?:^|\n)\s*(\d+)[.、．]\s*/g

export type ParsedNewsItem = {
  index: number
  title: string
  points: string
  source: string
  source_label: string
  link: string
}

export type ParsedSection = {
  title: string
  type: 'numbered' | 'bullets' | 'text'
  items: { index: number; text: string }[]
}

export type ParsedRunSummary =
  | { kind: 'empty' }
  | { kind: 'news'; intro: string; items: ParsedNewsItem[] }
  | { kind: 'report'; intro: string; sections: ParsedSection[] }
  | { kind: 'plain'; paragraphs: string[] }

function stripMarkdownInline(text: string): string {
  return String(text || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripAgentMeta(text: string): string {
  return String(text || '')
    .replace(META_FOOTER_RE, '')
    .replace(META_INLINE_RE, '')
    .replace(/^#+\s*昨日生产运营日报[^\n]*\n+/gim, '')
    .replace(/^>\s[^\n]*\n+/gm, '')
    .replace(/^(?:[^\n]*(?:所有数据已取齐|交叉核对|以下为昨日生产运营日报)[^\n]*\n+)*/i, '')
    .trim()
}

function isProductionDailyReport(text: string, automationName = ''): boolean {
  const name = String(automationName || '')
  if (/生产运营日报|生产日报|昨日生产/.test(name)) return true
  const raw = String(text || '')
  return /\*\*1\.\s*工单概况\*\*/.test(raw) || /^1\.\s*工单概况/m.test(raw) || /一、工单概况/.test(raw)
}

function sanitizeSource(source: string): string {
  return String(source || '')
    .replace(URL_RE, '')
    .replace(SOURCE_META_PAREN_RE, '')
    .replace(/[（(]\s*[）)]/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[，,、；;]\s*$/, '')
    .replace(/[。．]?\s*无原文链接[。．]?/g, '')
    .replace(/^(?:未提供|无|暂无|无链接)$/g, '')
    .trim()
}

function extractTrailingSourceMeta(text: string): [string, string] {
  const raw = String(text || '').trim()
  const m = raw.match(TRAILING_DATE_SOURCE_RE)
  if (!m || m.index == null) return [raw, '']
  return [raw.slice(0, m.index).replace(/[，,、]\s*$/, '').trim(), m[1].trim()]
}

function extractDateFromTitle(title: string): string {
  const matches = [...String(title || '').matchAll(TITLE_DATE_RE)]
  if (matches.length) return matches[matches.length - 1][1].trim()
  const cn = String(title || '').match(/(\d{4})年(\d{1,2})月(\d{1,2})日/)
  if (!cn) return ''
  const pad = (n: string) => n.padStart(2, '0')
  return `${cn[1]}-${pad(cn[2] || '1')}-${pad(cn[3] || '1')}`
}

function extractLeadingDateFromBody(body: string): [string, string] {
  const raw = String(body || '')
  const m = raw.match(LEADING_DATE_BODY_RE)
  if (!m) return ['', raw]
  return [m[1].trim(), raw.slice(m[0].length)]
}

function finalizeSource(source: string, title: string, leadDate: string): string {
  let value = String(source || '').trim()
  if (!value && leadDate) value = leadDate
  if (!value) value = extractDateFromTitle(title)
  return sanitizeSource(value)
}

function stripItemFooter(text: string): string {
  return String(text || '')
    .replace(/\n---[\s\S]*$/, '')
    .replace(/\n\s*\*\*(?:说明|补充说明|趋势小结|小结)[：:][\s\S]*$/, '')
    .trim()
}

function stripBlock(text: string): string {
  return String(text || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^---+$/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function collapseWs(s: string): string {
  return s.replace(/\n+/g, ' ').trim()
}

function parseNewsItemBody(body: string): [string, string, string, string] {
  const raw = stripBlock(stripItemFooter(body))
  let points = ''
  let source = ''
  let sourceLabel = '来源'
  const pm = raw.match(POINTS_LINE_RE)
  const dm = raw.match(DETAIL_LINE_RE)
  const sm = raw.match(SOURCE_LINE_RE)
  if (pm) points = collapseWs(pm[1])
  if (dm) {
    source = collapseWs(dm[1])
    sourceLabel = '细分'
  } else if (sm) {
    source = collapseWs(sm[1])
    sourceLabel = '来源'
  }
  const meta = dm || sm
  if (!points && meta && meta.index != null) {
    const before = raw.slice(0, meta.index).trim()
    if (before) points = collapseWs(before)
  }
  if (!points && !source && raw) points = collapseWs(raw)
  if (points && !source) {
    const [cleaned, trailing] = extractTrailingSourceMeta(points)
    if (trailing) {
      points = cleaned
      source = trailing
      sourceLabel = '细分'
    }
  }
  URL_RE.lastIndex = 0
  const urls = (source || raw).match(URL_RE) || []
  const firstUrl = urls[0]
  const link = firstUrl ? firstUrl.replace(/[.,;:!?)]+$/, '') : ''
  return [points, sanitizeSource(source), link, sourceLabel]
}

function parseNewsItemFields(title: string, body: string): [string, string, string, string] {
  const [leadDate, rest] = extractLeadingDateFromBody(body)
  const [points, source, link, sourceLabel] = parseNewsItemBody(rest)
  return [points, finalizeSource(source, title, leadDate), link, sourceLabel]
}

function parseNewsItemsBold(text: string): ParsedNewsItem[] {
  const cleaned = stripAgentMeta(text)
  NEWS_ITEM_RE.lastIndex = 0
  const matches = [...cleaned.matchAll(NEWS_ITEM_RE)]
  return matches.map((m, i) => {
    const title = stripMarkdownInline(m[2])
    const start = (m.index || 0) + m[0].length
    const end = i + 1 < matches.length ? matches[i + 1].index || cleaned.length : cleaned.length
    const [points, source, link, sourceLabel] = parseNewsItemFields(title, cleaned.slice(start, end))
    return { index: Number(m[1]), title, points, source, source_label: sourceLabel, link }
  })
}

function parsePlainNewsItems(text: string): ParsedNewsItem[] {
  const cleaned = stripAgentMeta(text)
  PLAIN_NEWS_ITEM_RE.lastIndex = 0
  const matches = [...cleaned.matchAll(PLAIN_NEWS_ITEM_RE)]
  if (!matches.length || matches[0][1] !== '1') return []
  return matches.map((m, i) => {
    const title = stripMarkdownInline(m[2])
    const start = (m.index || 0) + m[0].length
    const end = i + 1 < matches.length ? matches[i + 1].index || cleaned.length : cleaned.length
    const [points, source, link, sourceLabel] = parseNewsItemFields(title, cleaned.slice(start, end))
    return { index: Number(m[1]), title, points, source, source_label: sourceLabel, link }
  })
}

function parseNewsItems(text: string): ParsedNewsItem[] {
  const bold = parseNewsItemsBold(text)
  if (bold.length) return bold
  return parsePlainNewsItems(text)
}

function findFirstNewsIndex(raw: string): number {
  const cleaned = stripAgentMeta(raw)
  const m = cleaned.match(/(?:^|\n)\s*1\.\s+/)
  if (m && m.index != null) return m.index
  const idx = raw.indexOf('**1.')
  return idx >= 0 ? idx : -1
}

function newsIntro(raw: string): string {
  const idx = findFirstNewsIndex(raw)
  if (idx > 0) return stripBlock(stripAgentMeta(raw.slice(0, idx)))
  return ''
}

function normalizeNewsIntro(intro: string): string {
  const text = String(intro || '').trim()
  if (!text || NEWS_INTRO_META_RE.test(text)) return NEWS_INTRO_DEFAULT
  return text
}

function splitNumberedLines(text: string): { index: number; text: string }[] {
  const raw = String(text || '').trim()
  NUMBERED_LINE_RE.lastIndex = 0
  const matches = [...raw.matchAll(NUMBERED_LINE_RE)]
  if (!matches.length) return []
  const items: { index: number; text: string }[] = []
  for (let i = 0; i < matches.length; i++) {
    const start = (matches[i].index || 0) + matches[i][0].length
    const end = i + 1 < matches.length ? matches[i + 1].index || raw.length : raw.length
    const body = stripMarkdownInline(raw.slice(start, end)).trim()
    if (body) items.push({ index: Number(matches[i][1]), text: body })
  }
  return items
}

function parseReportSections(text: string): { intro: string; sections: ParsedSection[] } | null {
  const cleaned = stripBlock(stripAgentMeta(text))
  if (!/[一二三四五六七八九十]+、/.test(cleaned)) return null
  REPORT_SECTION_RE.lastIndex = 0
  const matches = [...cleaned.matchAll(REPORT_SECTION_RE)]
  if (!matches.length) return null
  const firstIdx = matches[0].index || 0
  const intro = stripMarkdownInline(cleaned.slice(0, firstIdx)).trim()
  const sections: ParsedSection[] = []
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]
    const title = stripMarkdownInline(m[1]).trim()
    const start = (m.index || 0) + m[0].length
    const end = i + 1 < matches.length ? matches[i + 1].index || cleaned.length : cleaned.length
    const body = cleaned.slice(start, end).trim()
    const numbered = splitNumberedLines(body)
    if (numbered.length) {
      sections.push({ title, type: 'numbered', items: numbered })
      continue
    }
    const bullets = body
      .replace(/^[-*]\s+/, '')
      .split(/\n\s*[-*]\s+/)
      .map((p) => stripMarkdownInline(p).trim())
      .filter(Boolean)
    if (bullets.length) {
      sections.push({
        title,
        type: 'bullets',
        items: bullets.map((t, j) => ({ index: j + 1, text: t })),
      })
      continue
    }
    const para = stripMarkdownInline(body).trim()
    if (para) sections.push({ title, type: 'text', items: [{ index: 1, text: para }] })
  }
  if (!sections.length) return null
  return { intro, sections }
}

function bannerTitle(kind: string, automationName: string, summary = ''): string {
  if (kind === 'news' && isProductionDailyReport(summary, automationName)) return '生产日报'
  if (kind === 'news') return '今日精选'
  if (kind === 'report') return '本周简报'
  return String(automationName || '').trim() || '任务摘要'
}

export function parseRunSummary(text: string, automationName = ''): ParsedRunSummary {
  const raw = String(text || '').trim()
  if (!raw) return { kind: 'empty' }
  if (isProductionDailyReport(raw, automationName)) {
    const paragraphs = stripBlock(stripAgentMeta(raw))
      .split(/\n\n/)
      .map((p) => p.trim())
      .filter(Boolean)
    return paragraphs.length ? { kind: 'plain', paragraphs } : { kind: 'empty' }
  }
  const items = parseNewsItems(raw)
  if (items.length) return { kind: 'news', intro: normalizeNewsIntro(newsIntro(raw)), items }
  const report = parseReportSections(raw)
  if (report) return { kind: 'report', intro: report.intro, sections: report.sections }
  const paragraphs = stripBlock(stripAgentMeta(raw))
    .split(/\n\n/)
    .map((p) => p.trim())
    .filter(Boolean)
  return { kind: 'plain', paragraphs }
}

function formatTs(startedAt?: number | null): string {
  if (!startedAt) return ''
  const d = new Date(Number(startedAt) * 1000)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatNewsItemText(item: ParsedNewsItem): string[] {
  const label = item.source_label || '来源'
  const lines = [`${item.index}. ${item.title}`]
  if (item.points) lines.push(`要点：${item.points}`)
  if (item.link) lines.push(`${label}：${item.link}`)
  else if (item.source) lines.push(`${label}：${item.source}`)
  return lines
}

function escapeWecomMd(text: string): string {
  return String(text || '').replace(/</g, '&lt;').trim()
}

function mdJoin(...parts: string[]): string {
  return parts.filter((p) => p && String(p).trim()).join('\n\n')
}

function formatNewsItemMd(item: ParsedNewsItem): string {
  const label = item.source_label || '来源'
  const chunks = [`**${item.index}. ${escapeWecomMd(item.title)}**`]
  if (item.points) chunks.push(`要点：${escapeWecomMd(item.points)}`)
  if (item.link) chunks.push(`[${label}](${item.link})`)
  else if (item.source) chunks.push(`${label}：${escapeWecomMd(item.source)}`)
  return mdJoin(...chunks)
}

function truncateBytes(text: string, maxBytes: number, note: string): string {
  const content = String(text || '').trim()
  const encoded = Buffer.from(content, 'utf8')
  if (encoded.length <= maxBytes) return content
  const budget = maxBytes - Buffer.byteLength(note, 'utf8')
  return Buffer.from(encoded.subarray(0, Math.max(0, budget))).toString('utf8') + note
}

export function formatWecomText(
  summary: string,
  automationName = '',
  startedAt?: number | null,
): string {
  const parsed = parseRunSummary(summary, automationName)
  if (parsed.kind === 'empty') return ''
  const banner = bannerTitle(parsed.kind, automationName, summary)
  const ts = formatTs(startedAt)
  const lines: string[] = [`📰 ${banner}`]
  if (ts) lines.push(`${ts} · ZR WorkBuddy 自动推送`)

  if (parsed.kind === 'news') {
    if (parsed.intro) lines.push(parsed.intro)
    parsed.items.forEach((item, i) => {
      lines.push(WECOM_TEXT_SEP)
      lines.push(...formatNewsItemText(item))
      if (i === parsed.items.length - 1) lines.push(WECOM_TEXT_SEP)
    })
    if (!parsed.items.length) lines.push(WECOM_TEXT_SEP)
    lines.push('由 ZR WorkBuddy 自动生成')
    return lines.join('\n').trim()
  }

  lines.push('')
  if (parsed.kind === 'report') {
    if (parsed.intro) lines.push(parsed.intro, '', WECOM_TEXT_SEP, '')
    parsed.sections.forEach((sec, si) => {
      lines.push(sec.title, '')
      if (sec.type === 'numbered') {
        for (const row of sec.items) lines.push(`${row.index}、${row.text}`, '')
      } else if (sec.type === 'bullets') {
        for (const row of sec.items) lines.push(`• ${row.text}`, '')
      } else {
        const text = sec.items[0]?.text || ''
        if (text) lines.push(text, '')
      }
      if (si < parsed.sections.length - 1) lines.push(WECOM_TEXT_SEP, '')
    })
  } else {
    parsed.paragraphs.forEach((para, pi) => {
      lines.push(para, '')
      if (pi < parsed.paragraphs.length - 1) lines.push(WECOM_TEXT_SEP, '')
    })
  }

  lines.push(WECOM_TEXT_SEP, '', '由 ZR WorkBuddy 自动生成')
  return lines.join('\n').trim()
}

export function formatPlainText(summary: string, _automationName = ''): string {
  const parsed = parseRunSummary(summary, _automationName)
  if (parsed.kind === 'empty') return ''
  const lines: string[] = []
  const banner = bannerTitle(parsed.kind, _automationName, summary)
  lines.push(`📰 ${banner} 📰`, '')
  if (parsed.kind === 'news') {
    if (parsed.intro) lines.push(parsed.intro, '')
    for (const item of parsed.items) {
      lines.push(`${item.index}. ${item.title}`)
      if (item.points) lines.push(`要点：${item.points}`)
      if (item.link) lines.push(`来源：${item.link}`)
      else if (item.source) lines.push(`来源：${item.source}`)
      lines.push('')
    }
  } else if (parsed.kind === 'report') {
    if (parsed.intro) lines.push(parsed.intro, '')
    for (const sec of parsed.sections) {
      lines.push(sec.title)
      if (sec.type === 'numbered') {
        for (const row of sec.items) lines.push(`${row.index}、${row.text}`)
      } else if (sec.type === 'bullets') {
        for (const row of sec.items) lines.push(`• ${row.text}`)
      } else if (sec.items[0]?.text) {
        lines.push(sec.items[0].text)
      }
      lines.push('')
    }
  } else {
    for (const para of parsed.paragraphs) lines.push(para, '')
  }
  return lines.join('\n').trim()
}

export function formatWecomMarkdown(
  summary: string,
  automationName = '',
  startedAt?: number | null,
): string {
  const parsed = parseRunSummary(summary, automationName)
  if (parsed.kind === 'empty') return ''
  const banner = bannerTitle(parsed.kind, automationName, summary)
  const ts = formatTs(startedAt)
  let header = `## 📰 ${escapeWecomMd(banner)}`
  if (ts) header += `\n> ${ts} · ZR WorkBuddy 自动推送`
  const blocks: string[] = [header]
  if (parsed.kind === 'news') {
    if (parsed.intro) {
      blocks.push(escapeWecomMd(parsed.intro))
      blocks.push(WECOM_TEXT_SEP)
    }
    parsed.items.forEach((item, i) => {
      blocks.push(formatNewsItemMd(item))
      if (i < parsed.items.length - 1) blocks.push(WECOM_TEXT_SEP)
    })
  } else if (parsed.kind === 'report') {
    if (parsed.intro) {
      blocks.push(escapeWecomMd(parsed.intro))
      blocks.push(WECOM_TEXT_SEP)
    }
    for (const sec of parsed.sections) {
      const secParts = [`**${escapeWecomMd(sec.title)}**`]
      if (sec.type === 'numbered') {
        for (const row of sec.items) secParts.push(`${row.index}、${escapeWecomMd(row.text)}`)
      } else if (sec.type === 'bullets') {
        for (const row of sec.items) secParts.push(`• ${escapeWecomMd(row.text)}`)
      } else if (sec.items[0]?.text) {
        secParts.push(escapeWecomMd(sec.items[0].text))
      }
      blocks.push(mdJoin(...secParts))
    }
  } else {
    for (const para of parsed.paragraphs) blocks.push(escapeWecomMd(para))
  }
  blocks.push(WECOM_TEXT_SEP, '由 ZR WorkBuddy 自动生成')
  const note = '\n\n…（内容过长已截断，完整版见 WorkBuddy 运行记录）'
  return truncateBytes(mdJoin(...blocks), WECOM_MD_MAX_BYTES, note)
}

export function formatWecomPush(
  summary: string,
  automationName = '',
  startedAt?: number | null,
): { msgtype: 'text' | 'markdown' | ''; content: string } {
  const text = formatWecomText(summary, automationName, startedAt)
  if (!text) return { msgtype: '', content: '' }
  const note = '\n\n…（内容过长已截断，完整版见 WorkBuddy 运行记录）'
  if (Buffer.byteLength(text, 'utf8') <= WECOM_TEXT_MAX_BYTES) {
    return { msgtype: 'text', content: text }
  }
  // 超长仍发同一套 text 版式（📰 今日精选 / 要点 / 来源），不用 ## ** markdown 改版。
  return {
    msgtype: 'markdown',
    content: truncateBytes(text, WECOM_MD_MAX_BYTES, note),
  }
}
