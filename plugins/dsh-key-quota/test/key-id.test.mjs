import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { keyIdOf, tailOf } from '../lib/key-id.js'

describe('key id', () => {
  it('is stable, hides the raw key, and keeps a 4-char tail', () => {
    const raw = 'sk-test-secret-ab12'
    const id = keyIdOf(raw)
    assert.equal(id, keyIdOf('  sk-test-secret-ab12  '))
    assert.notEqual(id, keyIdOf('sk-test-secret-ab13'))
    assert.equal(id.length, 64)
    assert.equal(tailOf(raw), 'ab12')
    assert.equal(JSON.stringify({ id, tail: tailOf(raw) }).includes(raw), false)
  })
})
