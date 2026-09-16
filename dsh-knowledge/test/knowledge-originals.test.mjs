import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  importedOriginalPath,
  safeImportedOriginalName,
  writeImportedOriginal,
} from '../lib/knowledge-originals.js'

describe('knowledge originals paths', () => {
  it('drops path separators and parent-directory names', () => {
    assert.equal(safeImportedOriginalName('../etc/passwd'), 'document')
    assert.equal(safeImportedOriginalName('..\\secret.docx'), 'document')
    assert.equal(safeImportedOriginalName('报价规则.docx'), '报价规则.docx')
  })

  it('refuses to resolve a file outside the per-entry originals directory', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    assert.throws(() => importedOriginalPath('/tmp/kb', '../escape', 'a.pdf'), /invalid original entry id/)
    const path = importedOriginalPath('/tmp/kb', id, '../a.pdf')
    assert.ok(path.includes(id))
    assert.ok(path.endsWith(`${id}/document`) || path.endsWith(`${id}\\document`))
  })

  it('writes under originals/{entryId}/ only', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-orig-'))
    try {
      const id = '22222222-2222-4222-8222-222222222222'
      const filePath = await writeImportedOriginal(root, id, '说明.pdf', Buffer.from('%PDF-'))
      assert.equal(filePath, join(root, 'originals', id, '说明.pdf'))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
