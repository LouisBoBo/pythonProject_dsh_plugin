import assert from 'node:assert/strict'
import test from 'node:test'
import {
  billableTokens,
  gatewayUserFromJwt,
  stripGatewayUsageReportUrl,
  unwrapFunctionResult,
} from '../lib/gateway-usage.js'

test('billableTokens uses CTOTAL only (matches My = SUM(CTOTAL))', () => {
  // 自统计行：CTOTAL = input + output
  assert.equal(billableTokens(1520, 380, 1900), 1900)
  // 客户端 Report 行：未传 totalTokens → CTOTAL=0，即使有 input/output 也计 0，避免双计
  assert.equal(billableTokens(1520, 380, 0), 0)
  assert.equal(billableTokens(0, 0, 100), 100)
})
import { upsertLlmRetryBlock } from '../lib/ensure-llm-retry.js'

function fakeJwt(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `hdr.${body}.sig`
}

test('gatewayUserFromJwt reads NameIdentifier claim', () => {
  const token = fakeJwt({
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier': '394439291199558',
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name': 'hebo',
  })
  assert.deepEqual(gatewayUserFromJwt(token), { id: '394439291199558', name: 'hebo' })
})

test('gatewayUserFromJwt accepts short claim names', () => {
  assert.deepEqual(gatewayUserFromJwt(fakeJwt({ nameid: 'u1', unique_name: 'alice' })), {
    id: 'u1',
    name: 'alice',
  })
})

test('unwrapFunctionResult reads Datas from host envelope', () => {
  const got = unwrapFunctionResult({
    success: true,
    code: 200,
    data: {
      Success: true,
      Content: '',
      Datas: { totalTokens: 12, breakdown: [] },
      TotalRows: 0,
    },
  })
  assert.equal(got.ok, true)
  assert.equal(got.datas.totalTokens, 12)
})

test('unwrapFunctionResult surfaces business Content', () => {
  const got = unwrapFunctionResult({
    success: true,
    data: { Success: false, Content: '开始时间不能晚于结束时间', Datas: null },
  })
  assert.equal(got.ok, false)
  assert.match(got.content, /开始时间/)
})

test('stripGatewayUsageReportUrl removes report line only inside gateway block', () => {
  const text = `# head
# zr-model-gateway:begin (regenerated on launch; edits inside this block are lost)
- id: llm-pi-ai
  config:
    providers:
      zr-gateway:
        baseURL: http://example.test/api/ai
        usageReportUrl: http://example.test/api/ai/Usage/Report
        api: openai-completions
# zr-model-gateway:end
`
  const out = stripGatewayUsageReportUrl(text)
  assert.ok(!out.includes('usageReportUrl'))
  assert.ok(out.includes('baseURL: http://example.test/api/ai'))
  assert.ok(out.includes('# zr-model-gateway:end'))
})

test('ensure pipeline strips report then upserts retry', () => {
  const text = `# zr-model-gateway:begin (regenerated on launch; edits inside this block are lost)
- id: llm-pi-ai
  config:
    providers:
      zr-gateway:
        baseURL: http://x/api/ai
        usageReportUrl: http://x/api/ai/Usage/Report
        api: openai-completions
        models:
          - id: "standard"
            name: "x"
# zr-model-gateway:end
`
  const out = upsertLlmRetryBlock(stripGatewayUsageReportUrl(text))
  assert.ok(!out.includes('usageReportUrl'))
  assert.ok(out.includes('INVALID_REQUEST'))
  assert.ok(out.includes('models:'))
})
