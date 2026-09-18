import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { computeNextRunAt, shouldRunNow, rruleToScheduleLabel, enrichSchedule } from './schedule.js'
import { detectForbiddenAction } from './safety.js'
import { fingerprintPrompt } from './util.js'
import { createAutomation, deleteAutomation, listAutomations, listRuns, recoverOrphanRuns, appendRun, updateRun, updateAutomation, usesTemplatePipeline, resolveFeishuDocSync, resolveYuqueDocSync } from './store.js'
import { executeAutomation } from './executor.js'
import { markRunning, clearRunning, anyRunning } from './runtime.js'
import { normalizeWebhookKey, buildWebhookUrl, resolveWecomSettings } from './wecom.js'
import { AUTOMATION_TEMPLATES, PROMPT_SKELETON } from './templates.js'
import { parseRrule } from './schedule.js'
import { formatSearchResultsMarkdown, searchWeb } from './web_search.js'
import { formatNewsSummary } from './news.js'
import { readWorkbuddyCreds } from './workbuddy_config.js'
import { formatMesDailyReport } from './mes_report.js'
import {
  attachRunCharts,
  chartsFromMesFacts,
  chartsFromMesSummary,
  formatChartsMarkdown,
  sanitizeCharts,
} from './mes_charts.js'
import { renderChartPngs } from './chart_png.js'
import {
  _resetFeishuTokenCache,
  buildFeishuMarkdown,
  deliverFeishuDoc,
  normalizeWikiToken,
  publishNewFeishuDoc,
} from './feishu_docs.js'
import {
  formatPlainText,
  formatWecomMarkdown,
  formatWecomPush,
  formatWecomText,
  parseRunSummary,
  WECOM_TEXT_SEP,
} from './run_summary_text.js'
import { publicConfigView, loadConfig } from './config.js'
import {
  buildYuqueMarkdown,
  deliverYuqueDoc,
  yuqueAuthView,
} from './yuque_docs.js'
import {
  looksLikeYuqueSecret,
  normalizeYuqueBook,
  parseCookieFileText,
  yuqueRequestHeaders,
  cookieValue,
} from './yuque_book.js'
import { chatCompletionsUrl } from './llm.js'
import { isPromptSkeleton, resolveRewriteDraft, rewriteAutomationPrompt } from './rewrite.js'
import { resolveMesEntity, loadMesEntities, type MesEntity } from './mes_catalog.js'
import { runCustomAgent } from './agent.js'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

{
  const now = new Date('2026-09-17T08:00:00')
  const n = computeNextRunAt(
    {
      status: 'active',
      schedule_type: 'recurring',
      rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
      scheduled_at: null,
      valid_from: null,
      valid_until: null,
    },
    now,
  )
  const expect = Math.floor(new Date('2026-09-17T09:00:00').getTime() / 1000)
  assert(n === expect, `daily next got ${n} want ${expect}`)
}

{
  const now = new Date('2026-09-17T09:00:00')
  const n = computeNextRunAt(
    {
      status: 'active',
      schedule_type: 'recurring',
      rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
      scheduled_at: null,
      valid_from: null,
      valid_until: null,
    },
    now,
  )
  const expect = Math.floor(new Date('2026-09-18T09:00:00').getTime() / 1000)
  assert(n === expect, 'at exactly 9:00 next is tomorrow')
}

{
  const fri = new Date('2026-09-16T10:00:00') // Wednesday? 2026-09-17 is Thursday. 16 is Wednesday.
  const n = computeNextRunAt(
    {
      status: 'active',
      schedule_type: 'recurring',
      rrule: 'FREQ=WEEKLY;BYDAY=FR;BYHOUR=17;BYMINUTE=0',
      scheduled_at: null,
      valid_from: null,
      valid_until: null,
    },
    fri,
  )
  const expect = Math.floor(new Date('2026-09-18T17:00:00').getTime() / 1000)
  assert(n === expect, `weekly friday got ${n} want ${expect}`)
}

{
  const paused = computeNextRunAt({
    status: 'paused',
    schedule_type: 'recurring',
    rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
    scheduled_at: null,
    valid_from: null,
    valid_until: null,
  })
  assert(paused == null, 'paused has no next')
}

{
  const item = enrichSchedule({
    status: 'active' as const,
    schedule_type: 'recurring' as const,
    rrule: 'FREQ=DAILY;BYHOUR=8;BYMINUTE=0',
    scheduled_at: null,
    valid_from: null,
    valid_until: null,
    next_run_at: null,
    last_run_at: null,
  })
  assert(typeof item.next_run_at === 'number', 'enrich writes next_run_at')
  const nra = item.next_run_at
  if (typeof nra !== 'number') throw new Error('next_run_at missing')
  assert(!shouldRunNow({ ...item, last_run_at: null }, nra - 10), 'future not due')
  assert(shouldRunNow({ ...item, last_run_at: null }, nra), 'due at next_run_at')
  assert(!shouldRunNow({ ...item, last_run_at: nra }, nra + 1), 'last_run covers this slot')
}

assert(rruleToScheduleLabel('FREQ=DAILY;BYHOUR=9;BYMINUTE=0') === '每天 09:00', 'label daily')
assert(rruleToScheduleLabel('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0') === '工作日 09:00', 'label weekday')
assert(parseRrule('FREQ=DAILY;BYHOUR=8').FREQ === 'DAILY', 'parse rrule')

assert(detectForbiddenAction('提交代码并部署到预发') === 'forbidden_action', 'forbidden commit+deploy')
assert(detectForbiddenAction('git commit -am x') === 'forbidden_action', 'forbidden git commit')
assert(detectForbiddenAction('检索 PCB 新闻，不要取消推送') === null, 'must not treat 取消 as control')
assert(detectForbiddenAction('每日生产运营日报') === null, 'report not forbidden')

assert(AUTOMATION_TEMPLATES.length === 4, 'four templates')
const news = AUTOMATION_TEMPLATES.find((t) => t.id === 'daily-ai-news')
assert(news && fingerprintPrompt(news.prompt).length === 16, 'fingerprint')
const mes = AUTOMATION_TEMPLATES.find((t) => t.id === 'mes-daily-production-report')
assert(mes && mes.prompt.includes('inspect_mes_profile'), 'mes prompt has inspect step')
assert(mes && mes.prompt.includes('**1. 工单概况**'), 'mes prompt has body format')
assert(mes && mes.prompt.includes('禁止：Markdown 表格'), 'mes prompt has forbid line')

{
  const md = formatSearchResultsMarkdown([
    {
      title: '测试新闻',
      content: '摘要内容',
      link: 'https://example.com/a',
      media: 'Example',
      publish_date: '2026-08-27',
    },
  ])
  assert(md.includes('测试新闻'), 'search md title')
  assert(md.includes('https://example.com/a'), 'search md link')
  const emptyNews = formatNewsSummary([])
  assert(emptyNews.includes('未检索到'), 'empty news summary')
}

