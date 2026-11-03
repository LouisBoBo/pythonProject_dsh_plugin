/** 第 8 步：提交 · 只提交本次写码实际落盘的文件。 */

import { lstatSync } from 'node:fs'
import { join } from 'node:path'

import { currentBranch, git, gitRemote, isGitRepo, stagedFiles } from '../exec.js'
import { deltaSinceBaseline, filterScopePaths, sanitizeRelPath } from '../scope.js'
import { diffForReview, scanSecrets } from '../workspace.js'
import type { CommitState, StepContext, StepResult } from '../types.js'
import { fail, pass, skip } from './helpers.js'

const MAX_COMMIT_FILES = 150

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function commitMessage(sc: StepContext): string {
  const what = (sc.epic.prd?.what || sc.run.message || '更新').replace(/\s+/g, ' ').trim()
  const verb = /修复|修正|bug|fix/i.test(what) ? 'fix' : 'feat'
  const title = `${verb}: ${what}`.slice(0, 72)
  return `${title}\n\n由 DSH dev-pipeline ${sc.run.id} 自动生成。`
}

function saveCommit(sc: StepContext, state: CommitState): void {
  sc.epic.artifacts.commit = state
  sc.save()
}

export async function runStep8(sc: StepContext): Promise<StepResult> {
  const ws = sc.epic.workspace
  if (!(await isGitRepo(ws))) {
    saveCommit(sc, {
      sha: '',
      message: '',
      pushed: false,
      files: [],
      soft_skip: true,
      summary: '跳过提交：非 Git 仓库',
    })
    return skip('跳过提交：不是 Git 仓库')
  }

  const impl = sc.epic.artifacts.implement
  if (!impl) {
    return fail(
      '缺少写码账本，拒绝提交工作区全部改动',
      '第 5 步没有产出可核对的改动范围；请重新跑写码，避免把用户原有未提交改动一起提交。',
      { fatal: true },
    )
  }

  const reported = filterScopePaths(ws, [...impl.changed_files, ...impl.deleted_files])
  const baseline = sc.epic.artifacts.scope_baseline
  let candidates: string[] = []
  let ignored: string[] = []

  if (baseline?.git) {
    const delta = await deltaSinceBaseline(ws, baseline, sc.signal)
    const allowed = new Set(reported)
    candidates = delta.all.filter((p) => allowed.has(p))
    ignored = delta.all.filter((p) => !allowed.has(p))
    if (delta.untouched_baseline.length) {
      sc.log(`忽略 ${delta.untouched_baseline.length} 个写码前就存在的脏文件（不属于本次交付）`)
    }
  } else {
    candidates = reported
  }

  candidates = [...new Set(candidates.map((p) => sanitizeRelPath(ws, p)).filter(Boolean))]

  if (baseline?.git) {
    const dirs = candidates.filter((rel) => {
      try {
        const st = lstatSync(join(ws, rel))
        return !st.isFile() && !st.isSymbolicLink()
      } catch {
        return false // 已删除文件不存在，允许提交删除
      }
    })
    if (dirs.length) {
      return fail(
        '插件回传了目录路径，拒绝扩大提交范围',
        `只允许提交具体文件；以下路径是目录：${dirs.slice(0, 10).join('、')}`,
        { evidence: { directories: dirs } },
      )
    }
  }

  if (candidates.length === 0) {
    if (reported.length > 0) {
      return fail(
        '本次写码改动已不存在，无法提交',
        '写码账本记录了改动，但工作区已没有对应变化（可能被回滚或人工覆盖）。',
        { evidence: { reported } },
      )
    }
    saveCommit(sc, {
      sha: '',
      message: '',
      pushed: false,
      files: [],
      soft_skip: true,
      summary: '本次写码没有可提交的实际改动',
    })
    return skip('本次写码没有可提交的实际改动')
  }

  if (candidates.length > MAX_COMMIT_FILES) {
    return fail(
      `本次改动 ${candidates.length} 个文件，超过自动提交上限 ${MAX_COMMIT_FILES}`,
      '请拆分需求或人工分批提交，避免一次提交过大。',
      { fatal: true, evidence: { files: candidates.length } },
    )
  }

  if (ignored.length) {
    sc.log(`有 ${ignored.length} 个写码范围外改动不会提交：${ignored.slice(0, 8).join('、')}`)
  }

  const staleStaged = (await stagedFiles(ws, sc.signal))
    .map((p) => sanitizeRelPath(ws, p))
    .filter((p) => p && !candidates.includes(p))
  if (staleStaged.length) {
    sc.log(
      `暂存区已有 ${staleStaged.length} 个非本次改动；commit --only 会保留它们不提交：${staleStaged
        .slice(0, 8)
        .join('、')}`,
    )
  }

  const diff = await diffForReview(ws, candidates, sc.signal)
  const secrets = scanSecrets(diff)
  if (secrets.length > 0) {
    return fail(`拒绝提交：改动中发现${secrets.join('、')}`, '请删除明文密钥，改用配置或环境变量', {
      evidence: { secrets },
    })
  }

  for (const group of chunk(candidates, 100)) {
    const added = await git(['add', '-A', '--', ...group], ws, { signal: sc.signal })
    if (added.exit_code !== 0) {
      return fail('git add 失败', added.output.slice(0, 2000), { fatal: true })
    }
  }
  const staged = await git(['diff', '--cached', '--quiet', '--', ...candidates], ws, {
    signal: sc.signal,
  })
  if (staged.exit_code === 0) {
    saveCommit(sc, {
      sha: '',
      message: '',
      pushed: false,
      files: candidates,
      soft_skip: true,
      summary: '改动已在暂存区或与 HEAD 一致，无需新提交',
    })
    return skip('没有新的改动需要提交')
  }

  const message = commitMessage(sc)
  // --only 只提交点名的路径；用户原有 staged 改动保持原状，不会被顺手带走。
  const commit = await git(['commit', '--only', '-m', message, '--', ...candidates], ws, {
    signal: sc.signal,
  })
  if (commit.exit_code !== 0) {
    return fail('git commit 失败', commit.output.slice(0, 3000), { fatal: true })
  }
  const head = await git(['rev-parse', 'HEAD'], ws, { signal: sc.signal })
  const sha = head.exit_code === 0 ? head.stdout.trim() : ''
  sc.log(`已提交 ${sha.slice(0, 12)}：${message.split('\n')[0]}（${candidates.length} 个文件）`)

  let pushed = false
  const notes: string[] = []
  if (ignored.length) notes.push(`未提交写码范围外改动 ${ignored.length} 个`)
  if (staleStaged.length) notes.push(`暂存区保留非本次改动 ${staleStaged.length} 个`)
  if (!sc.cfg.push) {
    notes.push('push=false，未推送')
  } else {
    const remote = await gitRemote(ws, sc.signal)
    const branch = await currentBranch(ws, sc.signal)
    if (!remote) {
      notes.push('没有 origin 远端，未推送')
    } else if (!branch || branch === 'HEAD') {
      notes.push('当前处于分离头指针，未推送')
    } else {
      sc.log(`推送 ${branch} → origin`)
      const push = await git(['push', '-u', 'origin', branch], ws, {
        timeoutMs: 5 * 60 * 1000,
        signal: sc.signal,
      })
      if (push.exit_code === 0) {
        pushed = true
      } else {
        saveCommit(sc, {
          sha,
          message,
          pushed: false,
          files: candidates,
          soft_skip: false,
          summary: '提交成功，但推送失败',
        })
        return fail('提交成功，但 git push 失败', push.output.slice(0, 3000), {
          fatal: true,
          evidence: { sha, branch },
        })
      }
    }
  }

  const state: CommitState = {
    sha,
    message,
    pushed,
    files: candidates,
    soft_skip: false,
    summary: `已提交 ${sha.slice(0, 12)}（${candidates.length} 个文件）${pushed ? '并已推送' : ''}`,
  }
  saveCommit(sc, state)
  for (const n of notes) sc.log(n)

  return pass(state.summary, notes.join('\n'), {
    sha,
    pushed,
    files: candidates.length,
    ignored: ignored.length,
    stale_staged: staleStaged.length,
  })
}
