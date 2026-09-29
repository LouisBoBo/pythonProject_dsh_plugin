import type { Automation } from './types.js'
import { AutomationError } from './types.js'
import { resolveMesSettings } from './config.js'
import { SAFETY_PREFIX } from './safety.js'
import { fetchPcbAiNews, formatNewsSummary } from './news.js'
import { buildWeeklyRepoDigest } from './digest.js'
import { listNewerFiles } from './paths.js'
import { chatComplete, llmConfigured } from './llm.js'
import { runMesDailyBundle, runMesDailyReport } from './mes_report.js'
import { chartsFromMesFacts } from './mes_charts.js'

export async function runNewsPipeline(): Promise<string> {
  const { items, recency } = await fetchPcbAiNews()
  const raw = formatNewsSummary(items, recency)
  if (!llmConfigured()) return raw
  try {
    return await chatComplete([
      {
        role: 'system',
        content:
          SAFETY_PREFIX +
          '只整理已提供的新闻条目，禁止编造链接或事实。没有原文链接时省略来源里的 URL，禁止写「链接：未提供」「无原文链接」。禁止 Markdown（不要 **、#、- 列表）。',
      },
      {
        role: 'user',
        content:
          '请把以下检索结果整理为 3–5 条中文摘要。必须严格使用下面的纯文本结构（字段名只能是「要点」「来源」）：\n\n' +
          '📰 PCB+AI 领域重要新闻摘要（近一周）\n' +
          '以下为检索到的近一周 PCB+AI 领域重要动态，聚焦 AI 算力对 PCB 产业链的驱动（来源为公开资讯，链接为空处为检索结果未提供具体 URL，均已注明发布日期）：\n\n' +
          '1. 标题\n要点：……\n来源：媒体/日期\n\n' +
          '2. 标题\n要点：……\n来源：媒体/日期\n\n' +
          '检索结果：\n\n' +
          raw,
      },
    ])
  } catch {
    return raw
  }
}

export async function runWeeklyPipeline(cwd: string | null): Promise<string> {
  const digest = await buildWeeklyRepoDigest(cwd)
  if (!llmConfigured()) return digest
  try {
    return await chatComplete([
      {
        role: 'system',
        content:
          SAFETY_PREFIX +
          '只根据「本周代码变更依据」归纳。无提交则写「本周仓库暂无新提交」。格式：一、已完成工作；二、进行中事项；三、下周计划。',
      },
      { role: 'user', content: digest },
    ])
  } catch {
    return digest
  }
}

export async function runMesPipeline(): Promise<string> {
  return runMesDailyReport(resolveMesSettings())
}

export async function runMesPipelineBundle(): Promise<{
  summary: string
  yesterday: string
  charts: ReturnType<typeof chartsFromMesFacts>
}> {
  const out = await runMesDailyBundle(resolveMesSettings())
  return { summary: out.summary, yesterday: out.yesterday, charts: chartsFromMesFacts(out.facts) }
}

export async function runDirWatchPipeline(automation: Automation, cwd: string | null): Promise<string> {
  if (!cwd) {
    throw new AutomationError('cwd_invalid', '目录巡检需要填写工作目录')
  }
  const since = automation.last_run_at || Math.floor(Date.now() / 1000) - 24 * 3600
  const files = listNewerFiles(cwd, since)
  if (!files.length) return '无新文件'
  const lines = files.map((f) => {
    const t = new Date(f.mtime * 1000).toLocaleString('zh-CN')
    return `- ${f.path}（${t}）`
  })
  return `目录变更巡检（自 ${new Date(since * 1000).toLocaleString('zh-CN')}）\n${lines.join('\n')}`
}
