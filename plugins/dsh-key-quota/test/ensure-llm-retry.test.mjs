import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GATEWAY_RETRY_POLICY_YAML,
  LLM_RETRY_BEGIN,
  LLM_RETRY_END,
  stripLlmRetryBlock,
  upsertLlmRetryBlock,
} from '../lib/ensure-llm-retry.js'

const SAMPLE = `# head
- id: key-quota
  config:
    enabled: true
# zr-model-gateway:begin (regenerated on launch; edits inside this block are lost)
- id: llm-pi-ai
  config:
    providers:
      zr-gateway:
        displayName: 中软模型网关
        baseURL: http://example.test/api/ai
        models:
          - id: "standard"
            name: "Flash"
# zr-model-gateway:end
`

test('upsert injects retryPolicy before models inside the gateway block', () => {
  const out = upsertLlmRetryBlock(SAMPLE)
  assert.ok(out.includes('retryPolicy:'))
  assert.ok(out.includes('INVALID_REQUEST'))
  assert.ok(!out.includes(LLM_RETRY_BEGIN))
  const retryAt = out.indexOf('retryPolicy:')
  const modelsAt = out.indexOf('models:')
  assert.ok(retryAt > 0 && modelsAt > retryAt)
  assert.ok(out.includes('- id: "standard"'))
})

test('upsert is idempotent once retryPolicy is present', () => {
  const once = upsertLlmRetryBlock(SAMPLE)
  const twice = upsertLlmRetryBlock(once)
  assert.equal(twice, once)
  assert.equal(twice.split('retryPolicy:').length - 1, 1)
})

test('upsert removes a legacy standalone retry patch that wiped models', () => {
  const stale = `${SAMPLE}\n\n${LLM_RETRY_BEGIN}\n- id: llm-pi-ai\n  config:\n    providers:\n      zr-gateway:\n        retryPolicy:\n          mode: normal\n${LLM_RETRY_END}\n`
  const out = upsertLlmRetryBlock(stale)
  assert.ok(!out.includes(LLM_RETRY_BEGIN))
  assert.ok(!out.includes(LLM_RETRY_END))
  assert.equal(out.split('- id: llm-pi-ai').length - 1, 1)
  assert.ok(out.includes(GATEWAY_RETRY_POLICY_YAML.split('\n')[0]))
  assert.ok(out.includes('- id: "standard"'))
})

test('stripLlmRetryBlock leaves gateway content alone', () => {
  const out = stripLlmRetryBlock(`${SAMPLE}\n\n${LLM_RETRY_BEGIN}\nold\n${LLM_RETRY_END}\n`)
  assert.ok(!out.includes(LLM_RETRY_BEGIN))
  assert.ok(out.includes('zr-model-gateway:begin'))
})
