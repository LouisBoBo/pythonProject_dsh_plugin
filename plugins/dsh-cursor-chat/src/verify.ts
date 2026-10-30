/**
 * 编译验证闭环：Cursor 改完后在沙箱里自动跑 build / typecheck / test，
 * 失败则把错误日志喂回 Cursor 续修一轮（最多两轮，避免死循环）。
 *
 * 仅在沙箱 cwd 执行，不碰真实工程。超时保护 120s/命令。
 */
import { execSync, spawnSync } from 'node:child_process'
import type { ProjectStack } from './detect.js'
import { sandboxSafeEnv } from './sandboxEnv.js'

export type ParsedError = {
  file: string
  line: number
  col?: number
  code?: string
  message: string
}

export type VerifyResult = {
  ok: boolean
  /** 执行过的命令（按顺序） */
  commands: Array<{ cmd: string; ok: boolean; exit: number; output: string; durationMs: number }>
  /** 总计耗时 ms */
  totalMs: number
  /** 首个失败命令的精简日志（给 Cursor 续修用，≤ 4000 字） */
  firstFailureSummary: string
  /** 结构化错误列表（从 output 中解析，tsc/go/pytest/jest 格式） */
  parsedErrors: ParsedError[]
  /** 失败命令类型：build / typecheck / test / '' */
  failureKind: 'build' | 'typecheck' | 'test' | ''
}

const CMD_TIMEOUT_MS = 120_000 // 120 秒 / 命令
const MAX_OUTPUT_LEN = 8_000   // 单条命令输出上限
const SUMMARY_MAX = 4_000      // 给 Cursor 的错误摘要上限

/**
 * 命令安全校验：禁止 shell 元字符（; | & && || $() `），
 * 只允许字母/数字/常见包管理器字符（npx/npm/pip/mvn/go/cargo/make/./脚本 等）。
 * 风险：shell: true 下如果未来 detect.ts 产出恶意命令会被执行。
 */
