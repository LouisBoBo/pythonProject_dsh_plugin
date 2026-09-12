/**
 * 进度卡写码片断：真实 Cursor edit 事件通常无 new_string，
 * 用「真工程基线 ↔ 沙箱当前」做短 diff；无 diff 时仍展示文件预览片断。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isSensitiveRel, normalizeRel } from './pathScope.js'
import { isWriteToolName, snippetFromTextDiff } from './transcript.js'

const PREVIEW_MAX_LINES = 8
const PREVIEW_MAX_CHARS = 480

function readTextCap(path: string, max = 200_000): string {
  try {
    const buf = readFileSync(path)
    if (buf.length > max) return buf.subarray(0, max).toString('utf8')
    return buf.toString('utf8')
  } catch {
    return ''
  }
}

/** 无可用 diff 时仍给进度卡代码块（取文件尾部非空行） */
export function previewFileSnippet(text: string): string | undefined {
  const lines = String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/g, ''))
  const nonEmpty = lines.filter((l) => l.trim().length > 0)
  if (!nonEmpty.length) return undefined
  const cut = nonEmpty.slice(-PREVIEW_MAX_LINES)
  let out = cut.join('\n')
  if (nonEmpty.length > PREVIEW_MAX_LINES) out = '…\n' + out
  if (out.length > PREVIEW_MAX_CHARS) out = out.slice(-PREVIEW_MAX_CHARS)
  return out
}

/**
 * @param phase running：只锁定基线（只用真工程，禁止读沙箱以免写入后污染）
 * @param phase completed：产出 +/- diff；若无差异则文件预览兜底（保证进度行有代码块）
 */
export function buildLiveEditSnippet(opts: {
  sandbox: string
  workspace: string
  relPath: string
  baseline: Map<string, string>
  phase: 'running' | 'completed'
}): string | undefined {
  const rel = normalizeRel(opts.relPath)
  if (!rel || isSensitiveRel(rel)) return undefined
  const abs = join(opts.sandbox, rel)
  const ws = join(opts.workspace, rel)

  if (opts.phase === 'running') {
    if (!opts.baseline.has(rel)) {
      // 关键：绝不在 running 读沙箱。SDK 常在写入后才发 running，读沙箱会把「改后」当基线 → diff 为空。
      if (existsSync(ws)) opts.baseline.set(rel, readTextCap(ws))
      else opts.baseline.set(rel, '')
    }
    return undefined
  }

  if (!existsSync(abs)) return undefined
  const after = readTextCap(abs)
  let before = opts.baseline.get(rel)
  if (before === undefined) {
    before = existsSync(ws) ? readTextCap(ws) : ''
  }
  const snip = snippetFromTextDiff(before, after)
  opts.baseline.set(rel, after)
  if (snip) return snip
  return previewFileSnippet(after)
}

export function shouldAttachEditSnippet(toolName?: string): boolean {
  return isWriteToolName(toolName)
}
