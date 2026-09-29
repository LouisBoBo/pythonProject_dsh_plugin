import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { buildEvent } from '../lib/event.js'
import { JsonlStore } from '../lib/store.js'

const scratch = []

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'llm-meter-'))
  scratch.push(dir)
  return dir
}

after(async () => {
  await Promise.all(scratch.map((dir) => rm(dir, { recursive: true, force: true })))
})

function sampleEvent(id = 'meter_test_1') {
  return {
    ...buildEvent({
      meta: {
        source: 'dsh_chat',
        sessionId: 's1',
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        promptChars: 12,
      },
      usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 0, reasoning: 0, total: 6 },
      started: 0,
      ended: 10,
      finishKind: 'stop',
      errMsg: '',
      ok: true,
      now: new Date('2026-09-17T04:00:00.123Z'),
    }),
    id,
  }
}

describe('buildEvent schema', () => {
  it('emits v:1 fields with Shanghai offset and disjoint totals', () => {
    const event = buildEvent({
      meta: {
        source: 'dsh_chat',
        sessionId: 's1',
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        promptChars: 12,
      },
      usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 0, reasoning: 0, total: 6 },
      started: 0,
      ended: 10,
      finishKind: 'stop',
      errMsg: '',
      ok: true,
      now: new Date('2026-09-17T04:00:00.123Z'),
    })
    assert.equal(event.v, 1)
    assert.match(event.id, /^meter_\d{14}_[0-9a-f]{6}$/)
    assert.equal(event.ts, '2026-09-17T12:00:00.123+08:00')
    assert.equal(event.quality, 'provider')
    assert.equal(event.prompt_tokens, 1)
    assert.equal(event.cache_read_tokens, 3)
    assert.equal(event.total_tokens, 6)
    assert.equal(event.duration_ms, 10)
    assert.equal('messages' in event, false)
    assert.equal('apiKey' in event, false)
  })

  it('marks missing usage without inventing tokens', () => {
    const event = buildEvent({
      meta: { source: 'dsh_other', sessionId: '', provider: '', model: '', promptChars: 0 },
      usage: null,
      started: 0,
      ended: 1,
      finishKind: 'error',
      errMsg: 'no route',
      ok: false,
    })
    assert.equal(event.quality, 'missing')
    assert.equal(event.total_tokens, 0)
    assert.equal(event.ok, false)
  })
})

describe('JsonlStore', () => {
  it('appends one JSON object per line in order', async () => {
    const dir = await tempDir()
    const path = join(dir, 'events.jsonl')
    const store = new JsonlStore(path, 1024 * 1024)
    await store.append(sampleEvent('a'))
    await store.append(sampleEvent('b'))
    await store.flush()
    const lines = (await readFile(path, 'utf8')).trim().split('\n')
    assert.equal(lines.length, 2)
    assert.equal(JSON.parse(lines[0]).id, 'a')
    assert.equal(JSON.parse(lines[1]).id, 'b')
  })

  it('rotates to events.jsonl.<utc> and does not delete the old file', async () => {
    const dir = await tempDir()
    const path = join(dir, 'events.jsonl')
    const first = `${JSON.stringify(sampleEvent('old'))}\n`
    await writeFile(path, first)
    const store = new JsonlStore(path, Buffer.byteLength(first, 'utf8'))
    await store.append(sampleEvent('new'))
    await store.flush()
    const names = (await readdir(dir)).sort()
    assert.ok(names.includes('events.jsonl'))
    const rotated = names.filter((n) => n.startsWith('events.jsonl.'))
    assert.equal(rotated.length, 1)
    assert.match(rotated[0], /^events\.jsonl\.\d{8}T\d{6}Z$/)
    const current = JSON.parse((await readFile(path, 'utf8')).trim())
    assert.equal(current.id, 'new')
    const archived = JSON.parse((await readFile(join(dir, rotated[0]), 'utf8')).trim())
    assert.equal(archived.id, 'old')
  })

  it('swallows append errors so callers are not rejected', async () => {
    const dir = await tempDir()
    const blocker = join(dir, 'notdir')
    await writeFile(blocker, 'x')
    const store = new JsonlStore(join(blocker, 'events.jsonl'), 1024)
    await store.append(sampleEvent())
    await store.flush()
  })
})
