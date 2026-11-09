import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  appendSdkUsage,
  ledgerFiles,
  pickSdkUsage,
  sanitizeLedgerKey,
  sdkLedgerRow,
} from '../lib/usageLedger.js'

test('sdkLedgerRow refuses zero totals and maps fields', () => {
  assert.equal(sdkLedgerRow({
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    jobKey: 'cch-1-run-a',
    model: 'composer-2.5',
    userId: 'u_admin',
  }), null)

  const row = sdkLedgerRow({
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 20,
      cacheWriteTokens: 0,
      reasoningTokens: 3,
    },
    jobKey: 'cch-20261107-1-run-xyz',
    model: 'composer-2.5',
    userId: 'u_admin',
    nowMs: Date.parse('2026-11-07T12:00:00+08:00'),
  })
  assert.ok(row)
  assert.equal(row.source, 'cursor')
  assert.equal(row.quality, 'sdk')
  assert.equal(row.prompt_tokens, 10)
  assert.equal(row.completion_tokens, 5)
  assert.equal(row.cache_read_tokens, 20)
  assert.equal(row.reasoning_tokens, 3)
  assert.equal(row.total_tokens, 35)
  assert.equal(row.job_id.startsWith('cch-'), true)
})

test('pickSdkUsage takes first non-zero candidate', () => {
  assert.equal(pickSdkUsage(null, { inputTokens: 0 }), null)
  const u = pickSdkUsage({ inputTokens: 0 }, { inputTokens: 4, outputTokens: 1 })
  assert.equal(u && u.inputTokens, 4)
})

test('sanitizeLedgerKey stays unique and safe', () => {
  const a = sanitizeLedgerKey('cch-20261107-112800-ab', 'run-1')
  const b = sanitizeLedgerKey('cch-20261107-112800-ab', 'run-2')
  assert.notEqual(a, b)
  assert.match(a, /^[A-Za-z0-9._-]+$/)
})

test('appendSdkUsage writes once then dedupes', async () => {
  const home = await mkdtemp(join(tmpdir(), 'cch-usage-'))
  const desktop = join(home, 'Library', 'Application Support', 'zr-workbuddy-desktop')
  const root = join(desktop, 'runtime-app', 'apps', 'zr-workbuddy', 'engine', 'data')
  try {
    const first = appendSdkUsage({
      usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 50, cacheWriteTokens: 0 },
      jobKey: 'cch-job1-runA',
      model: 'composer-2.5',
      home,
      env: {},
      userId: 'u_admin',
      nowMs: Date.parse('2026-11-07T13:00:00+08:00'),
    })
    assert.equal(first.appended, 1)
    const second = appendSdkUsage({
      usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 50, cacheWriteTokens: 0 },
      jobKey: 'cch-job1-runA',
      model: 'composer-2.5',
      home,
      env: {},
      userId: 'u_admin',
    })
    assert.equal(second.appended, 0)
    const files = ledgerFiles({}, home)
    assert.equal(files.length >= 1, true)
    const text = await readFile(files[0], 'utf8')
    assert.equal(text.trim().split('\n').length, 1)
    assert.equal(text.includes('"source":"cursor"'), true)
    assert.equal(text.includes('"quality":"sdk"'), true)
    void root
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