{
  assert(chatCompletionsUrl('https://api.deepseek.com') === 'https://api.deepseek.com/v1/chat/completions', 'ds root +v1')
  assert(chatCompletionsUrl('https://api.deepseek.com/') === 'https://api.deepseek.com/v1/chat/completions', 'ds slash')
  assert(chatCompletionsUrl('https://api.deepseek.com/v1') === 'https://api.deepseek.com/v1/chat/completions', 'ds v1 kept')
  assert(chatCompletionsUrl('https://user:pass@api.deepseek.com') === '', 'ds reject userinfo')
  assert(
    chatCompletionsUrl('https://open.bigmodel.cn/api/paas/v4') === 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    'glm v4 untouched',
  )
  assert(isPromptSkeleton(PROMPT_SKELETON), 'skeleton detected')
  assert(isPromptSkeleton('【目标】（一句话：要产出什么）\n【数据来源】MES'), 'placeholder skeleton')
  assert(!isPromptSkeleton('【目标】每日物料库存推送\n【数据来源】当前 MES'), 'real prompt not skeleton')
  assert(resolveRewriteDraft('', '每日物料库存推送') === '每日物料库存推送', 'name fallback when empty')
  assert(resolveRewriteDraft(PROMPT_SKELETON, '每日物料库存推送') === '每日物料库存推送', 'name fallback when skeleton')
  assert(resolveRewriteDraft('查昨日工单', '日报') === '查昨日工单', 'draft wins')
  assert(resolveRewriteDraft('  ', '') === '', 'both empty')
}

{
  const ents: MesEntity[] = [
    {
      id: 'warehouse-dashboard',
      label: '仓储看板',
      aliases: ['库存', '库存列表'],
      path: '/api/warehouse/dashboard',
      ops: ['query'],
      listKeys: ['stats'],
    },
    {
      id: 'warehouse-inventory-stock',
      label: '物料库存列表',
      aliases: ['库存', '物料库存', '库存列表'],
      path: '/api/warehouse/inventory-stock',
      ops: ['query'],
      listKeys: ['items'],
    },
  ]
  assert(resolveMesEntity('warehouse-inventory-stock', ents)?.id === 'warehouse-inventory-stock', 'exact id')
  assert(resolveMesEntity('库存', ents)?.id === 'warehouse-inventory-stock', '库存 prefers stock not dashboard')
  assert(resolveMesEntity('物料库存', ents)?.id === 'warehouse-inventory-stock', '物料库存 alias')
  assert(cookieValue('a=%E4%B8%AD; b=1', 'a') === '中', 'cookie decode')
  assert(cookieValue('a=%E0%A4%A; b=1', 'a') === '%E0%A4%A', 'cookie bad percent')
  const evilDir = mkdtempSync(join(tmpdir(), 'dsh-ent-'))
  mkdirSync(join(evilDir, 'mes_profiles', 'x'), { recursive: true })
  writeFileSync(
    join(evilDir, 'mes_profiles', 'x', 'entities.json'),
    JSON.stringify({
      entities: [
        { id: 'ok', label: '库存', aliases: ['库存'], path: '/api/warehouse/inventory-stock', ops: ['query'] },
        { id: 'bad', label: 'x', aliases: [], path: '/api/../admin', ops: ['query'] },
        { id: 'abs', label: 'y', aliases: [], path: '/api/http://evil.example/x', ops: ['query'] },
      ],
    }),
  )
  const prevData = process.env.WORKBUDDY_DATA_DIR
  process.env.WORKBUDDY_DATA_DIR = evilDir
  try {
    const loaded = loadMesEntities()
    assert(loaded.some((e) => e.id === 'ok'), 'catalog keeps safe path')
    assert(loaded.every((e) => e.id !== 'bad' && e.id !== 'abs'), 'catalog drops traversal path')
  } finally {
    if (prevData === undefined) delete process.env.WORKBUDDY_DATA_DIR
    else process.env.WORKBUDDY_DATA_DIR = prevData
    rmSync(evilDir, { recursive: true, force: true })
  }
}

{
  const dir = mkdtempSync(join(tmpdir(), 'dsh-wb-'))
  const yamlPath = join(dir, 'config.yaml')
  writeFileSync(
    yamlPath,
    [
      'mes:',
      '  base_url: http://127.0.0.1:8009',
      '  username: admin',
      '  password: admin123',
      'vision:',
      '  api_key: wb-vision-test-key',
      '  base_url: https://open.bigmodel.cn/api/paas/v4',
      'deepseek:',
      '  api_key: sk-wb-llm',
      '  base_url: https://api.deepseek.com',
      '  model: deepseek-v4-flash',
      'automations:',
      '  wecom_webhook_key: https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc-def',
      '  wecom_push_enabled: true',
      '  wecom_push_dry_run: false',
      '  feishu_app_id: cli_test_app',
      '  feishu_app_secret: feishu-test-secret',
      '',
    ].join('\n'),
  )
  const prevWb = process.env.WORKBUDDY_CONFIG_YAML
  process.env.WORKBUDDY_CONFIG_YAML = yamlPath
  const creds = readWorkbuddyCreds()
  assert(creds.visionApiKey === 'wb-vision-test-key', 'wb vision key')
  assert(creds.llmApiKey === 'sk-wb-llm', 'wb llm key')
  assert(creds.visionBaseUrl.includes('open.bigmodel.cn'), 'wb vision base')
  assert(creds.wecomPushEnabled === true, 'wb wecom enabled')
  assert(creds.wecomDryRun === false, 'wb wecom not dry-run')
  assert(creds.wecomWebhookKey.includes('key=abc-def'), 'wb wecom key')
  assert(creds.feishuAppId === 'cli_test_app', 'wb feishu app')
  assert(creds.feishuAppSecret === 'feishu-test-secret', 'wb feishu secret')
  assert(creds.mesBaseUrl === 'http://127.0.0.1:8009', 'wb mes base')
  assert(creds.mesUsername === 'admin', 'wb mes user')
  const wecom = resolveWecomSettings()
  assert(wecom.enabled === true, 'resolve wecom enabled')
  assert(wecom.fromWorkbuddy === true, 'resolve wecom from wb')
  assert(wecom.dryRun === false, 'resolve wecom live')
  assert(wecom.key.includes('abc-def'), 'resolve wecom key')
  process.env.WORKBUDDY_CONFIG_YAML = '-'
  const disabled = readWorkbuddyCreds()
  assert(!disabled.visionApiKey && !disabled.llmApiKey && !disabled.mesBaseUrl, 'wb config disable')
  if (prevWb === undefined) delete process.env.WORKBUDDY_CONFIG_YAML
  else process.env.WORKBUDDY_CONFIG_YAML = prevWb
  rmSync(dir, { recursive: true, force: true })
}

{
  const dir = mkdtempSync(join(tmpdir(), 'dsh-wb-mes-'))
  const yamlPath = join(dir, 'config.yaml')
  writeFileSync(yamlPath, ['mes:', '  base_url: http://10.0.0.8:8009', ''].join('\n'))
  const prevWb = process.env.WORKBUDDY_CONFIG_YAML
  process.env.WORKBUDDY_CONFIG_YAML = yamlPath
  const creds = readWorkbuddyCreds()
  assert(creds.mesBaseUrl === 'http://10.0.0.8:8009', 'mes-only yaml still loads')
  if (prevWb === undefined) delete process.env.WORKBUDDY_CONFIG_YAML
  else process.env.WORKBUDDY_CONFIG_YAML = prevWb
  rmSync(dir, { recursive: true, force: true })
}

