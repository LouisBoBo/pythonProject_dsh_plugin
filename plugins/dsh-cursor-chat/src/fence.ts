/**
 * 解析 :::cursor_dev_options / :::cursor_dev_propose 机器块（围栏语法）。
 * 从 Python mom fence.py 移植。
 *
 * Cursor 在终稿里可能注入围栏 JSON 块：
 *   :::cursor_dev_options
 *   {"title": "...", "choices": [...]}
 *   :::
 *   或 :::cursor_dev_propose ... :::
 *
 * 前端进度卡需要把这些 JSON 卡片从 prose 中剥离出来单独渲染。
 */

const OPT_RE = /:::cursor_dev_options\b/i
const PROP_RE = /:::cursor_dev_propose\b/i

function extractFence(
  text: string,
  kind: 'options' | 'propose',
): { before: string; body: string; after: string } | null {
  const startRe = kind === 'options' ? OPT_RE : PROP_RE
  const m = startRe.exec(text)
  if (!m) return null
  const start = m.index
  const afterTag = text.slice(m.index + m[0].length)
  const bodyBegin = afterTag.length - afterTag.trimStart().length
  const bodyAndRest = afterTag.slice(bodyBegin)
  // 找关闭 :::
  const closeRe = /\n[ \t]*:::[ \t]*(?:\n|$)/
  const close = closeRe.exec(bodyAndRest)
  let body: string, end: number
  if (close) {
    body = bodyAndRest.slice(0, close.index).trim()
    end = m.index + m[0].length + bodyBegin + close.index + close[0].length
  } else {
    // 没有显式关闭，截到末尾
    body = bodyAndRest.replace(/\n?[ \t]*:::[ \t]*\s*$/, '').trim()
    end = text.length
  }
  return {
    before: text.slice(0, start).trim(),
    body,
    after: text.slice(end).trim(),
  }
}

function loadsLoose(body: string): Record<string, unknown> | null {
  const raw = String(body || '').trim()
  if (!raw) return null
  try {
    const obj = JSON.parse(raw)
    return typeof obj === 'object' && obj !== null && !Array.isArray(obj)
      ? (obj as Record<string, unknown>)
      : null
  } catch {
    // 尝试截取首尾花括号
    const a = raw.indexOf('{')
    const b = raw.lastIndexOf('}')
    if (a >= 0 && b > a) {
      try {
        const obj = JSON.parse(raw.slice(a, b + 1))
        return typeof obj === 'object' && obj !== null && !Array.isArray(obj)
          ? (obj as Record<string, unknown>)
          : null
      } catch { return null }
    }
    return null
  }
}

export type MachineBlocks = {
  prose: string
  options: Record<string, unknown> | null
  propose: Record<string, unknown> | null
}

/**
 * 返回 { prose, options, propose }。
 * 同一轮若同时出现 options 和 propose，优先 options（前端只展示一张）。
 */
export function parseMachineBlocks(text: string): MachineBlocks {
  const s = String(text || '')
  let options: Record<string, unknown> | null = null
  let propose: Record<string, unknown> | null = null
  const proseParts: string[] = []

  const opt = extractFence(s, 'options')
  const prop = extractFence(s, 'propose')

  if (opt && prop) {
    // 保留较早出现的那一类
    const optIdx = s.search(OPT_RE)
    const propIdx = s.search(PROP_RE)
    if (optIdx <= propIdx) {
      options = loadsLoose(opt.body)
      proseParts.push(opt.before, opt.after)
      // 去掉 prop 段避免泄漏
      const prop2 = extractFence([opt.before, opt.after].join('\n'), 'propose')
      if (prop2) proseParts.splice(0, proseParts.length, prop2.before, prop2.after)
    } else {
      propose = loadsLoose(prop.body)
      proseParts.push(prop.before, prop.after)
    }
  } else if (opt) {
    options = loadsLoose(opt.body)
    proseParts.push(opt.before, opt.after)
  } else if (prop) {
    propose = loadsLoose(prop.body)
    proseParts.push(prop.before, prop.after)
  } else {
    proseParts.push(s)
  }

  let prose = proseParts.filter(Boolean).join('\n\n').trim()
  // 清残留围栏字样
  prose = prose.replace(/:::cursor_dev_\w+/g, '').trim()
  return { prose, options, propose }
}

/** 工具：检测文本里是否含有 cursor 围栏（不解析） */
export function hasMachineFence(text: string): boolean {
  const s = String(text || '')
  return OPT_RE.test(s) || PROP_RE.test(s)
}
