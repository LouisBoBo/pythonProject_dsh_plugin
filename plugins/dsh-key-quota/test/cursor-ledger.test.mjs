import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { cursorLedgerRow, syncCursorUsage } from '../lib/cursor-ledger.js'
import { panelUsage, loadEngineBundle } from '../lib/engine-usage.js'

describe('cursor ledger', () => {
  it('keeps Cursor input and cache read apart', () => {
    const row = cursorLedgerRow({
      timestamp: Date.parse('2026-10-25T11:25:00+08:00'),
      model: 'default',
      usageEventId: 'evt-1',
      tokenUsage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 100, cacheWriteTokens: 0 },
    }, 'u_admin')
    assert.ok(row)
    assert.equal(row.source, 'cursor')
    assert.equal(row.lane, 'cursor_code')
    assert.equal(row.prompt_tokens, 10)
    assert.equal(row.cache_read_tokens, 100)
    assert.equal(row.completion_tokens, 4)
    assert.equal(row.total_tokens, 114)
    assert.equal(row.ts, '2026-10-25T11:25:00+08:00')
    assert.equal(row.user_id, 'u_admin')
    assert.equal(cursorLedgerRow({ timestamp: 1, usageEventId: 'x', tokenUsage: {} }, 'u_admin'), null)
    const chat = cursorLedgerRow({
      timestamp: Date.parse('2026-10-25T11:25:00+08:00'),
      model: 'grok-4.7-high',
      usageEventId: 'evt-chat',
      tokenUsage: { inputTokens: 20, outputTokens: 5, cacheReadTokens: 80 },
    }, 'u_admin')
    assert.equal(chat.source, 'llm')
    assert.equal(chat.lane, 'cursor_chat')
    assert.equal(chat.total_tokens, 105)
  })

  it('writes today onto the coding card and does not write the same call twice', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kq-cursor-'))
    const root = join(dir, 'zr-workbuddy-desktop', 'persist', 'engine-data')
    await mkdir(join(root, 'usage'), { recursive: true })
    await mkdir(join(root, 'auth'), { recursive: true })
    await writeFile(join(root, 'usage', 'events.jsonl'), '')
    await writeFile(join(root, 'auth', 'active.json'), JSON.stringify({
      id: 'u_admin', role: 'admin', display_name: '管理员', exp: 4_000_000_000,
    }))
    await writeFile(join(root, 'auth', 'users.json'), JSON.stringify({
      users: [{ id: 'u_admin', username: 'admin', display_name: '管理员', role: 'admin' }],
    }))
    const ledger = join(root, 'usage', 'events.jsonl')
    const coding = {
      timestamp: String(Date.parse('2026-10-25T11:25:00+08:00')),
      model: 'default',
      usageEventId: 'evt-today',
      tokenUsage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 100 },
    }
    const chat = {
      timestamp: String(Date.parse('2026-10-25T12:00:00+08:00')),
      model: 'grok-4.7-high',
      usageEventId: 'evt-chat',
      tokenUsage: { inputTokens: 20, outputTokens: 5, cacheReadTokens: 80 },
    }
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({ totalUsageEventsCount: 2, usageEventsDisplay: [coding, chat] }),
    })
    const env = { APPDATA: dir, DSH_HOME: join(dir, 'empty') }
    try {
      const first = await syncCursorUsage({
        force: true, env, home: dir, token: 'test-token', fetchImpl, days: ['2026-10-25'],
      })
      assert.equal(first.appended, 2)
      const text = await readFile(ledger, 'utf8')
      assert.equal(text.includes('"source":"cursor"'), true)
      assert.equal(text.includes('"model":"grok-4.7-high"'), true)
      assert.equal(text.includes('test-token'), false)
      const second = await syncCursorUsage({
        force: true, env, home: dir, token: 'test-token', fetchImpl, days: ['2026-10-25'],
      })
      assert.equal(second.appended, 0)
      const bundle = loadEngineBundle(env, dir)
      const view = panelUsage('http://127.0.0.1/v1/local/panel?on=2026-10-25&scope=personal', bundle)
      assert.equal(view.usage.today.cursor.calls, 1)
      assert.equal(view.usage.today.cursor.tokens, 114)
      assert.equal(view.usage.today.llm.calls, 1)
      assert.equal(view.usage.today.llm.tokens, 105)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps a later Cursor call on the account that already owns the ledger', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kq-cursor-owner-'))
    const root = join(dir, 'zr-workbuddy-desktop', 'persist', 'engine-data')
    await mkdir(join(root, 'usage'), { recursive: true })
    await mkdir(join(root, 'auth'), { recursive: true })
    const ledger = join(root, 'usage', 'events.jsonl')
    await writeFile(ledger, JSON.stringify({
      job_id: 'cuev-old', user_id: 'u_admin', source: 'cursor', model: 'default',
      ts: '2026-10-25T01:00:00+08:00', total_tokens: 1,
    }) + '\n')
    await writeFile(join(root, 'auth', 'active.json'), JSON.stringify({
      id: 'u_hebo', role: 'user', display_name: 'Hebo', exp: 4_000_000_000,
    }))
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({
        totalUsageEventsCount: 1,
        usageEventsDisplay: [{
          timestamp: String(Date.parse('2026-10-25T12:00:00+08:00')),
          model: 'default',
          usageEventId: 'evt-next',
          tokenUsage: { inputTokens: 3, outputTokens: 1, cacheReadTokens: 0 },
        }],
      }),
    })
    try {
      const result = await syncCursorUsage({
        force: true,
        env: { APPDATA: dir, DSH_HOME: join(dir, 'empty') },
        home: dir,
        token: 'test-token',
        fetchImpl,
        days: ['2026-10-25'],
      })
      assert.equal(result.appended, 1)
      const text = await readFile(ledger, 'utf8')
      const added = text.split('\n').filter(Boolean).map((line) => JSON.parse(line)).find((row) => row.job_id === 'cuev-evt-next')
      assert.equal(added.user_id, 'u_admin')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
