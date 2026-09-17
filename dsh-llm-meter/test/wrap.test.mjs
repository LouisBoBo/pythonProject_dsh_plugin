import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { wrapMeteredStream } from '../lib/wrap.js'

class MemorySink {
  constructor() {
    this.events = []
    this.rejectWith = null
  }

  append(event) {
    if (this.rejectWith) return Promise.reject(this.rejectWith)
    this.events.push(event)
    return Promise.resolve()
  }
}

async function collect(iter) {
  const chunks = []
  for await (const chunk of iter) chunks.push(chunk)
  return chunks
}

const usageChunk = {
  type: 'usage',
  usage: {
    inputTokens: 1826,
    outputTokens: 361,
    cacheReadTokens: 19840,
    reasoningTokens: 70,
  },
}

describe('wrapMeteredStream', () => {
  it('yields every chunk unchanged and appends one provider row', async () => {
    const sink = new MemorySink()
    const chunks = [
      { type: 'text-delta', index: 0, text: 'hello' },
      usageChunk,
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const out = await collect(wrapMeteredStream(
      {
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        sessionId: 'session-1',
        system: 'agent loop',
      },
      () => chunks,
      { store: sink, started: Date.now() - 20 },
    ))
    assert.deepEqual(out, chunks)
    assert.equal(sink.events.length, 1)
    const row = sink.events[0]
    assert.equal(row.v, 1)
    assert.equal(row.source, 'dsh_chat')
    assert.equal(row.ok, true)
    assert.equal(row.finish, 'stop')
    assert.equal(row.quality, 'provider')
    assert.equal(row.prompt_tokens, 1826)
    assert.equal(row.cache_read_tokens, 19840)
    assert.equal(row.total_tokens, 1826 + 361 + 19840)
    assert.equal(JSON.stringify(row).includes('hello'), false)
  })

  it('records knowledge extraction and does not rewrite options', async () => {
    const sink = new MemorySink()
    const options = Object.freeze({
      provider: 'deepseek-official',
      model: 'm',
      sessionId: 's',
      system: 'You maintain a durable document-oriented knowledge base. Extract only knowledge.',
      messages: Object.freeze([]),
    })
    let seen
    await collect(wrapMeteredStream(
      options,
      () => {
        seen = options
        return [{ type: 'finish', reason: { kind: 'stop' } }]
      },
      { store: sink },
    ))
    assert.equal(seen, options)
    assert.equal(sink.events[0].source, 'dsh_knowledge')
    assert.equal(sink.events[0].quality, 'missing')
    assert.equal(sink.events[0].total_tokens, 0)
  })

  it('rethrows stream errors after writing ok:false', async () => {
    const sink = new MemorySink()
    const boom = async function* () {
      yield { type: 'text-delta', index: 0, text: 'partial' }
      throw new Error('adapter exploded')
    }
    await assert.rejects(
      () => collect(wrapMeteredStream({ sessionId: 's' }, boom, { store: sink })),
      /adapter exploded/,
    )
    assert.equal(sink.events.length, 1)
    assert.equal(sink.events[0].ok, false)
    assert.equal(sink.events[0].finish, 'throw')
    assert.match(sink.events[0].error, /adapter exploded/)
  })

  it('records finish error kind from reason.failure without throwing', async () => {
    const sink = new MemorySink()
    await collect(wrapMeteredStream(
      {},
      () => [{ type: 'finish', reason: { kind: 'error', failure: { message: 'no such model' } } }],
      { store: sink },
    ))
    assert.equal(sink.events[0].ok, false)
    assert.equal(sink.events[0].finish, 'error')
    assert.equal(sink.events[0].error, 'no such model')
  })

  it('still yields chunks when persist rejects', async () => {
    const sink = new MemorySink()
    sink.rejectWith = new Error('EACCES')
    const chunks = [
      { type: 'text-delta', index: 0, text: 'ok' },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const out = await collect(wrapMeteredStream({}, () => chunks, { store: sink }))
    assert.deepEqual(out, chunks)
  })

  it('calls next() with no arguments so the request is not rewritten', async () => {
    const sink = new MemorySink()
    let args
    const next = (...rest) => {
      args = rest
      return [{ type: 'finish', reason: { kind: 'stop' } }]
    }
    await collect(wrapMeteredStream({ system: 'x' }, next, { store: sink }))
    assert.deepEqual(args, [])
  })
})
