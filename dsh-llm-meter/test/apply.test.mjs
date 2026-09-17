import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { apply } from '../lib/index.js'

describe('apply', () => {
  it('does not register waterfall when enabled is false', () => {
    let registered = 0
    const ctx = {
      logger: { warn() {}, info() {} },
      on() { registered += 1 },
    }
    apply(ctx, { enabled: false })
    assert.equal(registered, 0)
  })

  it('registers global llm/stream listener and does not prepend', () => {
    const calls = []
    const ctx = {
      logger: { warn() {}, info() {} },
      on(name, listener, options) {
        calls.push({ name, listener, options })
        return () => true
      },
    }
    apply(ctx, { enabled: true, eventsPath: '/tmp/llm-meter-test.jsonl', maxFileBytes: 4096 })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].name, 'llm/stream')
    assert.deepEqual(calls[0].options, { global: true })
    assert.equal(typeof calls[0].listener, 'function')
  })
})
