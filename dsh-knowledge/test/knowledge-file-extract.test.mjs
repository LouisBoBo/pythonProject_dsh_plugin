import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { draftsFromImportedFile, extractImportedFileText, renderImportedDocxPreview } from '../lib/knowledge-file-extract.js'

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

const SAMPLE_PDF = `%PDF-1.4
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
`

describe('knowledge file extract', () => {
  it('extracts text from a PDF with a text layer', async () => {
    const { text, error } = await extractImportedFileText('quote.pdf', Buffer.from(SAMPLE_PDF))
    assert.equal(error, undefined)
    assert.match(text, /WorkBuddyImportXYZ/)
  })

  it('extracts text from a docx fixture', async () => {
    const buffer = readFileSync(join(fixtureDir, 'import-sample.docx'))
    const { drafts, error } = await draftsFromImportedFile({
      filename: 'import-sample.docx',
      buffer,
      knowledgeBaseId: 'base-1',
    })
    assert.equal(error, undefined)
    assert.equal(drafts.length, 1)
    assert.equal(drafts[0].title, 'import-sample')
    assert.match(drafts[0].body, /WorkBuddyImportXYZ Word正文/)
  })

  it('renders a Word-like HTML preview from the original docx', async () => {
    const buffer = readFileSync(join(fixtureDir, 'import-sample.docx'))
    const html = await renderImportedDocxPreview(buffer)
    assert.match(html, /<style>/)
    assert.match(html, /WorkBuddyImportXYZ Word正文/)
    assert.doesNotMatch(html, /<script/i)
  })

  it('strips script and event handlers from Word preview HTML', async () => {
    const { sanitizeDocxPreviewHtml } = await import('../lib/docx-preview-page.js')
    const dirty = '<p onclick="alert(1)">ok</p><script>alert(1)</script><a href="javascript:alert(1)">x</a><img src="x" onerror="alert(1)">'
    const clean = sanitizeDocxPreviewHtml(dirty)
    assert.match(clean, />ok</)
    assert.doesNotMatch(clean, /script/i)
    assert.doesNotMatch(clean, /onclick/i)
    assert.doesNotMatch(clean, /onerror/i)
    assert.doesNotMatch(clean, /javascript:/i)
  })

  it('rejects old .doc compound files', async () => {
    const buffer = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    const { error } = await extractImportedFileText('legacy.doc', buffer)
    assert.equal(error, '旧版 Word（.doc）请另存为 .docx 后再导入')
  })

  it('rejects a PDF without extractable text', async () => {
    const emptyPdf = SAMPLE_PDF.replace('(WorkBuddyImportXYZ)', '()')
    const { error } = await extractImportedFileText('scan.pdf', Buffer.from(emptyPdf))
    assert.equal(error, '未能从 PDF 抽出文字，可能是扫描件或图片版')
  })
})
