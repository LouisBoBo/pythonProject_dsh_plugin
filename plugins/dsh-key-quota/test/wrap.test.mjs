import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { gateStream, quotaFinishChunk } from '../lib/wrap.js'

async function collect(gen) {
  const out = []
  for await (const chunk of gen) out.push(chunk)
  return out
}

describe('gateStream', () => {
  it('does not call the model when the key is over quota', async () => {
    let called = false
    const chunks = await collect(gateStream({ provider: 'deepseek', sessionId: 's' }, async function* () {
      called = true
      yield { type: 'text-delta', text: 'hi' }
    }, {
      quotaBaseUrl: 'http://127.0.0.1:18790',
      apiKey: 'sk-colleague-ab12',
      period: '2026-10',
      pendingTotal: 0,
      snap: { used: 1000, limitTokens: 1000, blocked: false, period: '2026-10' },
      lastServer: null,
      report: async () => { throw new Error('should not report') },
    }))
    assert.equal(called, false)
    assert.equal(chunks.length, 1)
    assert.equal(chunks[0].reason.failure.code, 'quota_exceeded')
    assert.equal(chunks[0].type, 'finish')
  })

  it('passes the stream through and reports total without reasoning', async () => {
    const reports = []
    const chunks = await collect(gateStream({ provider: 'deepseek', purpose: 'session-title' }, async function* () {
      yield { type: 'text-delta', text: '标题' }
      yield {
        type: 'usage',
        usage: { inputTokens: 1826, outputTokens: 361, cacheReadTokens: 19840, reasoningTokens: 70 },
      }
    }, {
      quotaBaseUrl: 'http://127.0.0.1:18790',
      apiKey: 'sk-colleague-ab12',
      period: '2026-10',
      pendingTotal: 0,
      snap: { used: 0, limitTokens: null, blocked: false, period: '2026-10' },
      lastServer: null,
      report: async (row) => { reports.push(row) },
    }))
    assert.equal(chunks.length, 2)
    assert.equal(reports.length, 1)
    assert.equal(reports[0].total_tokens, 22027)
    assert.equal(reports[0].reasoning_tokens, 70)
    assert.equal(reports[0].source, 'dsh_title')
    assert.equal(reports[0].tail, 'ab12')
    assert.equal(JSON.stringify(reports[0]).includes('sk-colleague'), false)
  })

  it('does not touch a non-deepseek call', async () => {
    let called = false
    const chunks = await collect(gateStream({ provider: 'zhipu' }, async function* () {
      called = true
      yield { type: 'text-delta', text: 'ok' }
    }, {
      quotaBaseUrl: 'http://127.0.0.1:18790',
      apiKey: 'sk-colleague-ab12',
      period: '2026-10',
      pendingTotal: 0,
      snap: { used: 9999, limitTokens: 1, blocked: false, period: '2026-10' },
      lastServer: null,
      report: async () => { throw new Error('should not report') },
    }))
    assert.equal(called, true)
    assert.equal(chunks[0].text, 'ok')
  })

  it('lets chat continue when no quota url is configured', async () => {
    const chunks = await collect(gateStream({}, async function* () {
      yield { type: 'text-delta', text: 'free' }
    }, {
      quotaBaseUrl: '',
      apiKey: '',
      period: '2026-10',
      pendingTotal: 0,
      snap: null,
      lastServer: null,
      report: async () => { throw new Error('should not report') },
    }))
    assert.equal(chunks[0].text, 'free')
  })

  it('builds a finish chunk the host already understands', () => {
    const chunk = quotaFinishChunk('quota_exceeded', '本月 token 已用完：已用 1，上限 1。')
    assert.equal(chunk.type, 'finish')
    assert.equal(chunk.reason.kind, 'error')
    assert.equal(chunk.reason.failure.code, 'quota_exceeded')
  })
})
