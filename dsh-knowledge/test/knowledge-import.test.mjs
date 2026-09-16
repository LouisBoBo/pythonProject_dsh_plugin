import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import {
  draftsFromImportedText,
  importedOriginalKind,
  isAllowedKnowledgeImportName,
  KNOWLEDGE_BODY_MAX,
  KNOWLEDGE_IMPORT_TEXT_MAX_BYTES,
  normalizeImportedKnowledgeText,
  partTitle,
  splitKnowledgeBody,
  titleFromImportFilename,
} from '../web/knowledge-import.js'

describe('knowledge-import drafts', () => {
  it('removes fake spaces between CJK characters from PDF-style extraction', () => {
    const messy = '根据 数据 库表 快速 理解 平台 业务 功能  一、问：平台能干 什么？给 我 一个 功能 总览'
    assert.equal(
      normalizeImportedKnowledgeText(messy),
      '根据数据库表快速理解平台业务功能一、问：平台能干什么？给我一个功能总览',
    )
    assert.equal(normalizeImportedKnowledgeText('中软 MES 平台'), '中软 MES 平台')
  })

  it('accepts md/txt/pdf/docx regardless of case and rejects other extensions', () => {
    assert.equal(isAllowedKnowledgeImportName('spec.MD'), true)
    assert.equal(isAllowedKnowledgeImportName('notes.Txt'), true)
    assert.equal(isAllowedKnowledgeImportName('scan.PDF'), true)
    assert.equal(isAllowedKnowledgeImportName('brief.Docx'), true)
    assert.equal(isAllowedKnowledgeImportName('old.doc'), false)
    assert.equal(isAllowedKnowledgeImportName('notes.md.exe'), false)
    assert.equal(importedOriginalKind({ kind: 'imported-file', filename: '规则.docx' }), 'docx')
    assert.equal(importedOriginalKind({ kind: 'imported-file', filename: '说明.PDF' }), 'pdf')
    assert.equal(importedOriginalKind({ kind: 'imported-file', filename: 'a.md' }), '')
  })

  it('uses the filename stem as title and truncates to 200 characters', () => {
    assert.equal(titleFromImportFilename('WorkBuddyImportXYZ.md'), 'WorkBuddyImportXYZ')
    assert.equal(titleFromImportFilename(`${'标题'.repeat(120)}.txt`).length, 200)
  })

  it('keeps a short body as one draft', () => {
    const { drafts, error } = draftsFromImportedText({
      filename: 'alpha.md',
      text: 'WorkBuddyImportXYZ 可检索正文',
      knowledgeBaseId: 'base-1',
    })
    assert.equal(error, undefined)
    assert.equal(drafts.length, 1)
    assert.equal(drafts[0].title, 'alpha')
    assert.equal(drafts[0].type, 'fact')
    assert.deepEqual(drafts[0].tags, ['imported'])
    assert.deepEqual(drafts[0].scope, { kind: 'global' })
    assert.equal(drafts[0].confidence, 0.8)
  })

  it('splits bodies longer than 50000 characters into multiple drafts', () => {
    const first = `# 一\n\n${'甲'.repeat(40_000)}`
    const second = `# 二\n\n${'乙'.repeat(40_000)}`
    const chunks = splitKnowledgeBody(`${first}\n\n${second}`)
    assert.ok(chunks.length >= 2)
    assert.ok(chunks.every(chunk => chunk.length >= 1 && chunk.length <= KNOWLEDGE_BODY_MAX))
    assert.ok(chunks.some(chunk => chunk.includes('甲')))
    assert.ok(chunks.some(chunk => chunk.includes('乙')))

    const { drafts } = draftsFromImportedText({
      filename: 'long.md',
      text: `${first}\n\n${second}`,
      knowledgeBaseId: 'base-1',
    })
    assert.ok(drafts.length >= 2)
    assert.equal(drafts[0].title, 'long')
    assert.equal(drafts[1].title, 'long (2)')
    assert.ok(drafts.every(draft => draft.body.length <= KNOWLEDGE_BODY_MAX))
  })

  it('hard-splits a single paragraph that exceeds 50000 characters', () => {
    const body = 'Z'.repeat(KNOWLEDGE_BODY_MAX + 17)
    const chunks = splitKnowledgeBody(body)
    assert.equal(chunks.length, 2)
    assert.equal(chunks[0].length, KNOWLEDGE_BODY_MAX)
    assert.equal(chunks[1].length, 17)
  })

  it('rejects empty text and decoded payloads larger than 2MB', () => {
    assert.equal(draftsFromImportedText({ filename: 'empty.md', text: '   \n', knowledgeBaseId: 'b' }).error, '文件没有可用正文')
    const huge = 'a'.repeat(KNOWLEDGE_IMPORT_TEXT_MAX_BYTES + 1)
    assert.equal(draftsFromImportedText({ filename: 'huge.md', text: huge, knowledgeBaseId: 'b' }).error, '文件过大（解码后超过 2MB）')
  })

  it('keeps numbered titles within 200 characters', () => {
    const title = 'T'.repeat(200)
    assert.equal(partTitle(title, 1, 2).length, 200)
    assert.ok(partTitle(title, 1, 2).endsWith(' (2)'))
  })

  it('is listed in the management-console static asset whitelist', () => {
    const source = readFileSync(new URL('../lib/web.js', import.meta.url), 'utf8')
    assert.match(source, /'knowledge-import'/)
  })
})
