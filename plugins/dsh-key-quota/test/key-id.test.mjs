import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { keyIdOf, maskApiKey, tailOf } from '../lib/key-id.js'

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

  it('shows the supplier key as a prefix, stars, and the last four characters', () => {
    const raw = 'sk-5ec2eHIDDEN-MIDDLE-VALUEb3eb'
    const mask = maskApiKey(raw)
    assert.equal(mask, 'sk-5ec2e*****b3eb')
    assert.equal(JSON.stringify({ mask }).includes(raw), false)
    assert.equal(JSON.stringify({ mask }).includes('HIDDEN-MIDDLE'), false)
    assert.equal(maskApiKey('50a' + 'x'.repeat(40) + 'wxyz'), '50axxxxx*****wxyz')
    assert.equal(maskApiKey('sk-short'), '')
    assert.equal(maskApiKey('12345678*****abcd'), '')
  })
})
