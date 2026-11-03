/** 第 9 步：开 PR（GitHub CLI）。 */

import { currentBranch, gitRemote, isGitRepo, runBinary, which } from '../exec.js'
import type { PrState, StepContext, StepResult } from '../types.js'
import { fail, pass, skip } from './helpers.js'

function prBody(sc: StepContext): string {
  const prd = sc.epic.prd
  const lines: string[] = []
  lines.push(`由 DSH dev-pipeline 自动生成（run ${sc.run.id}）。`)
  lines.push('')
  lines.push(`## 需求`)
  lines.push(prd?.what || sc.run.message)
  lines.push('')
  if (prd?.how) {
    lines.push(`## 实现`)
    lines.push(prd.how)
    lines.push('')
  }
  lines.push(`## 验收标准`)
  for (const d of prd?.done || []) lines.push(`- ${d}`)
  lines.push('')
  const validate = sc.epic.artifacts.validate
  if (validate) lines.push(`## 机器验证\n${validate.summary}`)
  const review = sc.epic.artifacts.review
  if (review) lines.push(`\n## 复核\n${review.summary}`)
  return lines.join('\n').slice(0, 6000)
}

export async function runStep9(sc: StepContext): Promise<StepResult> {
  const ws = sc.epic.workspace
  const skipState = (reason: string): StepResult => {
    const state: PrState = { provider: 'skip', url: '', skipped: true, reason }
    sc.epic.artifacts.pr = state
    sc.save()
    return skip(`跳过开 PR：${reason}`)
  }

  if (sc.cfg.prProvider === 'skip') return skipState('配置 prProvider=skip')
  if (!(await isGitRepo(ws))) return skipState('不是 Git 仓库')

  const remote = await gitRemote(ws, sc.signal)
  if (!remote) return skipState('没有 origin 远端')
  if (!/github\.com/i.test(remote)) return skipState('远端不是 GitHub，暂不支持自动开 PR')

  const commit = sc.epic.artifacts.commit
  if (!commit?.sha) return skipState('没有可用的提交')
  if (!commit.pushed) return skipState('提交尚未推送，无法开 PR')

  const branch = await currentBranch(ws, sc.signal)
  if (!branch || branch === 'HEAD') return skipState('分离头指针')
  if (['main', 'master'].includes(branch)) return skipState(`当前在 ${branch} 分支，不自动开 PR`)

  if (!which('gh')) return skipState('未安装 GitHub CLI（gh）')

  const existing = await runBinary(
    'gh',
    ['pr', 'list', '--head', branch, '--json', 'url,number', '--limit', '1'],
    { cwd: ws, timeoutMs: 60_000, signal: sc.signal },
  )
  if (existing.exit_code === 0 && existing.stdout.trim()) {
    try {
      const rows = JSON.parse(existing.stdout) as Array<{ url?: string }>
      const url = String(rows[0]?.url || '').trim()
      if (url) {
        const state: PrState = { provider: 'github', url, skipped: false, reason: 'PR 已存在' }
        sc.epic.artifacts.pr = state
        sc.save()
        return pass(`PR 已存在：${url}`, '', { url })
      }
    } catch {
      /* 落到创建 */
    }
  }

  const title = (sc.epic.prd?.what || sc.run.message || `dev-pipeline ${sc.run.id}`)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 72)
  const created = await runBinary(
    'gh',
    ['pr', 'create', '--title', title, '--body', prBody(sc), '--head', branch],
    { cwd: ws, timeoutMs: 3 * 60 * 1000, signal: sc.signal },
  )
  if (created.exit_code !== 0) {
    return fail('gh pr create 失败', created.output.slice(0, 3000), { fatal: true })
  }
  const url = created.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => /^https?:\/\//.test(s)) || ''
  if (!url) {
    return fail('PR 已创建但未解析到链接', created.output.slice(0, 2000), { fatal: true })
  }

  const state: PrState = { provider: 'github', url, skipped: false, reason: '' }
  sc.epic.artifacts.pr = state
  sc.save()
  sc.log(`PR：${url}`)
  return pass(`已开 PR：${url}`, '', { url })
}
