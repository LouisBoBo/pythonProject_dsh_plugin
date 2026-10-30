/**
 * 跨 session 用户偏好持久化。
 * 存 dataRoot/preferences.json，让插件记住：
 *   - 用户默认用什么 model
 *   - 每个项目的技术栈 + 常用命令（detect.ts 自动识别的，不覆盖用户手动设的）
 *   - 可选风格 hint（比如"偏好中文注释、prettier single quote"）
 *
 * 注入时机：buildPrompt 时拼进 userPreface，让 Cursor 知道用户偏好。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ProjectStack } from './detect.js'
import type { ParsedError } from './verify.js'

export type FailureEntry = {
  /** 错误签名（去噪后的特征，如 TS2345 / undefined: Foo / @types/node missing） */
  signature: string
  /** 分类 */
  kind: 'typecheck' | 'build' | 'test' | 'verify' | 'unknown'
  /** 出现次数 */
  count: number
  /** 最近一次看到的时间 */
  last_seen: string
  /** 典型错误消息（取最近 1 次） */
  sample?: string
}

export type Preferences = {
  default_model?: string
  /** workspace 绝对路径 → 检测到的技术栈 */
  stack_memory: Record<string, string>
  /** workspace 绝对路径 → 常用命令（test/fmt/lint，不覆盖用户已有值） */
  cmd_memory: Record<string, { test?: string; fmt?: string; lint?: string }>
  /** 可选风格 hint，用户手动写进 config 的，随 prompt 注入 Cursor */
  style_hints?: string
  /** workspace → 常见失败签名（让 Cursor 下次提前注意） */
  failure_memory: Record<string, FailureEntry[]>
  updated_at?: string
}

const EMPTY_PREFS: Preferences = {
  stack_memory: {},
  cmd_memory: {},
  failure_memory: {},
}

function prefsPath(dataRoot: string): string {
  return join(dataRoot, 'preferences.json')
}

export function loadPreferences(dataRoot: string): Preferences {
  const p = prefsPath(dataRoot)
  if (!existsSync(p)) return { ...EMPTY_PREFS }
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Partial<Preferences>
    return {
      default_model: raw.default_model,
      stack_memory: raw.stack_memory || {},
      cmd_memory: raw.cmd_memory || {},
      style_hints: raw.style_hints,
      failure_memory: raw.failure_memory || {},
      updated_at: raw.updated_at,
    }
  } catch {
    return { ...EMPTY_PREFS }
  }
}

export function savePreferences(dataRoot: string, prefs: Preferences): void {
  mkdirSync(dataRoot, { recursive: true })
  prefs.updated_at = new Date().toISOString()
  writeFileSync(prefsPath(dataRoot), JSON.stringify(prefs, null, 2), 'utf8')
}

/** 只追加检测结果，不覆盖已有值（用户手动设的优先级更高） */
export function rememberProjectStack(dataRoot: string, workspace: string, ps: ProjectStack): Preferences {
  const prefs = loadPreferences(dataRoot)
  let changed = false

  const key = workspace
  // stack：如果之前不知道或者是 unknown，更新
  if (!prefs.stack_memory[key] || prefs.stack_memory[key] === 'unknown') {
    if (ps.stack && ps.stack !== 'unknown') {
      prefs.stack_memory[key] = ps.stack
      changed = true
    }
  }

  // cmd_memory：只在用户没手动设过的情况下写检测值
  if (!prefs.cmd_memory[key]) prefs.cmd_memory[key] = {}
  const cmds = prefs.cmd_memory[key]!
  if (!cmds.test && ps.testCmds[0]) { cmds.test = ps.testCmds[0]; changed = true }
  if (!cmds.fmt && ps.fmtCmds[0]) { cmds.fmt = ps.fmtCmds[0]; changed = true }
  if (!cmds.lint && ps.lintCmds[0]) { cmds.lint = ps.lintCmds[0]; changed = true }

  if (changed) savePreferences(dataRoot, prefs)
  return prefs
}

/** 用户显式选了 model（比如 config 改了），记下来 */
export function rememberModel(dataRoot: string, model: string): Preferences {
  const prefs = loadPreferences(dataRoot)
  if (prefs.default_model !== model) {
    prefs.default_model = model
    savePreferences(dataRoot, prefs)
  }
  return prefs
}

/** 把 verify 失败记录下来，下次同项目跑时提前 inject hint */
export function recordFailures(
  dataRoot: string,
  workspace: string,
  parsed: ParsedError[],
  kind: FailureEntry['kind'],
): Preferences {
  if (!parsed.length) return loadPreferences(dataRoot)
  const prefs = loadPreferences(dataRoot)
  const arr = prefs.failure_memory[workspace] || []
  const now = new Date().toISOString()

  for (const err of parsed) {
    // 错误签名：用 error code（TS2345） 或 首行类型/错误描述去噪
    const sig = err.code
      ? err.code
      : err.message.split('：')[0].split(':')[0].slice(0, 40)
    const existing = arr.find((e) => e.signature === sig)
    if (existing) {
      existing.count += 1
      existing.last_seen = now
      if (err.message) existing.sample = err.message
    } else {
      arr.push({ signature: sig, kind, count: 1, last_seen: now, sample: err.message })
    }
  }

  // 最多保留 30 条，按 count * 新近度排序，去掉冷门的
  arr.sort((a, b) => {
    const aRecency = a.count / Math.max(1, (Date.now() - new Date(a.last_seen).getTime()) / 86400000)
    const bRecency = b.count / Math.max(1, (Date.now() - new Date(b.last_seen).getTime()) / 86400000)
    return bRecency - aRecency
  })
  prefs.failure_memory[workspace] = arr.slice(0, 30)
  savePreferences(dataRoot, prefs)
  return prefs
}

/** 把偏好拼成 Cursor prompt 里的"用户偏好"段落 */
export function formatPrefsForPrompt(prefs: Preferences, workspace?: string): string {
  const lines: string[] = []

  if (prefs.default_model) {
    lines.push(`- 用户偏好模型：${prefs.default_model}`)
  }

  if (workspace) {
    const stack = prefs.stack_memory[workspace]
    const cmds = prefs.cmd_memory[workspace]
    if (stack) {
      lines.push(`- 本项目技术栈：${stack}`)
    }
    if (cmds) {
      const parts: string[] = []
      if (cmds.test) parts.push(`测试=${cmds.test}`)
      if (cmds.fmt) parts.push(`格式化=${cmds.fmt}`)
      if (cmds.lint) parts.push(`lint=${cmds.lint}`)
      if (parts.length) lines.push(`- 本项目常用命令：${parts.join('；')}`)
    }

    // 常见失败记忆（Top 3，避免过长）——让 Cursor 提前注意
    const fails = prefs.failure_memory[workspace]?.filter((f) => f.count >= 1).slice(0, 3)
    if (fails?.length) {
      const hints = fails.map((f) => {
        const sample = f.sample ? `：${f.sample.slice(0, 60)}` : ''
        return `  · ${f.signature}（见过 ${f.count} 次）${sample}`
      }).join('\n')
      lines.push(`- ⚠️ 本项目历史上常见验证失败，改代码时注意规避：\n${hints}`)
    }
  }

  if (prefs.style_hints && prefs.style_hints.trim()) {
    lines.push(`- 代码风格偏好：${prefs.style_hints.trim()}`)
  }

  if (!lines.length) return ''
  return `\n【用户偏好（自动记忆）】\n${lines.join('\n')}\n`
}
