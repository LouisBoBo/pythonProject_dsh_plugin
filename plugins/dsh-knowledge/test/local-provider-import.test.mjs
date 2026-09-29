import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { LocalKnowledgeProvider } from '../lib/local-provider.js'
import { KNOWLEDGE_BODY_MAX, draftsFromImportedText } from '../web/knowledge-import.js'

describe('LocalKnowledgeProvider import path', () => {
  async function withProvider(run) {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '.test-tmp', randomUUID())
    await mkdir(root, { recursive: true })
    const provider = new LocalKnowledgeProvider(join(root, 'knowledge.sqlite'))
    try {
      await run(provider)
    } finally {
      await provider.close().catch(() => {})
      await rm(root, { recursive: true, force: true })
    }
  }

  it('inserts an entry that FTS can recall by a unique keyword', async () => {
    await withProvider(async provider => {
      const base = await provider.createKnowledgeBase({
        name: '导入测试库',
        description: '',
        defaultTags: [],
        extractionInstructions: '',
        writebackPolicy: 'conservative',
      })
      const keyword = 'WorkBuddyImportXYZ'
      const entry = await provider.create({
        knowledgeBaseId: base.id,
        title: '导入样例',
        body: `这段知识包含独特词 ${keyword}，应能被挂载会话召回。`,
        type: 'fact',
        tags: ['imported'],
        scope: { kind: 'global' },
        confidence: 0.8,
      })
      const hits = await provider.search({
        text: keyword,
        limit: 10,
        knowledgeBaseIds: [base.id],
      })
      assert.ok(hits.some(hit => hit.entry.id === entry.id), 'FTS/search should return the inserted entry')
      assert.ok(hits.some(hit => hit.entry.body.includes(keyword)))
      const listed = await provider.list({ knowledgeBaseId: base.id, limit: 20 })
      assert.ok(listed.items.some(item => item.id === entry.id))
    })
  })

  it('rejects a body longer than 50000 characters at create', async () => {
    await withProvider(async provider => {
      const base = await provider.createKnowledgeBase({
        name: '超长拒绝库',
        description: '',
        defaultTags: [],
        extractionInstructions: '',
        writebackPolicy: 'conservative',
      })
      await assert.rejects(
        () => provider.create({
          knowledgeBaseId: base.id,
          title: '超长',
          body: '超'.repeat(KNOWLEDGE_BODY_MAX + 1),
          type: 'fact',
          tags: ['imported'],
          scope: { kind: 'global' },
          confidence: 0.8,
        }),
        /knowledge body must contain 1-50000 characters/,
      )
    })
  })

  it('creates one entry per split chunk so FTS can search each part', async () => {
    await withProvider(async provider => {
      const base = await provider.createKnowledgeBase({
        name: '切分入库库',
        description: '',
        defaultTags: [],
        extractionInstructions: '',
        writebackPolicy: 'conservative',
      })
      const { drafts, error } = draftsFromImportedText({
        filename: 'split.md',
        text: `# 甲\n\n${'甲'.repeat(40_000)}\n\n# 乙\n\nWorkBuddyImportXYZ ${'乙'.repeat(40_000)}`,
        knowledgeBaseId: base.id,
      })
      assert.equal(error, undefined)
      assert.ok(drafts.length >= 2)
      const created = []
      for (const draft of drafts) created.push(await provider.create(draft))
      assert.equal(created.length, drafts.length)
      const hits = await provider.search({
        text: 'WorkBuddyImportXYZ',
        limit: 10,
        knowledgeBaseIds: [base.id],
      })
      assert.ok(hits.some(hit => hit.entry.body.includes('WorkBuddyImportXYZ')))
    })
  })

  it('stores the original PDF for display while FTS still searches extracted text', async () => {
    await withProvider(async provider => {
      const base = await provider.createKnowledgeBase({
        name: '原件展示库',
        description: '',
        defaultTags: [],
        extractionInstructions: '',
        writebackPolicy: 'conservative',
      })
      const pdf = Buffer.from(`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj
4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
5 0 obj<</Length 68>>stream
BT /F1 12 Tf 20 160 Td (WorkBuddyImportXYZ) Tj ET
endstream
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000052 00000 n 
0000000101 00000 n 
0000000228 00000 n 
0000000295 00000 n 
trailer<</Size 6/Root 1 0 R>>
startxref
413
%%EOF
`)
      const entry = await provider.create({
        knowledgeBaseId: base.id,
        title: '平台说明',
        body: 'WorkBuddyImportXYZ 抽字用于检索',
        type: 'fact',
        tags: ['imported'],
        scope: { kind: 'global' },
        confidence: 0.8,
        source: { kind: 'imported-file', filename: '平台说明.pdf', mediaType: 'application/pdf' },
      })
      await provider.saveImportedOriginal(entry.id, '平台说明.pdf', pdf)
      const original = await provider.readImportedOriginal(entry.id)
      assert.equal(original.filename, '平台说明.pdf')
      assert.equal(original.mediaType, 'application/pdf')
      assert.ok(original.content.subarray(0, 5).toString() === '%PDF-')
      const listed = await provider.listDocumentIndex({ knowledgeBaseIds: [base.id], limit: 20 })
      assert.equal(listed.items.find(item => item.id === entry.id)?.originalFilename, '平台说明.pdf')
      const hits = await provider.search({ text: 'WorkBuddyImportXYZ', limit: 10, knowledgeBaseIds: [base.id] })
      assert.ok(hits.some(hit => hit.entry.id === entry.id))
    })
  })
})