const ALLOW_CMD = /^[a-zA-Z0-9_.\-/@:=, \[\]()]+$/
export function isSafeCmd(cmd: string): boolean {
  const trimmed = cmd.trim()
  if (!trimmed) return false
  if (trimmed.length > 200) return false // 过长命令可疑
  if (!ALLOW_CMD.test(trimmed)) return false
  // 二次兜底：显式禁止 shell 元字符
  if (/[;|&!${}`\\]/.test(trimmed)) return false
  return true
}

/** 在指定 cwd 跑一条 shell 命令，捕获 stdout+stderr+exit code */
function runOne(cmd: string, cwd: string): { ok: boolean; exit: number; output: string; durationMs: number } {
  const start = Date.now()
  try {
    const result = spawnSync(cmd, [], {
      cwd,
      shell: true,
      timeout: CMD_TIMEOUT_MS,
      encoding: 'utf8',
      env: sandboxSafeEnv({ CI: '1', NODE_ENV: 'test', npm_config_yes: 'true' }),
      maxBuffer: 1024 * 1024 * 16,
    })
    const durationMs = Date.now() - start
    const exit = result.status ?? 1
    const combined = [result.stdout || '', result.stderr || ''].join('\n')
    const output = combined.length > MAX_OUTPUT_LEN
      ? combined.slice(0, MAX_OUTPUT_LEN) + `\n…[truncated ${combined.length - MAX_OUTPUT_LEN} chars]`
      : combined
    return { ok: exit === 0, exit, output, durationMs }
  } catch (err: unknown) {
    const durationMs = Date.now() - start
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    return { ok: false, exit: 1, output: msg, durationMs }
  }
}

/** 主入口：按 build → typecheck → test 顺序跑，第一条失败即停 */
export function verifyInSandbox(cwd: string, ps: ProjectStack): VerifyResult {
  const start = Date.now()
  const commands: VerifyResult['commands'] = []

  const runList: Array<{ kind: 'build' | 'typecheck' | 'test'; cmds: string[] }> = [
    { kind: 'build', cmds: ps.buildCmds },
    { kind: 'typecheck', cmds: ps.typecheckCmds },
    { kind: 'test', cmds: ps.testCmds },
  ]

  let firstFailure: VerifyResult['commands'][number] | null = null
  let failureKind: VerifyResult['failureKind'] = ''

  for (const { kind, cmds } of runList) {
    for (const cmd of cmds) {
      if (!isSafeCmd(cmd)) {
        // 跳过不安全命令，继续下一个
        commands.push({ cmd, ok: false, exit: 1, output: `[blocked] 命令安全校验未通过：${cmd.slice(0, 80)}`, durationMs: 0 })
        if (!firstFailure) {
          firstFailure = commands[commands.length - 1]
          failureKind = kind
        }
        return buildResult(false, commands, Date.now() - start, firstFailure, failureKind)
      }
      const r = runOne(cmd, cwd)
      commands.push({ cmd, ...r })
      if (!r.ok) {
        if (!firstFailure) {
          firstFailure = commands[commands.length - 1]
          failureKind = kind
        }
        // 第一条失败即停：build 没过就不跑 test
        return buildResult(false, commands, Date.now() - start, firstFailure, failureKind)
      }
    }
  }

  return buildResult(true, commands, Date.now() - start, null, '')
}

function buildResult(
  ok: boolean,
  commands: VerifyResult['commands'],
  totalMs: number,
  firstFailure: VerifyResult['commands'][number] | null,
  failureKind: VerifyResult['failureKind'],
): VerifyResult {
  let summary = ''
  let parsedErrors: ParsedError[] = []
  if (!ok && firstFailure) {
    // 解析结构化错误列表（优先给 Cursor 用）
    parsedErrors = parseErrorsFromOutput(firstFailure.output)

    // 精简：取最后 3500 字符（错误通常在末尾）+ 命令行 + exit code
    const tail = firstFailure.output.length > SUMMARY_MAX
      ? firstFailure.output.slice(-SUMMARY_MAX)
      : firstFailure.output
    summary =
      `[verify 失败] kind=${failureKind} cmd=${firstFailure.cmd}\n` +
      `exit=${firstFailure.exit} duration=${firstFailure.durationMs}ms\n` +
      `---\n${tail}`
  }
  return { ok, commands, totalMs, firstFailureSummary: summary, parsedErrors, failureKind }
}

/**
 * 从命令输出中解析结构化错误，支持：
 *   - tsc:   src/x.ts(42,10): error TS2345: 不能将类型...
 *   - go:    src/main.go:42: undefined: Foo
 *   - py:    src/m.py:15:  [pytest] FAILED 或 SyntaxError: name 'x' is not defined
 *   - jest:  FAIL src/my.test.ts  ✕ should do xxx
 * 同一行可能匹配多个 pattern，取第一个命中的。
 */
export function parseErrorsFromOutput(output: string): ParsedError[] {
  const errs: ParsedError[] = []
  if (!output) return errs
  const lines = output.split('\n')
  const seen = new Set<string>()

  for (const line of lines) {
    let m: RegExpMatchArray | null

    // tsc: src/x.ts(42,10): error TS2345: 不能将类型 'string' 分配给 'number'
    m = line.match(/^([^\s(]+\.\w+)\((\d+)(?:,(\d+))?\):\s*(error|warning)\s+(\w+):\s*(.+)$/)
    if (m) {
      const key = `${m[1]}:${m[2]}:${m[5]}`
      if (!seen.has(key)) { seen.add(key); errs.push({ file: m[1], line: Number(m[2]), col: m[3] ? Number(m[3]) : undefined, code: m[5], message: m[6]!.trim() }) }
      continue
    }

    // go: src/main.go:42:10: undefined: Foo  或  src/main.go:42: 语法错误
    m = line.match(/^([^\s:]+\.\w+):(\d+)(?::(\d+))?:\s*(.+)$/)
    if (m && /error|undefined|cannot|not enough|missing|expected|invalid|panic/.test(m[4] || '')) {
      const key = `${m[1]}:${m[2]}:${m[4]?.slice(0, 30)}`
      if (!seen.has(key)) { seen.add(key); errs.push({ file: m[1], line: Number(m[2]), col: m[3] ? Number(m[3]) : undefined, message: m[4]!.trim() }) }
      continue
    }

    // python traceback 最后一行：File "src/m.py", line 15, in <module>
    m = line.match(/^[A-Z]\w+Error:\s*(.+)$/)
    if (m) {
      // 往前找最近一行 File "xxx", line N
      const idx = lines.indexOf(line)
      let pyFile = '', pyLine = 0
      for (let i = Math.max(0, idx - 8); i < idx; i++) {
        const fm = lines[i].match(/File\s+["']([^"']+)["'],\s+line\s+(\d+)/)
        if (fm) { pyFile = fm[1]; pyLine = Number(fm[2]) }
      }
      if (pyFile && pyLine) {
        const key = `${pyFile}:${pyLine}:${m[1]?.slice(0, 30)}`
        if (!seen.has(key)) { seen.add(key); errs.push({ file: pyFile, line: pyLine, message: m[1]!.trim() }) }
      }
      continue
    }

    // pytest/vitest FAIL 行
    m = line.match(/^FAIL\s+([^\s]+\.\w+)/)
    if (m) {
      const key = `fail:${m[1]}`
      if (!seen.has(key)) { seen.add(key); errs.push({ file: m[1], line: 0, message: '测试失败（详情见上方日志）' }) }
      continue
    }

    // jest/vitest ✕ 行：  ✕ should work (2ms)
    m = line.match(/✕\s+(.+?)\s*\(/)
    if (m) {
      const key = `fail:${m[1]}`
      if (!seen.has(key)) { seen.add(key); errs.push({ file: '<test>', line: 0, message: `测试失败: ${m[1]?.trim()}` }) }
      continue
    }
  }

  return errs.slice(0, 20) // 最多 20 条，避免过长
}

/** 构建给 Cursor 续修用的追加 prompt（失败时喂回去） */
export function buildVerifyHints(verify: VerifyResult): string {
  if (verify.ok) return ''
  const cmds = verify.commands.map((c) => `${c.ok ? '✅' : '❌'} ${c.cmd} (exit=${c.exit}, ${c.durationMs}ms)`).join('\n')

  // 结构化错误优先——让 Cursor 直接知道哪个文件哪一行错了
  let structuredBlock = ''
  if (verify.parsedErrors.length) {
    const grouped = new Map<string, ParsedError[]>()
    for (const e of verify.parsedErrors) {
      const arr = grouped.get(e.file) || []
      arr.push(e)
      grouped.set(e.file, arr)
    }
    structuredBlock = `\n【结构化错误（优先看这个）】\n`
    for (const [file, errs] of grouped) {
      structuredBlock += `\n${file}:\n`
      for (const e of errs) {
        const loc = e.line > 0 ? `  L${e.line}${e.col ? `:${e.col}` : ''}` : '  L?'
        const code = e.code ? ` [${e.code}]` : ''
        structuredBlock += `${loc}${code} ${e.message}\n`
      }
    }
    if (verify.parsedErrors.length > 15) {
      structuredBlock += `\n…共解析 ${verify.parsedErrors.length} 条错误，以上是前 15 条\n`
    }
  }

  const rawBlock = verify.parsedErrors.length
    ? `\n【原始日志（仅供参考，以结构化错误为准）】\n${verify.firstFailureSummary}`
    : `\n【原始日志】\n${verify.firstFailureSummary}`

  return (
    `\n【编译/测试验证失败，请在现有改动上续修一轮】\n` +
    `本轮已自动跑以下命令（沙箱 cwd）：\n${cmds}\n` +
    structuredBlock +
    rawBlock +
    `\n\n请按结构化错误定位根因、精准修代码。修完后我会再跑一次验证。\n`
  )
}

/** 跳过验证的原因（环境变量或项目无可用命令） */
export function shouldSkipVerify(ps: ProjectStack): string {
  const raw = String(process.env.CURSOR_CHAT_SKIP_VERIFY || '').trim().toLowerCase()
  if (raw === '1' || raw === 'true' || raw === 'off' || raw === 'no') {
    return 'CURSOR_CHAT_SKIP_VERIFY=1'
  }
  const hasCmd = ps.buildCmds.length || ps.typecheckCmds.length || ps.testCmds.length
  if (!hasCmd) return `无可验证命令（stack=${ps.stack}）`
  return ''
}
