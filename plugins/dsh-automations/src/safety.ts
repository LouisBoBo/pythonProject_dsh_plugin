/**
 * 高风险写操作门禁：只用于「拒绝开工」，不是任务状态机。
 * 条件宁窄：不匹配「取消/cancel」，不扫运行摘要。
 */
const FORBIDDEN_PATTERNS: { code: string; re: RegExp }[] = [
  { code: 'forbidden_action', re: /提交代码/ },
  { code: 'forbidden_action', re: /git\s+commit/i },
  { code: 'forbidden_action', re: /git\s+push/i },
  { code: 'forbidden_action', re: /自动写码/ },
  { code: 'forbidden_action', re: /用\s*cursor\s*(改|写)/i },
  { code: 'forbidden_action', re: /部署到预发/ },
  { code: 'forbidden_action', re: /部署到生产/ },
  { code: 'forbidden_action', re: /自动发版/ },
]

export function detectForbiddenAction(prompt: string): string | null {
  const text = String(prompt || '')
  if (!text.trim()) return null
  for (const row of FORBIDDEN_PATTERNS) {
    if (row.re.test(text)) return row.code
  }
  return null
}

export const SAFETY_PREFIX =
  '【自动化任务】按指令完成只读汇总并直接给出结果摘要。' +
  '不要反问用户。禁止写码、修改文件、Git 提交/推送、部署、删除用户文件。' +
  '没有查到的数据不要编造。\n'
