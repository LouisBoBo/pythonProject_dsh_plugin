import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const execFileP = promisify(execFile)

async function git(cwd: string, args: string[], timeout = 20_000): Promise<{ code: number; out: string }> {
  try {
    const { stdout, stderr } = await execFileP('git', args, {
      cwd,
      timeout,
      maxBuffer: 1024 * 1024,
    })
    return { code: 0, out: String(stdout || stderr || '').trim() }
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string }
    return { code: typeof e.code === 'number' ? e.code : 1, out: String(e.stdout || e.stderr || '').trim() }
  }
}

function mondayIso(now = new Date()): string {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  const day = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - day)
  return d.toISOString().slice(0, 10)
}

export async function buildWeeklyRepoDigest(cwd?: string | null): Promise<string> {
  const root = cwd ? resolve(cwd) : ''
  if (!root || !existsSync(root)) {
    return '【本周代码变更依据】\n未配置有效工作目录（cwd）。请在任务中填写 git 仓库路径。本周已完成工作请写「暂无代码依据」，勿编造功能。\n'
  }
  const inside = await git(root, ['rev-parse', '--is-inside-work-tree'])
  if (inside.code !== 0 || !inside.out.includes('true')) {
    return '【本周代码变更依据】\n该目录不是 git 仓库。本周已完成工作请写「暂无代码依据」，勿编造功能。\n'
  }
  const since = mondayIso()
  const log = await git(root, [
    'log',
    `--since=${since}`,
    '--pretty=format:%h %ad %s',
    '--date=short',
    '-n',
    '40',
  ])
  const stat = await git(root, ['diff', '--stat', `${since}..HEAD`])
  const dirty = await git(root, ['status', '--porcelain'])
  const commits = log.out.trim() || '（本周无新提交）'
  const files = stat.out.trim() || '（无 diffstat）'
  const uncommitted = dirty.out.trim()
    ? `工作区未提交变更：\n${dirty.out.split('\n').slice(0, 30).join('\n')}`
    : '工作区干净'
  return [
    '【本周代码变更依据】（只读 git，未执行 commit）',
    `统计起点：${since}（本周一）`,
    '',
    '提交：',
    commits,
    '',
    '文件变更：',
    files.slice(0, 4000),
    '',
    uncommitted,
  ].join('\n')
}
