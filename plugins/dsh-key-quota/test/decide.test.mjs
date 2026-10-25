import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { decide } from '../lib/decide.js'

const period = '2026-10'

function snap(over = {}) {
  return { used: 100, limitTokens: 1000, blocked: false, period, ...over }
}

describe('decide', () => {
  it('allows when the quota service url is empty', () => {
    const out = decide({ quotaBaseUrl: '', period, snap: null, lastServer: null, pendingTotal: 0 })
    assert.equal(out.allow, true)
    assert.equal(out.code, '')
  })

  it('denies when the service is unreachable and there is no snapshot', () => {
    const out = decide({ quotaBaseUrl: 'http://127.0.0.1:18790', period, snap: null, lastServer: null, pendingTotal: 0 })
    assert.equal(out.allow, false)
    assert.equal(out.code, 'quota_unreachable')
  })

  it('uses the last snapshot plus pending when the service is down', () => {
    const out = decide({
      quotaBaseUrl: 'http://127.0.0.1:18790',
      period,
      snap: null,
      lastServer: snap({ used: 900, limitTokens: 1000 }),
      pendingTotal: 50,
    })
    assert.equal(out.allow, true)
    assert.equal(out.used, 950)
  })

  it('blocks a key when blocked is true', () => {
    const out = decide({
      quotaBaseUrl: 'http://127.0.0.1:18790',
      period,
      snap: snap({ blocked: true, limitTokens: null }),
      lastServer: null,
      pendingTotal: 0,
    })
    assert.equal(out.allow, false)
    assert.equal(out.code, 'key_blocked')
  })

  it('allows unlimited keys', () => {
    const out = decide({
      quotaBaseUrl: 'http://127.0.0.1:18790',
      period,
      snap: snap({ limitTokens: null, used: 999999 }),
      lastServer: null,
      pendingTotal: 0,
    })
    assert.equal(out.allow, true)
    assert.equal(out.limitTokens, null)
  })

  it('denies once used plus pending reaches the limit', () => {
    const out = decide({
      quotaBaseUrl: 'http://127.0.0.1:18790',
      period,
      snap: snap({ used: 800 }),
      lastServer: null,
      pendingTotal: 200,
    })
    assert.equal(out.allow, false)
    assert.equal(out.code, 'quota_exceeded')
    assert.equal(out.used, 1000)
  })

  it('still allows the call that would cross the limit', () => {
    const out = decide({
      quotaBaseUrl: 'http://127.0.0.1:18790',
      period,
      snap: snap({ used: 900, limitTokens: 1000 }),
      lastServer: null,
      pendingTotal: 0,
    })
    assert.equal(out.allow, true)
  })

  it('ignores a snapshot from another month', () => {
    const out = decide({
      quotaBaseUrl: 'http://127.0.0.1:18790',
      period,
      snap: null,
      lastServer: snap({ period: '2026-09', used: 0, limitTokens: 1 }),
      pendingTotal: 0,
    })
    assert.equal(out.code, 'quota_unreachable')
  })
})
