import { loadConfig } from './config.js'
import { AutomationError, type Automation } from './types.js'
import { SAFETY_PREFIX } from './safety.js'
import { listDirSafe, listNewerFiles, readFileSafe } from './paths.js'
import { llmConfigured, chatComplete } from './llm.js'

export async function runCustomAgent(automation: Automation, cwd: string | null): Promise<string> {
  const extra: string[] = []
  if (cwd) {
    try {
      extra.push(`【工作目录文件】\n${listDirSafe(cwd).join('\n')}`)
    } catch {
      extra.push('【工作目录】无法列出文件')
    }
  }
  if (!llmConfigured()) {
    if (cwd) {
      const since = automation.last_run_at || automation.created_at || 0
      const newer = listNewerFiles(cwd, since)
      if (!newer.length) return '无新文件（未配置 LLM，仅做目录巡检）。'
      return `未配置 LLM，仅列出新文件：\n${newer.map((f) => `- ${f.path}`).join('\n')}`
    }
    throw new AutomationError('llm_unconfigured', '自定义任务需要配置 LLM，或填写工作目录做只读巡检')
  }
  return chatComplete([
    { role: 'system', content: SAFETY_PREFIX },
    {
      role: 'user',
      content: [automation.prompt, extra.join('\n')].filter(Boolean).join('\n\n'),
    },
  ])
}

export function readSnippet(cwd: string, rel: string): string {
  return readFileSafe(cwd, rel)
}
