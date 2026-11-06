import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fetchGatewayUsage, parseGatewayProfile, usageWindow } from '../lib/gateway-catalog.js'

const PROFILE = `# patch layer
- id: ui-settings
  config:
    enabled: true
# zr-model-gateway:begin (regenerated on launch; edits inside this block are lost)
- id: llm-pi-ai
  config:
    providers:
      zr-gateway:
        displayName: 中软模型网关
        baseURL: https://175.178.238.31/v1
        api: openai-completions
        apiKeyEnv: ZR_GATEWAY_TOKEN
        models:
          - id: standard
            name: DeepSeek-V4.1-Flash
- id: llm-deepseek
  disabled: true
# zr-model-gateway:end
`

describe('gateway profile', () => {
  it('reads only the gateway origin and credential reference', () => {
    const endpoint = parseGatewayProfile(PROFILE)
    assert.deepEqual(endpoint, { origin: 'https://175.178.238.31', credentialRef: 'ZR_GATEWAY_TOKEN' })
  })

  it('ignores profiles without a gateway block', () => {
    assert.equal(parseGatewayProfile('- id: ui-settings\n  config:\n    enabled: true\n'), null)
  })

  it('rejects a non-http base URL', () => {
    assert.equal(parseGatewayProfile('zr-gateway:\n  baseURL: file:///etc/passwd\n'), null)
  })
})

describe('usage window', () => {
  it('covers one Shanghai day as [start, end)', () => {
    const win = usageWindow('2026-10-29', 'day')
    assert.equal(win.start, Date.parse('2026-10-29T00:00:00+08:00') / 1000)
    assert.equal(win.end - win.start, 86400)
  })

  it('covers the whole Shanghai month', () => {
    const win = usageWindow('2026-10-29', 'month')
    assert.equal(win.start, Date.parse('2026-10-01T00:00:00+08:00') / 1000)
    assert.equal(win.end, Date.parse('2026-11-01T00:00:00+08:00') / 1000)
  })

  it('falls back to today when the page sends no date', () => {
    const win = usageWindow('', 'day', new Date('2026-10-29T02:00:00Z'))
    assert.equal(win.start, Date.parse('2026-10-29T00:00:00+08:00') / 1000)
  })
})

describe('gateway usage', () => {
  it('requests the caller-scoped endpoint and keeps only masked keys', async () => {
    const seen = []
    const fetchImpl = async (url, init) => {
      seen.push({ url, auth: init.headers.authorization })
      return {
        ok: true,
        async json() {
          return {
            start: 1,
            end: 2,
            models: [
              {
                provider: 'deepseek-official',
                providerName: 'DeepSeek 官方',
                keyHint: 'sk-fc6ef*****d460',
                alias: 'standard',
                model: 'deepseek-v4-flash',
                purpose: 'llm',
                calls: 2,
                inputTokens: 30000,
                outputTokens: 3700,
                lastAt: 2,
              },
            ],
          }
        },
      }
    }
    const rows = await fetchGatewayUsage(
      { origin: 'https://gateway.test', credentialRef: 'ZR_GATEWAY_TOKEN' },
      'session-token',
      { start: 100, end: 200 },
      fetchImpl,
    )
    assert.equal(seen[0].url, 'https://gateway.test/v1/usage/models?start=100&end=200')
    assert.equal(seen[0].auth, 'Bearer session-token')
    assert.deepEqual(rows, [
      {
        provider: 'deepseek-official',
        providerName: 'DeepSeek 官方',
        keyHint: 'sk-fc6ef*****d460',
        alias: 'standard',
        model: 'deepseek-v4-flash',
        purpose: 'llm',
        calls: 2,
        tokens: 33700,
      },
    ])
    assert.equal(JSON.stringify(rows).includes('session-token'), false)
  })

  it('returns null when the gateway refuses or the body is wrong', async () => {
    const refused = async () => ({ ok: false, async json() { return {} } })
    const wrong = async () => ({ ok: true, async json() { return { models: 'nope' } } })
    const endpoint = { origin: 'https://gateway.test', credentialRef: 'ZR_GATEWAY_TOKEN' }
    assert.equal(await fetchGatewayUsage(endpoint, 't', { start: 1, end: 2 }, refused), null)
    assert.equal(await fetchGatewayUsage(endpoint, 't', { start: 1, end: 2 }, wrong), null)
    assert.equal(await fetchGatewayUsage(endpoint, '', { start: 1, end: 2 }, refused), null)
  })
})
