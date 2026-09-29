/**
 * 把导入文件抽成纯文本，再切成 knowledge entry 草稿。
 * 二进制不得写入 knowledge body，也不得改走笔记上传。
 */
import mammoth from 'mammoth'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
  draftsFromImportedText,
  isAllowedKnowledgeImportName,
  knowledgeImportExtension,
  normalizeImportedKnowledgeText,
  KNOWLEDGE_IMPORT_FILE_MAX_BYTES,
} from '../web/knowledge-import.js'
import { wrapDocxPreviewHtml } from './docx-preview-page.js'

function looksLikePdf(buffer) {
  return buffer.subarray(0, 5).toString('latin1') === '%PDF-'
}

function looksLikeZip(buffer) {
  return buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b
}

function looksLikeOleCompound(buffer) {
  return buffer.length >= 4
    && buffer[0] === 0xd0
    && buffer[1] === 0xcf
    && buffer[2] === 0x11
    && buffer[3] === 0xe0
}

function isCjkChar(ch) {
  return ch !== undefined && /[\u3400-\u9FFF\uF900-\uFAFF\u3000-\u303F\uFF00-\uFFEF]/u.test(ch)
}

function joinPdfTextItems(items) {
  let out = ''
  for (const item of items) {
    let piece = typeof item.str === 'string' ? item.str : ''
    if (item.hasEOL) piece += '\n'
    if (!piece) continue
    if (!out) {
      out = piece
      continue
    }
    const left = out[out.length - 1]
    const right = piece[0]
    if (isCjkChar(left) && isCjkChar(right)) out += piece
    else if (/\s$/u.test(out) || /^\s/u.test(piece)) out += piece
    else out += ` ${piece}`
  }
  return out
}

async function extractPdfText(buffer) {
  const task = getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: true,
  })
  const document = await task.promise
  try {
    const pages = []
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const line = joinPdfTextItems(content.items).trim()
      if (line) pages.push(line)
    }
    return pages.join('\n\n')
  } finally {
    await document.cleanup?.()
  }
}

export async function extractImportedFileText(filename, buffer) {
  const ext = knowledgeImportExtension(filename)
  if (ext === '.doc' || looksLikeOleCompound(buffer)) {
    return { text: '', error: '旧版 Word（.doc）请另存为 .docx 后再导入' }
  }
  if (!isAllowedKnowledgeImportName(filename)) {
    return { text: '', error: '仅支持 .md / .txt / .pdf / .docx' }
  }
  if (buffer.byteLength > KNOWLEDGE_IMPORT_FILE_MAX_BYTES) {
    return { text: '', error: '文件过大（上限 16MB）' }
  }
  try {
    if (ext === '.pdf') {
      if (!looksLikePdf(buffer)) return { text: '', error: '不是有效的 PDF 文件' }
      const text = normalizeImportedKnowledgeText(await extractPdfText(buffer))
      if (!text) return { text: '', error: '未能从 PDF 抽出文字，可能是扫描件或图片版' }
      return { text }
    }
    if (ext === '.docx') {
      if (!looksLikeZip(buffer)) return { text: '', error: '不是有效的 Word 文档（.docx）' }
      const result = await mammoth.extractRawText({ buffer })
      const text = normalizeImportedKnowledgeText(String(result.value || ''))
      if (!text) return { text: '', error: '未能从 Word 文档抽出文字' }
      return { text }
    }
  } catch {
    if (ext === '.pdf') return { text: '', error: 'PDF 解析失败，请确认文件未损坏' }
    return { text: '', error: 'Word 文档解析失败，请确认文件未损坏' }
  }
  let text = buffer.toString('utf8')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  return { text }
}

export async function renderImportedDocxPreview(buffer) {
  const result = await mammoth.convertToHtml({ buffer })
  return wrapDocxPreviewHtml(String(result.value || ''))
}

export async function draftsFromImportedFile({ filename, buffer, knowledgeBaseId }) {
  const extracted = await extractImportedFileText(filename, buffer)
  if (extracted.error) return { drafts: [], error: extracted.error }
  return draftsFromImportedText({ filename, text: extracted.text, knowledgeBaseId })
}
