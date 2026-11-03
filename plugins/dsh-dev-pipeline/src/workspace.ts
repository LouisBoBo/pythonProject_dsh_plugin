/** 工程目录：路径校验、项目画像、验证命令探测、变更 diff。 */

import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, resolve, sep } from 'node:path'

import { expandHome } from './config.js'
import { git, gitStatus, which } from './exec.js'
import type { ContextPack, FileSnippet } from './types.js'

const IGNORE_DIRS = new Set([
  '.git',
  '.svn',
  'node_modules',
  '.pnpm-store',
  'dist',
  'build',
  'out',
  'target',
  'vendor',
  '.venv',
  'venv',
  '__pycache__',
  '.idea',
  '.vscode',
  'coverage',
  '.next',
  '.nuxt',
  '.cache',
])

const KEY_FILES = [
  'AGENTS.md',
  'README.md',
  'README.zh.md',
  'package.json',
  'pnpm-workspace.yaml',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'go.mod',
  'pyproject.toml',
  'requirements.txt',
  'Cargo.toml',
  'Makefile',
  'docker-compose.yml',
  'compose.yml',
]

const READ_MAX = 8_000
const PACK_MAX = 48_000

export function normalizeWorkspace(value: string): string {
  const expanded = expandHome(String(value || '').trim())
  if (!expanded) throw new Error('缺少 workspace')
  const abs = isAbsolute(expanded) ? resolve(expanded) : resolve(process.cwd(), expanded)
  if (!existsSync(abs)) throw new Error(`工程目录不存在：${abs}`)
  if (!statSync(abs).isDirectory()) throw new Error(`不是目录：${abs}`)
  if (abs === sep || abs === resolve(homedir())) {
    throw new Error(`拒绝把 ${abs} 当工程目录；请在侧栏打开具体项目`)
  }
  return abs
}

export function insideWorkspace(workspace: string, file: string): boolean {
  const abs = resolve(workspace, file)
  const root = resolve(workspace)
  return abs === root || abs.startsWith(`${root}${sep}`)
}

function safeRead(path: string, max = READ_MAX): string {
  try {
    if (!existsSync(path)) return ''
    const st = statSync(path)
    if (!st.isFile() || st.size > 2_000_000) return ''
    const buf = readFileSync(path)
    if (buf.includes(0)) return ''
    return buf.toString('utf8').slice(0, max)
  } catch {
    return ''
  }
}

/** 关键文件可能是指向工程外的符号链接，读之前按真实路径确认仍在工程内。 */
function insideRealRoot(root: string, path: string): boolean {
  try {
    const real = realpathSync(path)
    return real === root || real.startsWith(`${root}${sep}`)
  } catch {
    return false
  }
}

function topDirs(workspace: string, limit = 30): string[] {
  try {
    return readdirSync(workspace, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !IGNORE_DIRS.has(d.name) && !d.name.startsWith('.'))
      .map((d) => d.name)
      .slice(0, limit)
  } catch {
    return []
  }
}

function detectStack(workspace: string): string[] {
  const has = (name: string) => existsSync(join(workspace, name))
  const stack: string[] = []
  if (has('package.json')) stack.push('node')
  if (has('pnpm-lock.yaml')) stack.push('pnpm')
  else if (has('yarn.lock')) stack.push('yarn')
  else if (has('package-lock.json')) stack.push('npm')
  if (has('pom.xml')) stack.push('maven')
  if (has('build.gradle') || has('build.gradle.kts')) stack.push('gradle')
  if (has('go.mod')) stack.push('go')
  if (has('pyproject.toml') || has('requirements.txt') || has('setup.py')) stack.push('python')
  if (has('Cargo.toml')) stack.push('rust')
  if (has('package.json') && existsSync(join(workspace, 'src', 'main.ts'))) stack.push('typescript')
  return stack
}

function packageScripts(workspace: string): Record<string, string> {
  try {
    const raw = JSON.parse(readFileSync(join(workspace, 'package.json'), 'utf8'))
    const scripts = raw && typeof raw.scripts === 'object' ? raw.scripts : {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(scripts)) out[k] = String(v)
    return out
  } catch {
    return {}
  }
}

export function detectValidationCommands(workspace: string): string[] {
  const out: string[] = []
  const stack = detectStack(workspace)
  const scripts = packageScripts(workspace)

  if (stack.includes('node')) {
    const runner = stack.includes('pnpm') ? 'pnpm' : stack.includes('yarn') ? 'yarn' : 'npm'
    if (which(runner)) {
      for (const name of ['test', 'typecheck', 'lint']) {
        if (scripts[name]) out.push(`${runner} run ${name}`)
      }
    }
  }
  if (stack.includes('maven') && which('mvn')) out.push('mvn -q test')
  if (stack.includes('gradle') && which('gradle')) out.push('gradle test --console=plain')
  if (stack.includes('go') && which('go')) out.push('go test ./...')
  if (stack.includes('python')) {
    const hasTests =
      existsSync(join(workspace, 'tests')) ||
      existsSync(join(workspace, 'test')) ||
      existsSync(join(workspace, 'pytest.ini'))
    if (hasTests && which('python3')) out.push('python3 -m pytest -q')
    else if (hasTests && which('python')) out.push('python -m pytest -q')
  }
  if (stack.includes('rust') && which('cargo')) out.push('cargo test --quiet')
  return [...new Set(out)].slice(0, 5)
}

