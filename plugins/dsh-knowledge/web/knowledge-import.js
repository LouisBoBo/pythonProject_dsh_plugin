/**
 * 把本地文件变成 knowledge entry 草稿。
 * 只服务「知识文档」导入；笔记区上传不得走这里。
 * 浏览器与 Node 测试共用，禁止依赖 DOM。
 * PDF / .docx 的二进制解析在 lib/knowledge-file-extract.js。
 */

export const KNOWLEDGE_TITLE_MAX = 200
export const KNOWLEDGE_BODY_MAX = 50_000
export const KNOWLEDGE_IMPORT_TEXT_MAX_BYTES = 2 * 1024 * 1024
export const KNOWLEDGE_IMPORT_FILE_MAX_BYTES = 16 * 1024 * 1024
export const KNOWLEDGE_IMPORT_EXTENSIONS = ['.md', '.txt', '.pdf', '.docx']
export const KNOWLEDGE_IMPORT_ACCEPT = [
  '.md', '.txt', '.pdf', '.docx',
  'text/plain', 'text/markdown', 'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
].join(',')

const encoder = new TextEncoder()

export function utf8ByteLength(text) {
  return encoder.encode(String(text ?? '')).length
}

export function knowledgeImportExtension(name) {
  const base = String(name || '').trim()
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return base.slice(dot).toLowerCase()
}

export function isAllowedKnowledgeImportName(name) {
  return KNOWLEDGE_IMPORT_EXTENSIONS.includes(knowledgeImportExtension(name))
}

export function importedFileMediaType(filename) {
  const ext = knowledgeImportExtension(filename)
  if (ext === '.pdf') return 'application/pdf'
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (ext === '.md') return 'text/markdown'
  if (ext === '.txt') return 'text/plain'
  return 'application/octet-stream'
}

export function shouldStoreImportedOriginal(filename) {
  const ext = knowledgeImportExtension(filename)
  return ext === '.pdf' || ext === '.docx'
}

export function importedFileSource(filename, originalEntryId) {
  return {
    kind: 'imported-file',
    filename: String(filename || '').trim(),
    mediaType: importedFileMediaType(filename),
    ...originalEntryId ? { originalEntryId } : {},
  }
}

export function importedOriginalKind(source) {
  if (!source || source.kind !== 'imported-file') return ''
  const ext = knowledgeImportExtension(source.filename || '')
  if (ext === '.pdf' || ext === '.docx') return ext.slice(1)
  return ''
}

export function isImportedOriginalSource(source) {
  return importedOriginalKind(source) === 'pdf' || importedOriginalKind(source) === 'docx'
}

export function isImportedPdfSource(source) {
  return importedOriginalKind(source) === 'pdf'
}

export function titleFromImportFilename(filename) {
  const name = String(filename || '').trim() || '未命名'
  const ext = knowledgeImportExtension(name)
  const stem = (ext ? name.slice(0, -ext.length) : name).trim() || '未命名'
  return clipTitle(stem)
}

export function partTitle(baseTitle, index, total) {
  const head = clipTitle(baseTitle)
  if (total <= 1 || index <= 0) return head
  const suffix = ` (${index + 1})`
  const budget = KNOWLEDGE_TITLE_MAX - suffix.length
  if (budget < 1) return suffix.slice(0, KNOWLEDGE_TITLE_MAX)
  return `${head.length > budget ? head.slice(0, budget) : head}${suffix}`
}

function clipTitle(title) {
  const value = String(title || '').trim() || '未命名'
  return value.length > KNOWLEDGE_TITLE_MAX ? value.slice(0, KNOWLEDGE_TITLE_MAX) : value
}

const CJK_CHAR = /[\u3400-\u9FFF\uF900-\uFAFF\u3000-\u303F\uFF00-\uFFEF]/u

/**
 * PDF 常把每个汉字抽成独立 item，再被空格拼开。
 * 只清检索/入库正文，不改界面。Markdown 源文件不要走这里。
 */
export function normalizeImportedKnowledgeText(text) {
  let value = String(text ?? '').replace(/\r\n?/g, '\n').replaceAll('\u0000', '')
  value = value.replace(new RegExp(`(${CJK_CHAR.source})[ \\t\\u00a0]+(?=${CJK_CHAR.source})`, 'gu'), '$1')
  value = value.replace(/[ \t]+/g, ' ')
  value = value.replace(/[ \t]*\n[ \t]*/g, '\n')
  value = value.replace(/\n{3,}/g, '\n\n')
  return value.trim()
}

function splitByBlankLines(text) {
  return text.split(/\n{2,}/u).map(part => part.trim()).filter(Boolean)
}

function hardSplit(text, maxLen) {
  const chunks = []
  for (let offset = 0; offset < text.length; offset += maxLen) {
    const piece = text.slice(offset, offset + maxLen).trim()
    if (piece) chunks.push(piece)
  }
  return chunks
}

/**
 * 超长正文按 Markdown 标题、空行切分，必要时硬切，保证每篇 1～maxLen 字。
 */
export function splitKnowledgeBody(text, maxLen = KNOWLEDGE_BODY_MAX) {
  const body = String(text ?? '').trim()
  if (!body) return []
  if (body.length <= maxLen) return [body]

  const headingParts = body.split(/(?=^#{1,6}\s)/mu).map(part => part.trim()).filter(Boolean)
  const units = headingParts.length > 1 ? headingParts.flatMap(part => {
    if (part.length <= maxLen) return [part]
    const paragraphs = splitByBlankLines(part)
    return paragraphs.length > 1 ? paragraphs : hardSplit(part, maxLen)
  }) : splitByBlankLines(body)

  const packed = []
  let current = ''
  const flush = () => {
    if (current) packed.push(current)
    current = ''
  }
  for (const unit of units) {
    if (unit.length > maxLen) {
      flush()
      packed.push(...hardSplit(unit, maxLen))
      continue
    }
    if (!current) {
      current = unit
      continue
    }
    if (current.length + 2 + unit.length <= maxLen) current = `${current}\n\n${unit}`
    else {
      packed.push(current)
      current = unit
    }
  }
  flush()
  return packed
}

export function draftsFromImportedText({ filename, text, knowledgeBaseId }) {
  if (utf8ByteLength(text) > KNOWLEDGE_IMPORT_TEXT_MAX_BYTES) {
    return { drafts: [], error: '文件过大（解码后超过 2MB）' }
  }
  const chunks = splitKnowledgeBody(text)
  if (chunks.length === 0) return { drafts: [], error: '文件没有可用正文' }
  const baseTitle = titleFromImportFilename(filename)
  return {
    drafts: chunks.map((body, index) => ({
      knowledgeBaseId,
      title: partTitle(baseTitle, index, chunks.length),
      body,
      type: 'fact',
      tags: ['imported'],
      scope: { kind: 'global' },
      confidence: 0.8,
    })),
  }
}
