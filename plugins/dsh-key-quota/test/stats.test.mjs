import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatDialogues, peopleUsage, summarizeUsage } from '../lib/stats.js'

const now = new Date('2026-10-22T04:00:00.000Z')

describe('usage charts', () => {
  it('sums one Shanghai day into the hour bucket and the day card', () => {
    const summary = summarizeUsage([{
      ts: '2026-10-22T08:30:00+08:00',
      source: 'llm',
      model: 'deepseek-chat',
      userId: 'u_admin',
      prompt: 1000,
      completion: 500,
      cacheRead: 0,
      total: 1500,
      jobId: 'meter_1',
      lane: 'dsh_chat',
    }], { on: '2026-10-22', grain: 'day', userId: 'u_admin', now })

    assert.equal(summary.today.llm.calls, 1)
    assert.equal(summary.today.llm.tokens, 1500)
    assert.equal(summary.today.cursor.calls, 0)
    assert.equal(summary.hourly[8].llm_tokens, 1500)
    assert.equal(summary.hourly[8].llm_cache_miss, 1000)
    assert.equal(summary.hourly[8].llm_output, 500)
    assert.equal(summary.llm.models[0].model, 'deepseek-chat')
    assert.equal(summary.detail[0].sessionId, '')
    assert.equal(summary.detail[0].messageId, '')
    assert.equal(
      summary.detail[0].input + summary.detail[0].cacheRead + summary.detail[0].cacheWrite + summary.detail[0].output,
      summary.detail[0].tokens,
    )
    assert.equal(summary.monthly.length >= 22, true)
  })

  it('treats a timestamp without a zone as Shanghai local time', () => {
    const summary = summarizeUsage([{
      ts: '2026-10-22T00:30:00',
      source: 'llm',
      model: 'deepseek-chat',
      userId: 'u_admin',
      prompt: 10,
      completion: 5,
      cacheRead: 0,
      total: 15,
      jobId: 'meter_naive',
      lane: 'dsh_chat',
    }], { on: '2026-10-22', grain: 'day', userId: 'u_admin', now })
    assert.equal(summary.today.llm.tokens, 15)
    assert.equal(summary.hourly[0].llm_tokens, 15)
  })

  it('keeps another person off the personal day and lists both on the people bars', () => {
    const events = [{
      ts: '2026-10-22T08:00:00+08:00',
      source: 'llm',
      model: 'deepseek-v4-flash',
      userId: 'u_admin',
      prompt: 100,
      completion: 50,
      cacheRead: 0,
      total: 150,
    }, {
      ts: '2026-10-22T11:00:00+08:00',
      source: 'llm',
      model: 'deepseek-chat',
      userId: 'u_hebo',
      prompt: 20,
      completion: 10,
      cacheRead: 0,
      total: 30,
    }]
    const mine = summarizeUsage(events, { on: '2026-10-22', grain: 'day', userId: 'u_admin', now })
    assert.equal(mine.today.llm.tokens, 150)
    const all = summarizeUsage(events, { on: '2026-10-22', grain: 'month', userId: null, now })
    assert.equal(all.today.llm.tokens, 180)
    const people = peopleUsage(events, [
      { id: 'u_admin', username: 'admin', displayName: '管理员' },
      { id: 'u_hebo', username: 'hebo', displayName: 'Hebo' },
    ], '2026-10-22', '2026-10-22')
    assert.equal(people.length, 2)
    assert.equal(people.find((row) => row.user_id === 'u_hebo').llm_tokens, 30)
    assert.equal(people.find((row) => row.user_id === 'u_admin').llm_calls, 1)
  })

  it('names a dialogue by round and step, not by the session sequence', () => {
    assert.equal(formatDialogues([
      { turn: 1, step: 1 },
      { turn: 1, step: 2 },
      { turn: 1, step: 3 },
      { turn: 1, step: 4 },
    ]), '第1轮第1–4步')
    assert.equal(formatDialogues([{ turn: 1, step: 2 }, { turn: 2, step: 1 }]), '第1轮第2步；第2轮第1步')
    assert.equal(formatDialogues([{ step: 21 }, { messageId: '21' }]), '')
  })
})