export function profileWorkspace(workspace: string): ContextPack {
  const keyFiles: FileSnippet[] = []
  const root = realpathSync(workspace)
  let total = 0
  for (const name of KEY_FILES) {
    const path = join(workspace, name)
    if (!insideRealRoot(root, path)) continue
    const text = safeRead(path)
    if (!text) continue
    const snippet = text.slice(0, READ_MAX)
    if (total + snippet.length > PACK_MAX) break
    total += snippet.length
    keyFiles.push({ path: name, bytes: Buffer.byteLength(text), excerpt: snippet })
  }

  const dirs = topDirs(workspace)
  const stack = detectStack(workspace)
  const mustRead = keyFiles
    .map((f) => f.path)
    .filter((p) => p === 'AGENTS.md' || p.startsWith('README') || p === 'package.json')
    .slice(0, 4)

  const risks: string[] = []
  if (!existsSync(join(workspace, 'AGENTS.md'))) risks.push('缺少 AGENTS.md，工程约定需自行确认')
  if (!existsSync(join(workspace, '.git'))) risks.push('不是 Git 仓库，第 6～9 步将跳过或受限')
  if (dirs.length === 0) risks.push('顶层未发现源码目录')
  if (stack.length === 0) risks.push('未识别到常见技术栈，验证命令可能为空')
  if (keyFiles.length === 0) risks.push('未读到关键配置文件')

  const summary =
    `目录 ${basename(workspace)}；栈：${stack.join(' / ') || '未识别'}；` +
    `顶层目录 ${dirs.slice(0, 8).join('、') || '无'}；关键文件 ${keyFiles.length} 个`

  return {
    summary,
    dirs,
    stack,
    key_files: keyFiles,
    must_read: mustRead,
    risks,
    created_at: new Date().toISOString(),
  }
}

export interface ChangedFile {
  path: string
  code: string
}

export async function changedFiles(
  workspace: string,
  signal?: AbortSignal,
): Promise<ChangedFile[]> {
  const rows = await gitStatus(workspace, signal)
  return rows
    .filter((r) => insideWorkspace(workspace, r.path))
    .map((r) => ({ path: r.path, code: r.code }))
}

export async function diffForReview(
  workspace: string,
  files: string[],
  signal?: AbortSignal,
): Promise<string> {
  if (files.length === 0) return ''
  const chunks: string[] = []
  let total = 0
  const max = 160_000

  const tracked = await git(['ls-files', '--', ...files], workspace, { signal })
  const trackedSet = new Set(
    tracked.exit_code === 0 ? tracked.stdout.split(/\r?\n/).filter(Boolean) : [],
  )

  for (const file of files) {
    if (!insideWorkspace(workspace, file)) continue
    if (total >= max) break
    if (trackedSet.has(file)) {
      const d = await git(['diff', '--no-color', '--unified=3', '--', file], workspace, {
        signal,
      })
      if (d.exit_code === 0 && d.stdout.trim()) {
        chunks.push(`### ${file}\n${d.stdout}`)
        total += d.stdout.length
      }
      continue
    }
    const abs = join(workspace, file)
    try {
      if (!existsSync(abs) || !lstatSync(abs).isFile()) continue
      const text = safeRead(abs, 40_000)
      if (!text) continue
      chunks.push(`### ${file}（新增/未跟踪）\n${text}`)
      total += text.length
    } catch {
      /* skip */
    }
  }
  return chunks.join('\n\n').slice(0, max)
}

const SECRET_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, label: '私钥内容' },
  { re: /\b(?:sk|pk|ghp|glpat|xox[baprs])[-_][A-Za-z0-9_-]{16,}\b/, label: '疑似 API Token' },
  {
    re: /\b(?:api[_-]?key|secret|password|passwd|access[_-]?token)\b\s*[:=]\s*['"][^'"]{12,}['"]/i,
    label: '疑似明文密钥赋值',
  },
]

export function scanSecrets(text: string): string[] {
  const found: string[] = []
  for (const { re, label } of SECRET_PATTERNS) {
    if (re.test(text)) found.push(label)
  }
  return [...new Set(found)]
}

/** 把常见凭据替换成占位符，避免验证/部署日志把密钥带进会话与账本。 */
export function redactSecrets(text: string): string {
  return String(text || '')
    .replace(
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
      '[REDACTED PRIVATE KEY]',
    )
    .replace(/\b(?:sk|pk|ghp|glpat|xox[baprs])[-_][A-Za-z0-9_-]{16,}\b/g, '[REDACTED TOKEN]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]{16,}=*/gi, '$1[REDACTED]')
    .replace(
      /(\b(?:api[_-]?key|secret|password|passwd|access[_-]?token)\b\s*[:=]\s*['"])[^'"]{12,}(['"])/gi,
      '$1[REDACTED]$2',
    )
}
