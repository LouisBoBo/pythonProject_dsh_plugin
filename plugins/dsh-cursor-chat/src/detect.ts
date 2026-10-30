/**
 * 项目感知：根据 workspace 根目录的配置文件自动识别技术栈和可用命令。
 *
 * 仅做读取，不改文件。所有检测结果都是静态扫描。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type ProjectStack = {
  /** 技术栈标签：typescript / node / react / python / java / go / rust / vue / angular / unknown */
  stack: string
  /** 构建命令（数组，按优先级） */
  buildCmds: string[]
  /** 测试命令 */
  testCmds: string[]
  /** 类型检查命令 */
  typecheckCmds: string[]
  /** lint 命令 */
  lintCmds: string[]
  /** 格式化命令 */
  fmtCmds: string[]
  /** 检测到的配置文件 */
  signals: string[]
}

/** 常见可执行文件扩展名 */
const EXE_EXT = ['', '.exe', '.cmd', '.bat', '.sh']

function firstExisting(dir: string, names: string[]): string | null {
  for (const name of names) {
    for (const ext of EXE_EXT) {
      const p = join(dir, name + ext)
      if (existsSync(p)) return p
    }
  }
  return null
}

function fileText(dir: string, name: string): string {
  const p = join(dir, name)
  if (!existsSync(p)) return ''
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return ''
  }
}

function parsePackageJson(dir: string): {
  scripts: Record<string, string>
  deps: string[]
  devDeps: string[]
} {
  const text = fileText(dir, 'package.json')
  if (!text) return { scripts: {}, deps: [], devDeps: [] }
  try {
    const obj = JSON.parse(text) as Record<string, unknown>
    const scripts = ((obj.scripts as Record<string, string>) || {})
    const deps = Object.keys((obj.dependencies as Record<string, unknown>) || {})
    const devDeps = Object.keys((obj.devDependencies as Record<string, unknown>) || {})
    return { scripts, deps, devDeps }
  } catch {
    return { scripts: {}, deps: [], devDeps: [] }
  }
}

