/** Word 预览页样式。内容必须与 <style> 完全一致，供 CSP sha256 使用。 */
export const DOCX_PREVIEW_STYLE = 'html,body{margin:0;background:#f3f3f3}body{color:#1f1f1f;font:16px/1.6 "Segoe UI",Calibri,system-ui,sans-serif}main{box-sizing:border-box;min-height:100vh;margin:0 auto;max-width:816px;padding:72px 84px 96px;background:#fff}p{margin:0 0 .75em}table{border-collapse:collapse;width:100%;margin:1em 0}td,th{border:1px solid #d0d0d0;padding:6px 10px;vertical-align:top}img{max-width:100%;height:auto}h1,h2,h3,h4{line-height:1.3;margin:1.1em 0 .4em}ul,ol{margin:.5em 0;padding-left:1.6em}'

const BLOCKED_TAGS = /<(script|style|iframe|object|embed|link|meta|base|form|input|button|textarea|select|svg|math|video|audio)\b[^>]*>[\s\S]*?<\/\1>/gi
const BLOCKED_EMPTY_TAGS = /<(script|iframe|object|embed|link|meta|base|form|input|button)\b[^>]*\/?>/gi
const EVENT_ATTR = /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi
const BAD_HREF = /\shref\s*=\s*(["'])\s*(?:javascript:|vbscript:|data:)[\s\S]*?\1/gi
const BAD_SRC = /\ssrc\s*=\s*(["'])\s*(?:javascript:|vbscript:|data\s*:(?!image\/))[\s\S]*?\1/gi

export function sanitizeDocxPreviewHtml(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(BLOCKED_TAGS, '')
    .replace(BLOCKED_EMPTY_TAGS, '')
    .replace(EVENT_ATTR, '')
    .replace(BAD_HREF, ' href="#"')
    .replace(BAD_SRC, '')
}

export function wrapDocxPreviewHtml(bodyHtml) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Word</title><style>${DOCX_PREVIEW_STYLE}</style></head><body><main>${sanitizeDocxPreviewHtml(bodyHtml)}</main></body></html>`
}
