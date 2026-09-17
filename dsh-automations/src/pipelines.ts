import type { Automation } from './types.js'
import { AutomationError } from './types.js'
import { loadConfig } from './config.js'
import { SAFETY_PREFIX } from './safety.js'
import { fetchPcbAiNews, formatNewsSummary } from './news.js'
import { buildWeeklyRepoDigest } from './digest.js'
import { listNewerFiles } from './paths.js'
import { chatComplete, llmConfigured } from './llm.js'

export async function runNewsPipeline(): Promise<string> {
  const items = await fetchPcbAiNews()
  const raw = formatNewsSummary(items)
  if (!llmConfigured()) return raw
  try {
    return await chatComplete([
      { role: 'system', content: SAFETY_PREFIX + '只整理已提供的新闻条目，禁止编造链接。' },
      { role: 'user', content: `请把以下检索结果整理为 3–5 条中文摘要（标题、要点、链接）：\n\n${raw}` },
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
  const cfg = loadConfig()
  if (!cfg.mesBaseUrl.trim()) {
    throw new AutomationError(
      'mes_unconfigured',
      '未配置 MES 地址。请到左侧栏「自动化」→ 推送配置填写 MES Base URL；P0 不会编造生产数字。',
    )
  }
  throw new AutomationError(
    'mes_unconfigured',
    '已填写 MES 地址，但本版本尚未接入只读查询协议，拒绝编造日报。请改用自定义任务或等待后续版本。',
  )
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
