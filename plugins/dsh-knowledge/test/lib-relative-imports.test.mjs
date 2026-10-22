import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const libDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib')
const specifier = /from\s+['"](\.[^'"]+\.js)['"]|import\(\s*['"](\.[^'"]+\.js)['"]\s*\)/g

async function javascriptFiles(dir) {
  const found = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...await javascriptFiles(path))
    else if (entry.isFile() && entry.name.endsWith('.js')) found.push(path)
  }
  return found
}

describe('knowledge package relative imports', () => {
  it('resolves every relative .js import under lib, including secret-box.js', async () => {
    const files = await javascriptFiles(libDir)
    const missing = []
    let sawSecretBoxImport = false
    for (const file of files) {
      const text = await readFile(file, 'utf8')
      for (const match of text.matchAll(specifier)) {
        const spec = match[1] || match[2]
        if (spec.endsWith('/secret-box.js') || spec === './secret-box.js') sawSecretBoxImport = true
        const target = resolve(dirname(file), spec)
        try {
          await readFile(target)
        } catch {
          missing.push(`${file} -> ${spec}`)
        }
      }
    }
    assert.equal(sawSecretBoxImport, true, 'local-provider must import ./secret-box.js')
    assert.deepEqual(missing, [])
  })
})