{
  assert(normalizeYuqueBook('acme/daily') === 'acme/daily', 'yuque ns')
  assert(normalizeYuqueBook('https://www.yuque.com/acme/daily/welcome') === 'acme/daily', 'yuque url ns')
  assert(normalizeYuqueBook('https://space.yuque.com/acme/daily') === 'acme/daily', 'yuque space ns')
  let threw = false
  try {
    normalizeYuqueBook('_yuque_session=abc; yuque_ctoken=x')
  } catch {
    threw = true
  }
  assert(threw, 'cookie not a book')
  assert(looksLikeYuqueSecret('_yuque_session=abc'), 'secret detect')
  const parsed = parseCookieFileText('# note\nhost: https://space.yuque.com\n_yuque_session=s; yuque_ctoken=c\n')
  assert(parsed.host.includes('space.yuque.com'), 'cookie file host')
  assert(parsed.cookie.includes('_yuque_session=s'), 'cookie file body')
  const headers = yuqueRequestHeaders({
    host: 'https://www.yuque.com',
    mode: 'cookie',
    cookie: '_yuque_session=s; yuque_ctoken=csrf-1',
    referer: 'https://www.yuque.com/acme/daily',
  })
  assert(headers.Cookie.includes('_yuque_session=s'), 'cookie header')
  assert(headers['X-Csrf-Token'] === 'csrf-1', 'csrf header')
  assert(!headers['X-Auth-Token'], 'no token header in cookie mode')
  const underscored = yuqueRequestHeaders({
    host: 'https://www.yuque.com',
    mode: 'cookie',
    cookie: '_yuque_session=s; _yuque_ctoken=csrf-2',
    referer: 'https://www.yuque.com/acme/daily',
  })
  assert(underscored['X-Csrf-Token'] === 'csrf-2', 'underscore ctoken')
  const md = buildYuqueMarkdown('生产运营日报 2026-09-17', '1. 工单概况\n昨日 3 单', [])
  assert(md.includes('生产运营日报'), 'yuque md title')
}

{
  const facts = {
    yesterday: '2026-09-17',
    statusCounts: { pending: 18, in_progress: 28, completed: 24, closed: 18, cancelled: 12, draft: 0 },
    wip: 28,
    pending: 18,
    open: 46,
    urgentOpen: 23,
    completedYesterday: 12,
    utilization: null,
    oee: null,
    outputTotal: 80990,
    processYield: [
      { process: '贴片', yieldRate: 97.87 },
      { process: '功能测试', yieldRate: 97.89 },
    ],
    anomalies: [{ line: 'SMT-1线', process: '焊接', defect: '虚焊', severity: 'critical' }],
  }
  const text = formatMesDailyReport(facts)
  assert(text.includes('**1. 工单概况**'), 'mes s1')
  assert(text.includes('在制 28 单'), 'mes wip')
  assert(text.includes('紧急未完工 23 单'), 'mes urgent')
  assert(!text.includes('设备稼动率'), 'omit util when missing')
  assert(text.includes('**2. 设备产出**'), 'output renumbered')
  assert(text.includes('日产出 80990'), 'output qty')
  assert(text.includes('**3. 工序良率**'), 'yield section')
  assert(text.includes('**4. 需关注**'), 'attention')
  assert(!text.includes('inspect_mes'), 'no tool names')
  assert(!text.includes('无接口'), 'no gap talk')
  const parsedMes = parseRunSummary(text, '每日生产运营日报')
  assert(parsedMes.kind !== 'news', 'mes daily is not news')
  const wecomMes = formatWecomText(text, '每日生产运营日报', 1789719916)
  assert(!wecomMes.includes('PCB+AI'), 'mes wecom has no news intro')
  assert(wecomMes.includes('工单概况') || wecomMes.includes('在制'), 'mes wecom keeps body')
  const fromFacts = chartsFromMesFacts(facts)
  assert(fromFacts.some((c) => c.id === 'wo-status' && c.items.some((x) => x.label === '待开工' && x.value === 18)), 'status bar')
  assert(fromFacts.some((c) => c.id === 'wo-open' && c.type === 'pie'), 'open pie')
  assert(fromFacts.some((c) => c.id === 'yield' && c.items.some((x) => x.label === '贴片')), 'yield bar')
  const dirty = sanitizeCharts([
    { id: '../etc/passwd', type: 'bar', unit: '单', items: [{ label: '待开工', value: 1 }] },
  ])
  assert(dirty.length === 1 && dirty[0].id === 'etcpasswd', 'chart id stripped')
  const fromText = chartsFromMesSummary(text, '每日生产运营日报')
  assert(fromText.some((c) => c.id === 'wo-status' && c.items.some((x) => x.label === '进行中' && x.value === 28)), 'parse status')
  assert(fromText.some((c) => c.id === 'yield'), 'parse yield')
  assert(!formatWecomText(text, '每日生产运营日报').includes('数据图示'), 'wecom has no chart section')
  const live = chartsFromMesSummary(
    '**1. 工单概况**\n要点：9 月 17 日在制 34 单、待开工 20 单。\n细分：状态分布：待开工 20、进行中 34、已完成 674、已关闭 228、已取消 44。\n\n**3. 工序良率**\n要点：良率。\n细分：贴片 97.88%、焊接 97.88%、AOI检测 97.88%、功能测试 97.89%、包装 97.87%。',
    '每日生产运营日报',
  )
  assert(live.some((c) => c.items.some((x) => x.label === '已完成' && x.value === 674)), 'live status')
  assert(attachRunCharts({ summary: text, automation_name: '每日生产运营日报' }).length >= 2, 'attach from summary')
}

{
  assert(normalizeWikiToken('GbrewQpwkiAybBkeT2TcALXonud') === 'GbrewQpwkiAybBkeT2TcALXonud', 'wiki token passthrough')
  assert(normalizeWikiToken('wiki/XzFpwaNq2imremkDEchcpQODnue') === 'XzFpwaNq2imremkDEchcpQODnue', 'wiki/ prefix')
  assert(normalizeWikiToken('/wiki/XzFpwaNq2imremkDEchcpQODnue') === 'XzFpwaNq2imremkDEchcpQODnue', 'slash wiki prefix')
  assert(
    normalizeWikiToken('https://xxx.feishu.cn/wiki/GbrewQpwkiAybBkeT2TcALXonud?from=space') ===
      'GbrewQpwkiAybBkeT2TcALXonud',
    'wiki url token',
  )
  let baseThrew = false
  try {
    normalizeWikiToken('https://xxx.feishu.cn/base/bascnABCDEFG')
  } catch {
    baseThrew = true
  }
  assert(baseThrew, 'reject bitable url')
  const md = buildFeishuMarkdown('生产运营日报 2026-09-17', '**1. 工单概况**\n要点：在制 1 单。')
  assert(md.startsWith('# 生产运营日报 2026-09-17'), 'doc title heading')
  assert(md.includes('**1. 工单概况**'), 'doc keeps body')
  const mdChart = buildFeishuMarkdown('生产运营日报 2026-09-17', '**1. 工单概况**\n要点：在制 1 单。', [
    { id: 'wo-status', title: '工单状态', type: 'bar', unit: '单', items: [{ label: '待开工', value: 20 }] },
  ])
  assert(mdChart.includes('## 数据图示'), 'doc chart heading')
  assert(mdChart.includes('| 待开工 | 20 |'), 'doc chart table')
  assert(formatChartsMarkdown([]).trim() === '', 'empty charts silent')
  const pngs = renderChartPngs([
    { id: 'wo-status', title: '工单状态', type: 'bar', unit: '单', items: [{ label: '待开工', value: 20 }, { label: '进行中', value: 34 }] },
    { id: 'wo-open', title: '未完工构成', type: 'pie', unit: '单', items: [{ label: '待开工', value: 20 }, { label: '进行中', value: 34 }] },
  ])
  if (pngs.length) {
    assert(pngs[0].buffer[0] === 0x89, 'png magic')
    assert(pngs.some((p) => p.id === 'wo-status'), 'bar png')
    assert(pngs.some((p) => p.id === 'wo-open'), 'pie png')
  }
}

