/**
 * 删除意图识别 & 功能名提取
 *
 * 从 Python mom 源码 brief.py + delete_verify.py 移植。
 * 纯函数，零模块依赖，TypeScript 重写。
 */

const DELETE_INTENT_SKIP = [
  '新增或删除任何功能',
  '不在菜单/页面新增或删除',
  '不删除任何功能',
] as const

const DELETE_INTENT_PATTERNS: RegExp[] = [
  /删除.{0,16}(?:功能|页面|菜单|模块|子项|入口|接口|路由|视图|组件)/,
  /移除.{0,16}(?:功能|页面|菜单|模块|子项|入口|接口|路由|视图|组件)/,
  /去掉.{0,16}(?:功能|页面|菜单|模块|子项|入口|接口|路由|视图|组件)/,
  /完整移除/,
  /清理残留/,
  /下线.{0,12}(?:功能|页面|模块|菜单)/,
]

const KNOWN_MENU_LEAVES = [
  '生产排产', '生产工单', '品质概览', '检验方案', '检验任务', '检验记录',
  '录入检验', '设备台账', '设备点检', '保养计划', '保养工单', '维修管理',
  '物料库存', '物料入库', '物料出库', '考勤记录', '请假管理', '排班管理',
  '生产看板', '品质看板', '设备看板', '仓储看板', '综合看板',
] as const

const BLOCKLIST = new Set([
  '原始诉求', '实现要点', '硬性约束', '验收', '业务目标',
  '目标模块', '通用列表', '页面与', '菜单与',
])

const PARENT_MODULES = new Set([
  '生产管理', '品质管理', '质量管理', '设备管理',
  '仓储管理', '看板管理', '考勤管理', '业务管理',
])

/** 判断诉求是否为删除类任务 */
export function isDeleteIntent(requirement: string): boolean {
  const text = String(requirement || '').trim()
  if (!text) return false
  if (DELETE_INTENT_SKIP.some(s => text.includes(s))) return false
  return DELETE_INTENT_PATTERNS.some(p => p.test(text))
}

/** 从诉求中提取待删功能/菜单名（可多个） */
export function extractDeleteFeatures(requirement: string): string[] {
  let text = String(requirement || '').trim()
  if (!text) return []
  // 去掉 canonical 模板噪声
  text = text.replace(/【[^】]{1,24}】/g, ' ')
  text = text.replace(/必须完整实现「原始诉求」中的业务目标[^\n]*/g, ' ')

  const found: string[] = []

  const norm = (label: string): string => {
    let s = String(label || '').trim()
    for (const prefix of ['菜单下的', '模块下的', '里的', '中的', '下的', '请求中']) {
      if (s.includes(prefix)) s = s.split(prefix).pop()!.trim()
    }
    for (const suffix of ['功能', '页面', '菜单', '模块', '入口', '路由', '子项', '子菜单']) {
      if (s.endsWith(suffix) && s.length > suffix.length + 1) {
        s = s.slice(0, -suffix.length).trim()
        break
      }
    }
    for (const parent of PARENT_MODULES) {
      if (s.startsWith(parent) && s.length > parent.length + 1) {
        s = s.slice(parent.length).replace(/^的下中里\-—–\s+/, '')
        break
      }
    }
    return s.trim().replace(/[ 「」『」"']/g, '')
  }

  // 1) 已知叶子名直接命中
  for (const leaf of KNOWN_MENU_LEAVES) {
    if (text.includes(leaf)) found.push(leaf)
  }

  if (found.length) {
    const seen = new Set<string>()
    const out: string[] = []
    for (const f of found) {
      if (!seen.has(f)) { seen.add(f); out.push(f) }
    }
    const leaves = out.filter(x => !PARENT_MODULES.has(x))
    return leaves.length ? leaves : out
  }

  // 2) 「…下的生产排产」结构
  const underRe = /(?:菜单|模块|管理)?下的\s*[「『"]?([^」』"，。\n]{2,16})/g
  let m: RegExpExecArray | null
  while ((m = underRe.exec(text)) !== null) found.push(norm(m[1]))

  // 3) 引号与「删除/移除…」兜底
  const quoteRe = /[「『"]([^」』"]{2,24})[」』"]/g
  while ((m = quoteRe.exec(text)) !== null) found.push(norm(m[1]))
  const verbRe = /(?:移除|删除|去掉|下线|清理)\s*[「『"]?([^」』"，。\n]{2,24})/g
  while ((m = verbRe.exec(text)) !== null) found.push(norm(m[1]))

  const out: string[] = []
  const seen = new Set<string>()
  for (const f of found) {
    if (f.length < 2 || seen.has(f)) continue
    if (BLOCKLIST.has(f) || [...BLOCKLIST].some(b => f.includes(b))) continue
    if (f.includes('菜单') && !KNOWN_MENU_LEAVES.includes(f as any)) continue
    if (f.length > 12 && !KNOWN_MENU_LEAVES.includes(f as any)) continue
    if (/那个|这个|东西|相关|对应|上述|目标|功能项|诉求|约束|要点/.test(f)) continue
    seen.add(f)
    out.push(f)
  }
  const leaves = out.filter(x => !PARENT_MODULES.has(x))
  if (leaves.length && out.some(p => PARENT_MODULES.has(p))) return leaves
  return out
}

/** 从 Cursor 终稿/过程文案中提取「声称已删除」的相对路径 */
export function extractClaimedDeletedPaths(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.includes('已删除') && !line.includes('删除')) continue
    const re = /`([^`]+)`/g
    let m: RegExpExecArray | null
    while ((m = re.exec(line)) !== null) {
      let p = m[1].trim().replace(/\\/g, '/').replace(/^\.\/?/, '')
      if (!p || p.startsWith('http') || seen.has(p)) continue
      if (!p.includes('/') && !/\.(vue|js|py|ts|tsx|jsx)$/.test(p)) continue
      seen.add(p)
      out.push(p)
    }
  }
  return out
}
