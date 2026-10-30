/**
 * diff 质量检查：遍历 Cursor 改完的 changed 文件，
 * 做静态扫描（any 泄漏 / console.log / 敏感文件 / 高危 import 等）。
 *
 * 纯只读，不跑外部命令，10ms 级返回。结果分三档：green / yellow / red。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type QualityIssue = {
  file: string
  line: number
  kind:
    | 'new_any'       // 新增 TypeScript any
    | 'console_log'   // console.log/warn/error 泄漏
    | 'debugger'      // debugger 语句
    | 'sensitive_env' // .env / credentials 文件被改
    | 'test_in_prod'  // 生产代码里残留 test/mock 数据
    | 'dangerous_import' // eval / Function('return this') / child_process
  detail: string
  severity: 'red' | 'yellow'
}

export type QualityReport = {
  status: 'green' | 'yellow' | 'red'
  score: number          // 0-100，100=完美
  issues: QualityIssue[]
  changedFileCount: number
  totalLineCount: number
  summary: string        // 给用户看的单行摘要
}

/** 高危 import / API 模式 */
const DANGEROUS_PATTERNS = [
  { re: /\beval\s*\(/g, kind: 'dangerous_import' as const, detail: 'eval() 调用' },
  { re: /new\s+Function\s*\(/g, kind: 'dangerous_import' as const, detail: 'new Function() 动态执行' },
  { re: /child_process|exec\(|execSync\(|spawn\(/g, kind: 'dangerous_import' as const, detail: 'child_process / exec 命令执行' },
  { re: /require\s*\(\s*['"]fs['"]\s*\)/g, kind: 'dangerous_import' as const, detail: '直接 require("fs")' },
]

const CONSOLE_PATTERNS = [
  /console\.(log|warn|error|info|debug|trace)\s*\(/g,
  /print\s*\(\s*['"][^'"]*\b(debug|test|mock|todo|fixme)\b[^'"]*['"]/gi,
]

/** 敏感文件正则 */
const SENSITIVE_FILE = /(^|\/)(\.env(\.[a-z]+)?|credentials?\.|secret\.|key\.|private\.|\.pem|\.key|\.p12|\.pfx)$/i

/** 生产代码里的 test/mock 残留 */
const TEST_RESIDUE = [
  /\b(mocked|jest\.mock|vi\.mock|mockImplementation|mockReturnValue)\b/gi,
  /^\s*(if|\/\/\s*if)\s*\(__TEST__|process\.env\.NODE_ENV\s*===?\s*['"]test['"]/gm,
]

/** 按扩展名过滤检查 */
function shouldCheckContent(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  return ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'vue'].includes(ext)
}

/** 主入口：扫 diff 里的 changed 文件 */
export function runQualityGate(
  sandbox: string,
  changedFiles: string[],
  deletedFiles: string[] = [],
): QualityReport {
  const issues: QualityIssue[] = []
  let totalLineCount = 0

  for (const rel of changedFiles) {
    const abs = join(sandbox, rel)
    if (!existsSync(abs)) continue

    // 1. 敏感文件被改
    if (SENSITIVE_FILE.test(rel)) {
      issues.push({
        file: rel,
        line: 0,
        kind: 'sensitive_env',
        detail: `敏感文件被修改：${rel}`,
        severity: 'red',
      })
      continue // 敏感文件不再扫内容
    }

    // 2. 跳过非源码
    if (!shouldCheckContent(rel)) continue

    const text = safeRead(abs)
    if (!text) continue
    const lines = text.split('\n')
    totalLineCount += lines.length

    scanAny(rel, lines, issues)
    scanConsoleAndDebugger(rel, lines, issues)
    scanDangerous(rel, text, issues)
    scanTestResidue(rel, lines, issues)
  }

  // 删除的敏感文件
  for (const rel of deletedFiles) {
    if (SENSITIVE_FILE.test(rel)) {
      issues.push({
        file: rel,
        line: 0,
        kind: 'sensitive_env',
        detail: `敏感文件被删除：${rel}（请确认不是误删）`,
        severity: 'yellow',
      })
    }
  }

  return score(issues, changedFiles.length, totalLineCount)
}

function safeRead(path: string): string {
  try {
    const buf = readFileSync(path)
    // 跳过二进制（>0 字节是 null）
    const slice = buf.slice(0, Math.min(4096, buf.length))
    if (slice.includes(0)) return ''
    return buf.toString('utf8')
  } catch {
    return ''
  }
}

/** 扫新增 any：只标"新增"的行——Cursor 新写的 any 才是问题 */
function scanAny(file: string, lines: string[], issues: QualityIssue[]): void {
  // 第一遍：全量 any 位置（简单粗略）
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/\bany\b\s*[^a-zA-Z0-9_]/.test(line) || /:\s*any\b/.test(line)) {
      issues.push({
        file,
        line: i + 1,
        kind: 'new_any',
        detail: `使用了 any 类型：${line.trim().slice(0, 120)}`,
        severity: 'yellow',
      })
    }
  }
}

function scanConsoleAndDebugger(file: string, lines: string[], issues: QualityIssue[]): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // 跳过注释里的
    if (/^\s*\/\//.test(line) || /^\s*\*/.test(line) || /^\s*#/.test(line)) continue

    if (/\bdebugger\s*;?\s*$/.test(line.trim())) {
      issues.push({
        file,
        line: i + 1,
        kind: 'debugger',
        detail: `残留 debugger 语句`,
        severity: 'red',
      })
    }

    for (const pat of CONSOLE_PATTERNS) {
      if (pat.test(line)) {
        issues.push({
          file,
          line: i + 1,
          kind: 'console_log',
          detail: `console 输出残留：${line.trim().slice(0, 120)}`,
          severity: 'yellow',
        })
        break
      }
    }
  }
}

function scanDangerous(file: string, text: string, issues: QualityIssue[]): void {
  for (const pat of DANGEROUS_PATTERNS) {
    const m = pat.re.exec(text)
    if (m) {
      // 找到大致行号
      const before = text.slice(0, m.index)
      const line = before.split('\n').length
      issues.push({
        file,
        line,
        kind: pat.kind,
        detail: pat.detail,
        severity: 'red',
      })
    }
  }
}

function scanTestResidue(file: string, lines: string[], issues: QualityIssue[]): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*\/\/\//.test(line) || /^\s*\*/.test(line) || /^\s*#/.test(line)) continue
    for (const pat of TEST_RESIDUE) {
      if (pat.test(line)) {
        issues.push({
          file,
          line: i + 1,
          kind: 'test_in_prod',
          detail: `生产代码残留 test/mock：${line.trim().slice(0, 120)}`,
          severity: 'yellow',
        })
        break
      }
    }
  }
}

/** 打分 + 汇总 */
function score(
  issues: QualityIssue[],
  changedFileCount: number,
  totalLineCount: number,
): QualityReport {
  const redCount = issues.filter((i) => i.severity === 'red').length
  const yellowCount = issues.filter((i) => i.severity === 'yellow').length

  // 基础分 100，red 扣 20，yellow 扣 5
  const deductions = redCount * 20 + yellowCount * 5
  const score = Math.max(0, 100 - deductions)
  const status: QualityReport['status'] =
    redCount > 0 ? 'red' : yellowCount > 0 ? 'yellow' : 'green'

  const summary =
    status === 'green'
      ? `✅ 质量检查通过（${changedFileCount} 文件，${totalLineCount} 行）`
      : `${status === 'red' ? '❌' : '⚠️'} 发现 ${redCount + yellowCount} 项问题：${redCount} 红 / ${yellowCount} 黄` +
        `（${changedFileCount} 文件，${totalLineCount} 行）`

  return { status, score, issues, changedFileCount, totalLineCount, summary }
}