{
  const key = normalizeWebhookKey('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc-def')
  assert(key === 'abc-def', 'normalize url key')
  assert(buildWebhookUrl(key).includes('key=abc-def'), 'build url')
  let threw = false
  try {
    normalizeWebhookKey('https://example.com/hook?key=x')
  } catch {
    threw = true
  }
  assert(threw, 'reject non-wecom host')
}

{
  const SAMPLE_NEWS = `今日 PCB+AI 领域要闻如下：

**1. 某厂发布 AI 辅助布线工具**
要点：提升高密度板设计效率。
来源：https://example.com/news/1

**2. 行业峰会聚焦智能制造**
要点：AI 与 PCB 检测结合。
来源：行业媒体
`

  const SAMPLE_PLAIN_NEWS = `已完成检索（智谱 Web Search）。

1. 沪电股份半年报：AI 驱动业绩高增
要点：营收同比 +61%。
来源：沪电股份 2026 年半年度报告。无原文链接。

2. 特创科技：AI 服务器级 PCB 量产
要点：进入全线规模化量产。
来源：特创科技（转载自 PCB 行业媒体）。
`

  const parsedPlain = parseRunSummary(SAMPLE_PLAIN_NEWS)
  assert(parsedPlain.kind === 'news', 'plain news kind')
  assert(chartsFromMesSummary(SAMPLE_PLAIN_NEWS, '每日PCB+AI新闻推送').length === 0, 'news has no mes charts')
  assert(parsedPlain.kind === 'news', 'plain news kind')
  assert(parsedPlain.kind === 'news' && parsedPlain.items.length === 2, 'plain news items')
  assert(parsedPlain.kind === 'news' && parsedPlain.items[0].title.includes('沪电股份'), 'plain news title')
  assert(parsedPlain.kind === 'news' && (parsedPlain.intro || '').includes('检索'), 'plain news intro')

  const text = formatWecomText(SAMPLE_PLAIN_NEWS, '每日PCB+AI新闻推送', 1787878800)
  assert(text.includes('- - - -'), 'wecom text sep')
  assert(text.includes('\n1. 沪电股份'), 'wecom numbered')
  assert(!text.includes('无原文链接'), 'strip 无原文链接')
  assert(text.startsWith('📰 今日精选'), 'banner 今日精选')
  assert(text.includes('ZR WorkBuddy 自动推送'), 'auto push line')
  assert(text.includes('由 ZR WorkBuddy 自动生成'), 'footer')
  assert(text.includes(WECOM_TEXT_SEP), 'exact sep')
  assert(!text.includes('【每日PCB+AI新闻推送】'), 'no task-name wrap')
  assert(!text.includes('**1.'), 'news push not markdown bold')
  assert(!text.includes('## 📰'), 'news push not markdown h2')

  const push = formatWecomPush(SAMPLE_PLAIN_NEWS, '每日PCB+AI新闻推送', 1787878800)
  assert(push.msgtype === 'text' || push.msgtype === 'markdown', 'push msgtype')
  assert(push.content.startsWith('📰 今日精选'), 'push banner')
  assert(push.content.includes('1. 沪电股份'), 'push item')
  assert(push.content.includes('- - - -'), 'push sep')
  assert(!push.content.includes('【1/2】'), 'no chunk marker')
  assert(!push.content.includes('**1.'), 'push keeps text layout')

  const liveLlm = `以下为整理后的 3–5 条中文摘要（仅基于已提供条目，未补充或编造链接）：

1. PCB 行业日报（2026年9月17日）
- 要点：9月16日PCB概念反复活跃。
- 链接：未提供

2. AI服务器拉动PCB需求，电子布价格大幅上涨
- 要点：电子布由周期品转为紧缺品。
- 链接：未提供
`
  const livePush = formatWecomPush(liveLlm, '每日PCB+AI新闻推送', 1789702026)
  assert(livePush.content.startsWith('📰 今日精选'), 'live banner')
  assert(livePush.content.includes('📰 PCB+AI 领域重要新闻摘要'), 'live default intro')
  assert(livePush.content.includes('1. PCB 行业日报'), 'live item')
  assert(livePush.content.includes('要点：9月16日PCB概念反复活跃。'), 'live points')
  assert(livePush.content.includes('来源：2026-09-17'), 'live title date source')
  assert(!livePush.content.includes('链接：未提供'), 'strip 链接未提供')
  assert(!livePush.content.includes('【每日PCB+AI新闻推送】'), 'live no task wrap')
  assert(!livePush.content.includes('**1.'), 'live not markdown items')
  assert(livePush.content.includes('由 ZR WorkBuddy 自动生成'), 'live footer')

  const parsedNews = parseRunSummary(SAMPLE_NEWS)
  assert(parsedNews.kind === 'news' && parsedNews.items.length === 2, 'bold news items')
  assert(parsedNews.kind === 'news' && parsedNews.items[0].title.includes('AI 辅助布线'), 'bold news title')

  const md = formatWecomMarkdown(SAMPLE_NEWS, '每日PCB+AI新闻推送', 1787878800)
  assert(md.includes('## 📰'), 'md header')
  assert(md.includes('**1.'), 'md bold item')
  assert(md.includes('[来源](https://example.com/news/1)'), 'md source link')
  assert(md.includes('要点：提升高密度板设计效率。\n\n[来源]'), 'md double newline')
  assert(md.includes('- - - -'), 'md sep')

  const stripped = formatWecomMarkdown(
    `**1. 测试标题**
要点：内容
来源：2026-08-26 行业报道（检索结果未附可点击链接）
`,
    '测试',
  )
  assert(!stripped.includes('检索结果未附'), 'strip meta source')
  assert(stripped.includes('2026-08-26 行业报道'), 'keep date media')

  const trailing = parseRunSummary(`**1. AI 算力驱动高端 PCB 板块景气延续**
要点：Prismark 预计未来 5 年服务器需求增长。（2026-08-26）

**2. PCB 钻针产业量价齐升**
要点：AI 服务器 PCB 层数持续升高。（2026-08-27）
`)
  assert(trailing.kind === 'news' && trailing.items[0].source === '2026-08-26', 'trailing date source')
  assert(trailing.kind === 'news' && !trailing.items[0].points.includes('2026-08-26'), 'date not in points')
  assert(trailing.kind === 'news' && trailing.items[1].source === '2026-08-27', 'second date source')

  const bullets = parseRunSummary(`**1. 鹏鼎控股董事长：AI 服务器 PCB 业务正处快速追赶阶段**
- 鹏鼎控股正式将 AI 服务器 PCB 确立为第二成长曲线。
- 高阶 HDI 已通过主流客户认证并批量供货。
- 来源：中国银河证券研究报告/业绩说明会报道（检索结果未返回可点击链接）
`)
  assert(bullets.kind === 'news' && bullets.items[0].points.includes('鹏鼎控股'), 'bullet points')
  assert(bullets.kind === 'news' && (bullets.items[0].source || '').includes('中国银河证券'), 'bullet source')
  assert(bullets.kind === 'news' && !(bullets.items[0].source || '').includes('检索结果未返回'), 'bullet strip meta')

  const footer = parseRunSummary(`**5. 特创科技：AI 服务器级二次电源 PCB 进入全线规模化量产**
要点：产品覆盖 14-24 层 HDI。（2026-08-27）

---
**趋势小结**：今日信息集中在三条主线。
`)
  assert(footer.kind === 'news' && footer.items[0].source === '2026-08-27', 'footer date')
  assert(footer.kind === 'news' && !footer.items[0].points.includes('趋势小结'), 'strip 趋势小结')

  const titleDate = parseRunSummary(`**2. AI 算力驱动高端 PCB 板块景气延续**（2026-08-26）
- 高盛上调全球 AI 服务器 PCB 市场预测。
- 行业整体产能仍非常紧张。
`)
  assert(titleDate.kind === 'news' && titleDate.items[0].source === '2026-08-26', 'title date fallback')
  assert(titleDate.kind === 'news' && titleDate.items[0].points.includes('高盛'), 'title date points')

  const report = `一、已完成工作
1、落地自动化调度
2、接入联网搜索

二、下周计划
1、企微推送
`
  const parsedReport = parseRunSummary(report)
  assert(parsedReport.kind === 'report', 'report kind')
  const plain = formatPlainText(report, '周报')
  assert(plain.includes('1、落地自动化调度'), 'plain numbered report')
}

