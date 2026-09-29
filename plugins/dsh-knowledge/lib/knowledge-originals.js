import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

const ENTRY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isImportedOriginalEntryId(entryId) {
  return ENTRY_ID_PATTERN.test(String(entryId || ''))
}

export function knowledgeOriginalsRoot(storageRoot) {
  return join(storageRoot, 'originals')
}

export function safeImportedOriginalName(filename) {
  const name = String(filename || '').replace(/[/\\]/g, '').replace(/\0/g, '').trim() || 'document'
  if (name === '.' || name === '..' || name.includes('..')) return 'document'
  return name.slice(0, 180)
}

export function importedOriginalPath(storageRoot, entryId, filename) {
  if (!isImportedOriginalEntryId(entryId))
    throw new Error('invalid original entry id')
  const root = resolve(knowledgeOriginalsRoot(storageRoot), entryId)
  const filePath = resolve(root, safeImportedOriginalName(filename))
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`
  if (filePath !== root && !filePath.startsWith(prefix))
    throw new Error('invalid original path')
  return filePath
}

export async function writeImportedOriginal(storageRoot, entryId, filename, buffer) {
  const filePath = importedOriginalPath(storageRoot, entryId, filename)
  await mkdir(join(knowledgeOriginalsRoot(storageRoot), entryId), { recursive: true })
  await writeFile(filePath, buffer)
  return filePath
}

export async function readImportedOriginalFile(storageRoot, entryId, filename) {
  return readFile(importedOriginalPath(storageRoot, entryId, filename))
}

export async function removeImportedOriginal(storageRoot, entryId) {
  if (!isImportedOriginalEntryId(entryId)) return
  await rm(join(knowledgeOriginalsRoot(storageRoot), entryId), { recursive: true, force: true })
}
