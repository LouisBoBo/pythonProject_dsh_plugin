/** 飞书知识库节点 token：支持裸 token、wiki/…、完整 /wiki/ 链接。 */
export function normalizeWikiToken(raw: string): string {
  const text = (raw || '').trim()
  if (!text) return ''
  const wikiMatch = text.match(/(?:^|\/)wiki\/([^/?#]+)/i)
  if (wikiMatch) return wikiMatch[1].trim()
  if (
    text.includes('://') ||
    text.toLowerCase().includes('feishu.cn') ||
    text.toLowerCase().includes('larksuite.com')
  ) {
    const url = text.includes('://') ? text : `https://${text}`
    const parsed = new URL(url)
    const parts = parsed.pathname.split('/').filter(Boolean)
    const baseIdx = parts.findIndex((p) => p === 'base' || p === 'basex')
    if (baseIdx >= 0) {
      throw new Error('请填知识库文档链接（/wiki/…），不是多维表格 /base/…')
    }
    throw new Error('无法从飞书链接解析知识库节点，请粘贴 /wiki/… 链接或节点 token')
  }
  return text
}