{
  const root = mkdtempSync(join(tmpdir(), 'dsh-auto-'))
  mkdirSync(join(root, 'data'), { recursive: true })
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-auto-cwd-'))
  writeFileSync(join(cwd, 'a.txt'), 'hello')

  void (async () => {
    const prevLlmUrl = process.env.DSH_AUTOMATIONS_LLM_BASE_URL
    const prevLlmKey = process.env.DSH_AUTOMATIONS_LLM_API_KEY
    process.env.DSH_AUTOMATIONS_LLM_BASE_URL = 'https://api.deepseek.com'
    process.env.DSH_AUTOMATIONS_LLM_API_KEY = 'sk-test-rewrite'
    const origRewriteFetch = globalThis.fetch
    let rewriteUrl = ''
    let rewriteBody: { max_tokens?: number; messages?: { content?: string }[] } = {}
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      rewriteUrl = String(input)
      try {
        rewriteBody = JSON.parse(String(init?.body || '{}')) as typeof rewriteBody
      } catch {
        rewriteBody = {}
      }
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '```\n【目标】每日物料库存推送\n【数据来源】当前 MES\n【输出格式】早报式\n```',
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as typeof fetch
    try {
      let emptyHint = ''
      try {
        await rewriteAutomationPrompt('', '')
      } catch (e) {
        emptyHint = e instanceof Error ? e.message : String(e)
      }
      assert(emptyHint.includes('请先'), 'empty rewrite hint')
      const named = await rewriteAutomationPrompt('', '每日物料库存推送')
      assert(named.includes('【目标】每日物料库存推送'), 'name as draft')
      assert(!named.includes('```'), 'rewrite strips fence')
      assert(rewriteUrl === 'https://api.deepseek.com/v1/chat/completions', 'rewrite hits deepseek /v1')
      assert(rewriteBody.max_tokens === 2048, 'rewrite max_tokens')
      const user = String(rewriteBody.messages?.[1]?.content || '')
      assert(user.includes('每日物料库存推送'), 'rewrite user has name')
      assert(user.includes('【指令骨架参考】'), 'rewrite user has skeleton')
      const drafted = await rewriteAutomationPrompt('查昨日工单', '日报')
      assert(drafted.includes('【目标】'), 'draft rewrite ok')
    } finally {
      globalThis.fetch = origRewriteFetch
      if (prevLlmUrl === undefined) delete process.env.DSH_AUTOMATIONS_LLM_BASE_URL
      else process.env.DSH_AUTOMATIONS_LLM_BASE_URL = prevLlmUrl
      if (prevLlmKey === undefined) delete process.env.DSH_AUTOMATIONS_LLM_API_KEY
      else process.env.DSH_AUTOMATIONS_LLM_API_KEY = prevLlmKey
    }

    const mesData = mkdtempSync(join(tmpdir(), 'dsh-mes-data-'))
    mkdirSync(join(mesData, 'mes_profiles', 'demo'), { recursive: true })
    writeFileSync(
      join(mesData, 'mes_profiles', 'demo', 'entities.json'),
      JSON.stringify({
        entities: [
          {
            id: 'warehouse-dashboard',
            label: '仓储看板',
            aliases: ['库存'],
            path: '/api/warehouse/dashboard',
            ops: ['query'],
            list_keys: ['stats'],
          },
          {
            id: 'warehouse-inventory-stock',
            label: '物料库存列表',
            aliases: ['库存', '物料库存'],
            path: '/api/warehouse/inventory-stock',
            ops: ['query'],
            list_keys: ['items'],
          },
        ],
      }),
    )
    const mesYaml = join(mesData, 'config.yaml')
    writeFileSync(mesYaml, ['mes:', '  base_url: http://127.0.0.1:8009', '  username: u', '  password: p', ''].join('\n'))
    const prevDataDir = process.env.WORKBUDDY_DATA_DIR
    const prevWbMes = process.env.WORKBUDDY_CONFIG_YAML
    const prevLlmUrl2 = process.env.DSH_AUTOMATIONS_LLM_BASE_URL
    const prevLlmKey2 = process.env.DSH_AUTOMATIONS_LLM_API_KEY
    process.env.WORKBUDDY_DATA_DIR = mesData
    process.env.WORKBUDDY_CONFIG_YAML = mesYaml
    process.env.DSH_AUTOMATIONS_LLM_BASE_URL = 'https://api.deepseek.com'
    process.env.DSH_AUTOMATIONS_LLM_API_KEY = 'sk-test-rewrite'
    const origMesFetch = globalThis.fetch
    let chatRound = 0
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/auth/login')) {
        return new Response(JSON.stringify({ access_token: 'mes-token' }), { status: 200 })
      }
      if (url.includes('/api/warehouse/inventory-stock')) {
        return new Response(
          JSON.stringify({
            total: 1,
            items: [{ material_name: '贴片电容 1μF', quantity: 3200, warehouse_name: '一号原料仓', unit: 'pcs' }],
          }),
          { status: 200 },
        )
      }
      if (url.includes('/chat/completions')) {
        chatRound += 1
        if (chatRound === 1) {
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: '',
                    tool_calls: [
                      {
                        id: 'call_stock',
                        type: 'function',
                        function: { name: 'query_mes_data', arguments: '{"entity":"库存"}' },
                      },
                    ],
                  },
                },
              ],
            }),
            { status: 200 },
          )
        }
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: '**1. 物料库存**\n要点：贴片电容 1μF 库存 3200（一号原料仓）。' } }],
          }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({ message: `unexpected ${url}` }), { status: 500 })
    }) as typeof fetch
    try {
      const summary = await runCustomAgent(
        {
          id: 'auto-mes',
          name: '每日物料库存推送',
          prompt: '查询当日物料库存，按早报输出。',
          source: 'custom',
          template_id: null,
          prompt_fingerprint: '',
          status: 'active',
          schedule_type: 'once',
          rrule: '',
          scheduled_at: null,
          valid_from: null,
          valid_until: null,
          cwds: [],
          push_to_wecom: false,
          bitable_sync: { enabled: false, app_token: '', table_id: '', mode: 'append' },
          feishu_doc: { enabled: false, parent_token: '' },
          yuque_doc: { enabled: false, book: '' },
          next_run_at: null,
          last_run_at: null,
          created_at: 1,
          updated_at: 1,
        },
        null,
      )
      assert(summary.includes('贴片电容'), 'custom mes uses inventory rows')
      assert(!summary.includes('没有连接'), 'custom mes not denied')
      assert(chatRound >= 2, 'custom mes tool round')
    } finally {
      globalThis.fetch = origMesFetch
      rmSync(mesData, { recursive: true, force: true })
      if (prevDataDir === undefined) delete process.env.WORKBUDDY_DATA_DIR
      else process.env.WORKBUDDY_DATA_DIR = prevDataDir
      if (prevWbMes === undefined) delete process.env.WORKBUDDY_CONFIG_YAML
      else process.env.WORKBUDDY_CONFIG_YAML = prevWbMes
      if (prevLlmUrl2 === undefined) delete process.env.DSH_AUTOMATIONS_LLM_BASE_URL
      else process.env.DSH_AUTOMATIONS_LLM_BASE_URL = prevLlmUrl2
      if (prevLlmKey2 === undefined) delete process.env.DSH_AUTOMATIONS_LLM_API_KEY
      else process.env.DSH_AUTOMATIONS_LLM_API_KEY = prevLlmKey2
    }

    process.env.DSH_AUTOMATIONS_HOME = root
    const prevWb = process.env.WORKBUDDY_CONFIG_YAML
    process.env.WORKBUDDY_CONFIG_YAML = '-'
    const prevZhipu = process.env.ZHIPU_API_KEY
    const prevBig = process.env.BIGMODEL_API_KEY
    const prevVision = process.env.VISION_API_KEY
    delete process.env.ZHIPU_API_KEY
    delete process.env.BIGMODEL_API_KEY
    delete process.env.VISION_API_KEY
    const missing = await searchWeb({ query: 'PCB AI 新闻' })
    assert(missing.ok === false, 'search missing key not ok')
    assert(String(missing.error || '').includes('未配置'), 'search missing key hint')

    process.env.ZHIPU_API_KEY = 'test-key'
    const origFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          search_result: [
            {
              title: 'AI 服务器带动 HDI',
              content: '高层板需求上升',
              link: 'https://news.example/pcb',
              media: 'News',
              publish_date: '2026-08-27',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )) as typeof fetch
    try {
      const hit = await searchWeb({ query: 'PCB AI', count: 5, search_recency_filter: 'oneDay' })
      assert(hit.ok === true, 'search mock ok')
      assert(hit.count === 1, 'search mock count')
      assert((hit.markdown || '').includes('AI 服务器'), 'search mock markdown')
    } finally {
      globalThis.fetch = origFetch
      if (prevZhipu === undefined) delete process.env.ZHIPU_API_KEY
      else process.env.ZHIPU_API_KEY = prevZhipu
      if (prevBig === undefined) delete process.env.BIGMODEL_API_KEY
      else process.env.BIGMODEL_API_KEY = prevBig
      if (prevVision === undefined) delete process.env.VISION_API_KEY
      else process.env.VISION_API_KEY = prevVision
      if (prevWb === undefined) delete process.env.WORKBUDDY_CONFIG_YAML
      else process.env.WORKBUDDY_CONFIG_YAML = prevWb
    }

    {
      _resetFeishuTokenCache()
      const orig = globalThis.fetch
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('tenant_access_token')) {
          return new Response(JSON.stringify({ code: 0, tenant_access_token: 't', expire: 7200 }), { status: 200 })
        }
        if (url.includes('get_node')) {
          return new Response(
            JSON.stringify({
              code: 0,
              data: { node: { space_id: '1', node_token: 'x', obj_type: 'bitable' } },
            }),
            { status: 200 },
          )
        }
        return new Response(JSON.stringify({ code: -1, msg: `unexpected ${url}` }), { status: 500 })
      }) as typeof fetch
      try {
        let threw = false
        try {
          await publishNewFeishuDoc({
            appId: 'cli_x',
            appSecret: 's',
            parentToken: 'GbrewTable',
            title: 't',
            markdown: '# h\n\nbody',
          })
        } catch (e) {
          threw = String(e).includes('多维表格')
        }
        assert(threw, 'reject bitable parent node')
      } finally {
        globalThis.fetch = orig
        _resetFeishuTokenCache()
      }
    }

    const created = await createAutomation(root, {
      name: '目录巡检',
      template_id: 'dir-watch-digest',
      cwds: [cwd],
      push_to_wecom: false,
    })
    assert(created.template_id === 'dir-watch-digest', 'template id kept')
    assert(usesTemplatePipeline(created), 'untouched template uses pipeline')
    assert(created.push_to_wecom === false, 'wecom default off')
    assert(created.bitable_sync && created.bitable_sync.enabled === false, 'bitable default off')
    assert(!(created.feishu_doc && created.feishu_doc.enabled), 'feishu doc default off')
    assert(!(created.yuque_doc && created.yuque_doc.enabled), 'yuque doc default off')
    const listed = listAutomations(root)
    assert(listed.length === 1 && listed[0].id === created.id, 'list')

    const updated = await createAutomation(root, { name: '自定义', prompt: '只读汇总目录', cwds: [cwd] })
    assert(updated.source === 'custom', 'custom source')
    assert(!usesTemplatePipeline(updated), 'custom not pipeline')
    assert(updated.push_to_wecom === false, 'custom wecom off')
    assert(!(updated.bitable_sync && updated.bitable_sync.enabled), 'custom bitable off')

    const feishu = await createAutomation(root, {
      name: '飞书',
      prompt: '只读汇总目录',
      feishu_doc: { enabled: true, parent_token: 'wiki/XzFpwaNq2imremkDEchcpQODnue' },
    })
    assert(feishu.feishu_doc?.enabled === true, 'feishu doc enabled')
    assert(feishu.feishu_doc?.parent_token === 'XzFpwaNq2imremkDEchcpQODnue', 'feishu parent strips wiki/')
    const patched = await updateAutomation(root, feishu.id, {
      feishu_doc: { enabled: true, parent_token: 'wiki/XzFpwaNq2imremkDEchcpQODnue' },
    })
    assert(patched?.feishu_doc?.parent_token === 'XzFpwaNq2imremkDEchcpQODnue', 'update keeps wiki parent')
    const legacy = await createAutomation(root, {
      name: '旧写表字段',
      prompt: '只读汇总目录',
      bitable_sync: { enabled: true, app_token: 'GbrewQpwkiAybBkeT2TcALXonud', table_id: 'tblhwidPjKUboOVd', mode: 'append' },
    })
    const resolved = resolveFeishuDocSync(legacy)
    assert(resolved.enabled && resolved.parent_token === 'GbrewQpwkiAybBkeT2TcALXonud', 'legacy wiki token as parent')
    const realTable = await createAutomation(root, {
      name: '真表格',
      prompt: '只读汇总目录',
      bitable_sync: { enabled: true, app_token: 'basc1', table_id: 'tbl1', mode: 'append' },
    })
    assert(!resolveFeishuDocSync(realTable).enabled, 'basc token is not a wiki parent')

    const okLock = await markRunning(root, created.id, 'run-1')
    assert(okLock, 'first lock')
    assert(await anyRunning(root), 'any running')
    const second = await markRunning(root, updated.id, 'run-2')
    assert(!second, 'global mutex')
    await clearRunning(root, created.id, 'run-1')
    assert(!(await anyRunning(root)), 'cleared')

    const run = await appendRun(root, { automation_id: created.id, automation_name: created.name, status: 'running' })
    const settled = await updateRun(root, run.id, { status: 'succeeded', summary: '无新文件', finished_at: 1 })
    assert(settled?.status === 'succeeded', 'succeed')
    const dirty = await updateRun(root, run.id, { status: 'cancelled', summary: '不该改' })
    assert(dirty?.status === 'succeeded', 'terminal status frozen')
    assert(dirty?.summary === '无新文件', 'terminal summary frozen')

    await appendRun(root, { automation_id: created.id, status: 'running', automation_name: 'x' })
    const n = await recoverOrphanRuns(root)
    assert(n >= 1, 'orphan recovered')
    const runs = listRuns(root, 1, 10)
    assert(runs.items.some((r) => r.status === 'failed' && r.error?.code === 'interrupted'), 'interrupted code')

    const ran = await executeAutomation(root, created)
    assert(ran.ok, 'dir watch execute ok')
    assert((ran.run?.summary || '').includes('无新文件') || (ran.run?.summary || '').includes('变更'), 'dir summary')
    assert(!ran.run?.feishu_status || ran.run.feishu_status === 'skipped', 'no feishu when off')

    const yamlPath = join(root, 'wb.yaml')
    writeFileSync(
      yamlPath,
      [
        'automations:',
        '  feishu_app_id: cli_test_doc',
        '  feishu_app_secret: feishu-test-secret',
        '',
      ].join('\n'),
    )
    const prevWbDoc = process.env.WORKBUDDY_CONFIG_YAML
    process.env.WORKBUDDY_CONFIG_YAML = yamlPath
    _resetFeishuTokenCache()
    const createdDocs: string[] = []
    const origFeishuFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = String(init?.method || 'GET').toUpperCase()
      if (url.includes('tenant_access_token')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 't-test', expire: 7200 }), { status: 200 })
      }
      if (url.includes('get_node')) {
        return new Response(
          JSON.stringify({ code: 0, data: { node: { space_id: '7573', node_token: 'GbrewParent', obj_type: 'docx' } } }),
          { status: 200 },
        )
      }
      if (url.includes('/wiki/v2/spaces/') && url.includes('/nodes') && method === 'POST') {
        const id = `docx-${createdDocs.length + 1}`
        createdDocs.push(id)
        return new Response(
          JSON.stringify({ code: 0, data: { node: { obj_token: id, node_token: `wiki-${id}` } } }),
          { status: 200 },
        )
      }
      if (url.includes('blocks/convert')) {
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              first_level_block_ids: ['b1'],
              blocks: [{ block_id: 'b1', block_type: 2 }],
            },
          }),
          { status: 200 },
        )
      }
      if (url.includes('/descendant')) {
        return new Response(JSON.stringify({ code: 0, data: {} }), { status: 200 })
      }
      return new Response(JSON.stringify({ code: -1, msg: `unexpected ${url}` }), { status: 500 })
    }) as typeof fetch
    try {
      const docTask = await createAutomation(root, {
        name: '目录巡检写文档',
        template_id: 'dir-watch-digest',
        cwds: [cwd],
        feishu_doc: { enabled: true, parent_token: 'https://xxx.feishu.cn/wiki/GbrewQpwkiAybBkeT2TcALXonud' },
      })
      const firstDoc = await executeAutomation(root, docTask)
      assert(firstDoc.ok, 'feishu doc execute ok')
      assert(firstDoc.run?.status === 'succeeded', 'job succeeded before feishu')
      assert(firstDoc.run?.feishu_status === 'sent', 'feishu sent')
      assert((firstDoc.run?.feishu_url || '').includes('/wiki/wiki-docx-1'), 'feishu url')
      const secondDoc = await executeAutomation(root, docTask)
      assert(secondDoc.ok, 'second day-like run ok')
      assert(createdDocs.length === 2, 'each run creates a new wiki doc')
      assert(createdDocs[0] !== createdDocs[1], 'new document ids')

      const failTask = await createAutomation(root, {
        name: '写文档失败仍成功',
        template_id: 'dir-watch-digest',
        cwds: [cwd],
        feishu_doc: { enabled: true, parent_token: 'GbrewFailParent' },
      })
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('tenant_access_token')) {
          return new Response(JSON.stringify({ code: 0, tenant_access_token: 't-test', expire: 7200 }), { status: 200 })
        }
        if (url.includes('get_node')) {
          return new Response(JSON.stringify({ code: 1, msg: 'Forbidden' }), { status: 200 })
        }
        return new Response(JSON.stringify({ code: -1, msg: `unexpected ${url}` }), { status: 500 })
      }) as typeof fetch
      const failedDoc = await executeAutomation(root, failTask)
      assert(failedDoc.ok, 'feishu failure does not fail job')
      assert(failedDoc.run?.status === 'succeeded', 'business status clean')
      assert(failedDoc.run?.feishu_status === 'failed', 'feishu marked failed')
      assert(failedDoc.run?.feishu_error, 'feishu error kept')
    } finally {
      globalThis.fetch = origFeishuFetch
      if (prevWbDoc === undefined) delete process.env.WORKBUDDY_CONFIG_YAML
      else process.env.WORKBUDDY_CONFIG_YAML = prevWbDoc
      _resetFeishuTokenCache()
    }

    const skipped = await deliverFeishuDoc({
      automation: created,
      title: 'x',
      summary: '无新文件',
    })
    assert(skipped.feishu_status === 'skipped', 'disabled skip')

    const prevWbYuque = process.env.WORKBUDDY_CONFIG_YAML
    process.env.WORKBUDDY_CONFIG_YAML = '-'
    mkdirSync(join(root, 'credentials'), { recursive: true })
    writeFileSync(
      join(root, 'credentials', 'yuque.cookie'),
      '_yuque_session=sess-secret; yuque_ctoken=csrf-token\n',
      { encoding: 'utf8', mode: 0o600 },
    )
    const yuqueView = yuqueAuthView(root)
    assert(yuqueView.configured && yuqueView.mode === 'cookie' && yuqueView.source === 'file', 'yuque cookie file')
    const cfgView = publicConfigView(loadConfig(root))
    const viewDump = JSON.stringify(cfgView)
    assert(!viewDump.includes('sess-secret'), 'public view no cookie')
    assert(cfgView.yuqueConfigured === true, 'public yuque configured')

    let cookieInBook = false
    try {
      await createAutomation(root, {
        name: 'cookie入任务',
        prompt: '只读汇总目录',
        yuque_doc: { enabled: true, book: '_yuque_session=sess-secret; yuque_ctoken=csrf-token' },
      })
    } catch (e) {
      cookieInBook = String(e).includes('不能写进任务')
    }
    assert(cookieInBook, 'reject cookie in task book')

    const yuqueTask = await createAutomation(root, {
      name: '目录巡检写语雀',
      template_id: 'dir-watch-digest',
      cwds: [cwd],
      yuque_doc: { enabled: true, book: 'https://www.yuque.com/acme/daily' },
    })
    assert(yuqueTask.yuque_doc?.book === 'acme/daily', 'yuque book from url')
    assert(resolveYuqueDocSync(yuqueTask).enabled, 'yuque dest enabled')
    const defDump = JSON.stringify(listAutomations(root))
    assert(!defDump.includes('sess-secret'), 'cookie not in automations.json')

    const captured: { url: string; cookie?: string; csrf?: string; token?: string; method: string }[] = []
    const origYuqueFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = String(init?.method || 'GET').toUpperCase()
      const rawHeaders = init?.headers
      const hdrs = new Headers()
      if (rawHeaders && typeof rawHeaders === 'object' && !Array.isArray(rawHeaders) && !(rawHeaders instanceof Headers)) {
        for (const [k, v] of Object.entries(rawHeaders as Record<string, string>)) {
          if (v != null) hdrs.set(k, String(v))
        }
      } else if (rawHeaders) {
        new Headers(rawHeaders as HeadersInit).forEach((v, k) => hdrs.set(k, v))
      }
      captured.push({
        url,
        method,
        cookie: hdrs.get('Cookie') || undefined,
        csrf: hdrs.get('X-Csrf-Token') || hdrs.get('x-csrf-token') || undefined,
        token: hdrs.get('X-Auth-Token') || undefined,
      })
      if (url.includes('/api/mine/books')) {
        return new Response(
          JSON.stringify({ data: [{ id: 88, slug: 'daily', namespace: 'acme/daily', user: { login: 'acme' } }] }),
          { status: 200 },
        )
      }
      if (url.includes('/api/docs') && method === 'POST') {
        return new Response(JSON.stringify({ data: { id: 501, slug: 'doc-1' } }), { status: 200 })
      }
      if (url.includes('/api/catalog_nodes') && method === 'GET') {
        return new Response(JSON.stringify({ data: [] }), { status: 200 })
      }
      if (url.includes('/api/catalog_nodes') && method === 'PUT') {
        return new Response(
          JSON.stringify({ data: [{ type: 'DOC', title: 't', doc_id: 501, url: 'doc-1' }] }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({ message: `unexpected ${url}` }), { status: 500 })
    }) as typeof fetch
    try {
      const yuqueRun = await executeAutomation(root, yuqueTask)
      assert(yuqueRun.ok, 'yuque execute ok')
      assert(yuqueRun.run?.status === 'succeeded', 'job succeeded before yuque')
      assert(yuqueRun.run?.yuque_status === 'sent', 'yuque sent')
      assert((yuqueRun.run?.yuque_url || '').includes('/acme/daily/doc-1'), 'yuque url')
      assert(captured.some((c) => c.url.includes('/api/docs') && c.method === 'POST'), 'cookie uses web api')
      assert(captured.some((c) => c.url.includes('/api/catalog_nodes') && c.method === 'PUT'), 'cookie appends catalog')
      assert(captured.some((c) => c.cookie && c.cookie.includes('sess-secret')), 'cookie sent')
      assert(captured.some((c) => c.csrf === 'csrf-token'), 'csrf sent')
      assert(captured.every((c) => !c.token), 'no token header')
      const runDump = JSON.stringify(yuqueRun.run)
      assert(!runDump.includes('sess-secret'), 'cookie not in run')

      const failYuque = await createAutomation(root, {
        name: '写语雀失败仍成功',
        template_id: 'dir-watch-digest',
        cwds: [cwd],
        yuque_doc: { enabled: true, book: 'acme/missing' },
      })
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/mine/books')) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 })
        }
        if (url.includes('/api/v2/repos/')) {
          return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })
        }
        return new Response(JSON.stringify({ message: `unexpected ${url}` }), { status: 500 })
      }) as typeof fetch
      const failedYuque = await executeAutomation(root, failYuque)
      assert(failedYuque.ok, 'yuque failure does not fail job')
      assert(failedYuque.run?.status === 'succeeded', 'business status clean after yuque fail')
      assert(failedYuque.run?.yuque_status === 'failed', 'yuque marked failed')
      assert(failedYuque.run?.yuque_error, 'yuque error kept')
    } finally {
      globalThis.fetch = origYuqueFetch
      if (prevWbYuque === undefined) delete process.env.WORKBUDDY_CONFIG_YAML
      else process.env.WORKBUDDY_CONFIG_YAML = prevWbYuque
    }

    const skippedYuque = await deliverYuqueDoc({
      automation: created,
      title: 'x',
      summary: '无新文件',
      dataRoot: root,
    })
    assert(skippedYuque.yuque_status === 'skipped', 'yuque disabled skip')

    const bad = await createAutomation(root, { name: '禁止', prompt: '请提交代码并部署到预发' })
    const denied = await executeAutomation(root, bad)
    assert(!denied.ok, 'forbidden should fail')
    assert(denied.run?.error?.code === 'forbidden_action', 'forbidden code')
    assert(denied.run?.status === 'failed', 'failed not cancelled')

    const removed = await deleteAutomation(root, created.id)
    assert(removed, 'delete def')
    assert(listAutomations(root).every((x) => x.id !== created.id), 'def gone')
    assert(listRuns(root, 1, 50).items.some((r) => r.automation_id === created.id), 'runs kept')

    rmSync(root, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
    console.log('self-test ok')
  })().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