/** 主入口：扫描 workspace 根目录，返回感知结果 */
export function detectProject(workspace: string): ProjectStack {
  const result: ProjectStack = {
    stack: 'unknown',
    buildCmds: [],
    testCmds: [],
    typecheckCmds: [],
    lintCmds: [],
    fmtCmds: [],
    signals: [],
  }
  if (!workspace || !existsSync(workspace)) return result

  const { scripts, deps, devDeps } = parsePackageJson(workspace)
  const allDeps = [...deps, ...devDeps]

  // === Node / TypeScript ===
  if (Object.keys(scripts).length || allDeps.some((d) => /^(typescript|react|vue|@angular|vite|webpack|rollup|esbuild|next|nuxt|svelte)$/.test(d))) {
    result.signals.push('package.json')
    result.stack = 'typescript'

    // react / vue / angular / next / nuxt 识别
    if (allDeps.includes('react')) result.stack = 'react'
    else if (allDeps.includes('vue') || allDeps.includes('nuxt')) result.stack = 'vue'
    else if (allDeps.some((d) => d.startsWith('@angular'))) result.stack = 'angular'
    else if (allDeps.includes('next')) result.stack = 'nextjs'

    // tsc --noEmit 类型检查
    if (fileText(workspace, 'tsconfig.json')) {
      result.signals.push('tsconfig.json')
      if (scripts['typecheck']) result.typecheckCmds.push('npm run typecheck')
      else result.typecheckCmds.push('npx tsc --noEmit')
    }

    // 构建
    if (scripts['build']) result.buildCmds.push('npm run build')
    if (scripts['compile']) result.buildCmds.push('npm run compile')
    if (scripts['dist']) result.buildCmds.push('npm run dist')
    // vite / webpack / rollup / esbuild 兜底检测
    if (!result.buildCmds.length && allDeps.some((d) => /^(vite|webpack|rollup|esbuild|@vitejs)/.test(d))) {
      result.buildCmds.push('npx vite build')
    }

    // 测试
    if (scripts['test']) result.testCmds.push('npm test -- --run')
    if (scripts['test:ci']) result.testCmds.push('npm run test:ci')
    if (allDeps.includes('vitest')) result.testCmds.push('npx vitest run')
    if (allDeps.includes('jest')) result.testCmds.push('npx jest --passWithNoTests')

    // lint
    if (scripts['lint']) result.lintCmds.push('npm run lint')
    if (allDeps.includes('eslint')) result.lintCmds.push('npx eslint . --max-warnings 0')

    // prettier
    if (scripts['format'] || scripts['fmt']) result.fmtCmds.push('npm run format')
    if (allDeps.includes('prettier')) result.fmtCmds.push('npx prettier --write .')
  }

  // === Python ===
  if (existsSync(join(workspace, 'requirements.txt')) || existsSync(join(workspace, 'pyproject.toml')) || existsSync(join(workspace, 'setup.py'))) {
    result.signals.push(
      existsSync(join(workspace, 'pyproject.toml')) ? 'pyproject.toml' :
      existsSync(join(workspace, 'requirements.txt')) ? 'requirements.txt' : 'setup.py',
    )
    result.stack = 'python'

    // 检查器
    if (existsSync(join(workspace, 'Makefile')) && /test|lint|check/i.test(fileText(workspace, 'Makefile'))) {
      result.testCmds.push('make test')
      result.lintCmds.push('make lint')
    } else {
      if (existsSync(join(workspace, 'pytest.ini')) || existsSync(join(workspace, 'pyproject.toml'))) {
        result.testCmds.push('python -m pytest -x -q')
      }
      if (fileText(workspace, 'pyproject.toml').includes('[tool.ruff]') || existsSync(join(workspace, '.ruff.toml'))) {
        result.lintCmds.push('ruff check .')
        result.fmtCmds.push('ruff format .')
      } else if (existsSync(join(workspace, '.flake8')) || fileText(workspace, 'pyproject.toml').includes('[tool.flake8]')) {
        result.lintCmds.push('flake8 .')
      }
      result.buildCmds.push('pip install -e .')
    }
  }

  // === Java ===
  if (existsSync(join(workspace, 'pom.xml'))) {
    result.signals.push('pom.xml')
    result.stack = 'java'
    result.buildCmds.push('mvn compile -q')
    result.testCmds.push('mvn test -q')
  } else if (existsSync(join(workspace, 'build.gradle')) || existsSync(join(workspace, 'build.gradle.kts'))) {
    result.signals.push('build.gradle')
    result.stack = 'java'
    result.buildCmds.push('./gradlew compileJava -q')
    result.testCmds.push('./gradlew test -q')
  }

  // === Go ===
  if (existsSync(join(workspace, 'go.mod'))) {
    result.signals.push('go.mod')
    result.stack = 'go'
    result.buildCmds.push('go build ./...')
    result.testCmds.push('go test ./... -count=1')
    result.lintCmds.push('go vet ./...')
    result.fmtCmds.push('gofmt -w .')
  }

  // === Rust ===
  if (existsSync(join(workspace, 'Cargo.toml'))) {
    result.signals.push('Cargo.toml')
    result.stack = 'rust'
    result.buildCmds.push('cargo build -q')
    result.testCmds.push('cargo test -q')
    result.lintCmds.push('cargo clippy -- -D warnings')
    result.fmtCmds.push('cargo fmt')
  }

  // === Makefile 兜底（C/C++ 项目等） ===
  if (existsSync(join(workspace, 'Makefile')) && result.stack === 'unknown') {
    const mk = fileText(workspace, 'Makefile')
    result.signals.push('Makefile')
    result.stack = 'make'
    if (/^test[:\s]/m.test(mk)) result.testCmds.push('make test')
    if (/^build[:\s]/m.test(mk)) result.buildCmds.push('make build')
    if (/^lint[:\s]/m.test(mk)) result.lintCmds.push('make lint')
  }

  return result
}

/** 按优先级返回第一条可用命令（过滤空值） */
export function firstCmd(cmds: string[]): string {
  return (cmds[0] || '').trim()
}

/** 人类可读描述 */
export function describeProject(ps: ProjectStack): string {
  const parts: string[] = [`栈: ${ps.stack}`]
  if (ps.buildCmds.length) parts.push(`build: ${ps.buildCmds[0]}`)
  if (ps.testCmds.length) parts.push(`test: ${ps.testCmds[0]}`)
  if (ps.typecheckCmds.length) parts.push(`typecheck: ${ps.typecheckCmds[0]}`)
  if (ps.lintCmds.length) parts.push(`lint: ${ps.lintCmds[0]}`)
  if (ps.fmtCmds.length) parts.push(`fmt: ${ps.fmtCmds[0]}`)
  if (ps.signals.length) parts.push(`信号: ${ps.signals.join(', ')}`)
  return parts.join(' | ')
}
