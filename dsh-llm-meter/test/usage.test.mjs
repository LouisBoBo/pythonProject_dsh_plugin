import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { pickUsage } from '../lib/usage.js'
import { resolveEventsPath } from '../lib/config.js'
import { homedir } from 'node:os'
import { join } from 'node:path'

describe('pickUsage', () => {
  it('reads nested chunk.usage and keeps reasoning out of total', () => {
    const parsed = pickUsage({
      type: 'usage',
      usage: {
        inputTokens: 1826,
        outputTokens: 361,
        cacheReadTokens: 19840,
        reasoningTokens: 70,
      },
    })
    assert.deepEqual(parsed, {
      input: 1826,
      output: 361,
      cacheRead: 19840,
      cacheWrite: 0,
      reasoning: 70,
      total: 1826 + 361 + 19840,
    })
  })

  it('prefers provider totalTokens when present', () => {
    const parsed = pickUsage({
      type: 'usage',
      usage: {
        inputTokens: 10,
        outputTokens: 2,
        totalTokens: 99,
        reasoningTokens: 5,
      },
    })
    assert.equal(parsed?.total, 99)
    assert.equal(parsed?.reasoning, 5)
  })

  it('does not treat top-level inputTokens on a usage chunk as the source when usage exists', () => {
    const parsed = pickUsage({
      type: 'usage',
      inputTokens: 999,
      usage: { inputTokens: 10, outputTokens: 2 },
    })
    assert.equal(parsed?.input, 10)
    assert.equal(parsed?.output, 2)
  })

  it('accepts snake_case aliases when camelCase is absent', () => {
    const parsed = pickUsage({
      type: 'usage',
      usage: {
        input_tokens: 3,
        output_tokens: 4,
        cache_read_tokens: 5,
        cache_write_tokens: 6,
        reasoning_tokens: 7,
      },
    })
    assert.deepEqual(parsed, {
      input: 3,
      output: 4,
      cacheRead: 5,
      cacheWrite: 6,
      reasoning: 7,
      total: 18,
    })
  })

  it('returns null for non-usage chunks and all-zero usage', () => {
    assert.equal(pickUsage({ type: 'text-delta', text: 'hi' }), null)
    assert.equal(pickUsage({ type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } }), null)
    assert.equal(pickUsage({ type: 'usage' }), null)
    assert.equal(pickUsage(null), null)
  })

  it('keeps cache-only usage because billed input can be cacheReadTokens', () => {
    const parsed = pickUsage({
      type: 'usage',
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 128 },
    })
    assert.equal(parsed?.cacheRead, 128)
    assert.equal(parsed?.total, 128)
  })
})

describe('resolveEventsPath', () => {
  it('rejects paths outside DSH_HOME', () => {
    const prev = process.env.DSH_HOME
    process.env.DSH_HOME = join(homedir(), '.dsh-test-meter-home')
    try {
      const safe = resolveEventsPath(undefined)
      assert.ok(safe.includes('llm-meter'))
      assert.equal(resolveEventsPath('/tmp/evil.jsonl'), safe)
      assert.ok(resolveEventsPath('llm-meter/custom.jsonl').endsWith('llm-meter/custom.jsonl'))
    } finally {
      if (prev === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = prev
    }
  })
})
