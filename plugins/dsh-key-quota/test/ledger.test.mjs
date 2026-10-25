import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { Ledger } from '../lib/ledger.js'
import { periodOf } from '../lib/period.js'

async function fresh() {
  const dir = await mkdtemp(join(tmpdir(), 'kq-'))
  const ledger = new Ledger(dir)
  return { dir, ledger }
}

describe('periodOf', () => {
  it('uses Asia/Shanghai month boundaries', () => {
    assert.equal(periodOf(new Date('2026-09-30T15:59:59.000Z')), '2026-09')
    assert.equal(periodOf(new Date('2026-09-30T16:00:00.000Z')), '2026-10')
  })
})

describe('ledger', () => {
  it('counts a call once and keeps reasoning out of the added total', async () => {
    const { dir, ledger } = await fresh()
    try {
      const first = await ledger.report({
        callId: 'c1',
        keyId: 'k1',
        tail: 'ab12',
        period: '2026-10',
        source: 'dsh_chat',
        model: 'deepseek-chat',
        quality: 'provider',
        prompt_tokens: 1826,
        completion_tokens: 361,
        cache_read_tokens: 19840,
        cache_write_tokens: 0,
        reasoning_tokens: 70,
        total_tokens: 22027,
      })
      const second = await ledger.report({
        callId: 'c1',
        keyId: 'k1',
        tail: 'ab12',
        period: '2026-10',
        source: 'dsh_chat',
        model: 'deepseek-chat',
        quality: 'provider',
        prompt_tokens: 1,
        completion_tokens: 1,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        reasoning_tokens: 0,
        total_tokens: 2,
      })
      assert.equal(first.duplicate, false)
      assert.equal(first.used, 22027)
      assert.equal(second.duplicate, true)
      assert.equal(second.used, 22027)
      const row = ledger.get('k1')
      assert.equal(row?.role, 'member')
      assert.equal(row?.limitTokens, null)
      const raw = await readFile(join(dir, 'state.json'), 'utf8')
      assert.equal(raw.includes('sk-'), false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('does not add usage when quality is missing', async () => {
    const { dir, ledger } = await fresh()
    try {
      const out = await ledger.report({
        callId: 'c0',
        keyId: 'k1',
        tail: 'ab12',
        period: '2026-10',
        source: 'dsh_chat',
        model: 'deepseek-chat',
        quality: 'missing',
        prompt_tokens: 0,
        completion_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        reasoning_tokens: 0,
        total_tokens: 0,
      })
      assert.equal(out.used, 0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps a single admin', async () => {
    const { dir, ledger } = await fresh()
    try {
      await ledger.ensure('k1', 'aaaa', '2026-10')
      await ledger.ensure('k2', 'bbbb', '2026-10')
      assert.equal((await ledger.appoint('k1')).ok, true)
      assert.equal((await ledger.appoint('k2')).ok, true)
      assert.equal(ledger.get('k1')?.role, 'member')
      assert.equal(ledger.get('k2')?.role, 'admin')
      assert.equal((await ledger.appoint('missing')).ok, false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('stores months separately', async () => {
    const { dir, ledger } = await fresh()
    try {
      await ledger.report({
        callId: 's',
        keyId: 'k1',
        tail: 'ab12',
        period: '2026-09',
        source: 'dsh_chat',
        model: 'deepseek-chat',
        quality: 'provider',
        prompt_tokens: 5,
        completion_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        reasoning_tokens: 0,
        total_tokens: 5,
      })
      await ledger.report({
        callId: 'o',
        keyId: 'k1',
        tail: 'ab12',
        period: '2026-10',
        source: 'dsh_chat',
        model: 'deepseek-chat',
        quality: 'provider',
        prompt_tokens: 7,
        completion_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        reasoning_tokens: 0,
        total_tokens: 7,
      })
      assert.equal(ledger.used('k1', '2026-09'), 5)
      assert.equal(ledger.used('k1', '2026-10'), 7)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
