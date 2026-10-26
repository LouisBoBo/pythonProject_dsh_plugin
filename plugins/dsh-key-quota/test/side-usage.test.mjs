import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  installWebSearchUsageCapture,
  isWebSearchBody,
  recordTitleUsage,
  setSideUsageUser,
  usageFromAnthropic,
} from '../lib/side-usage.js'

async function collect(gen) {
  const out = []
  for await (const chunk of gen) out.push(chunk)
  return out
}

describe('side usage', () => {
  it('records provider usage for a session-title stream and passes chunks through', async () => {
    const lines = []
    const usage = { type: 'usage', usage: { inputTokens: 120, outputTokens: 8, cacheReadTokens: 64 } }
    const chunks = await collect(recordTitleUsage(
      { purpose: 'session-title', provider: 'zhipu', model: 'glm-5.3', sessionId: 'sess-1' },
      (async function* () {
        yield { type: 'text-delta', text: '秋天' }
        yield usage
      })(),
      (line) => lines.push(line),
    ))
    assert.equal(chunks.length, 2)
    assert.equal(chunks[1], usage)
    assert.equal(lines.length, 1)
    const row = JSON.parse(lines[0])
    assert.equal(row.source, 'dsh_title')
    assert.equal(row.provider, 'zhipu')
    assert.equal(row.model, 'glm-5.3')
    assert.equal(row.task, '会话标题')
    assert.equal(row.prompt_tokens, 120)
    assert.equal(row.completion_tokens, 8)
    assert.equal(row.cache_read_tokens, 64)
    assert.equal(row.total_tokens, 192)
    assert.equal(row.quality, 'provider')
    assert.equal(row.session_id, 'sess-1')
  })

  it('does not record a normal chat stream', async () => {
    const lines = []
    const chunks = await collect(recordTitleUsage(
      { purpose: 'chat', provider: 'deepseek-official', model: 'deepseek-flash' },
      (async function* () {
        yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 } }
      })(),
      (line) => lines.push(line),
    ))
    assert.equal(chunks.length, 1)
    assert.equal(lines.length, 0)
  })

  it('does not record a title stream that never returned usage', async () => {
    const lines = []
    await collect(recordTitleUsage(
      { purpose: 'session-title', provider: 'deepseek-official', model: 'deepseek-flash' },
      (async function* () {
        yield { type: 'text-delta', text: '标题' }
      })(),
      (line) => lines.push(line),
    ))
    assert.equal(lines.length, 0)
  })

  it('ignores the tool name when it only appears in the user text', () => {
    assert.equal(isWebSearchBody(JSON.stringify({
      model: 'deepseek-flash',
      messages: [{ role: 'user', content: '请解释 web_search_20250305' }],
    })), null)
  })

  it('records anthropic usage for a web-search request and leaves the response readable', async () => {
    const lines = []
    const box = {
      fetch: async () => new Response(JSON.stringify({
        content: [{ type: 'web_search_tool_result', content: [] }],
        usage: {
          input_tokens: 300,
          output_tokens: 40,
          cache_read_input_tokens: 80,
          cache_creation_input_tokens: 16,
        },
      }), { headers: { 'content-type': 'application/json' } }),
    }
    installWebSearchUsageCapture(box, (line) => lines.push(line))
    installWebSearchUsageCapture(box, () => { throw new Error('second install must not wrap again') })
    const body = JSON.stringify({
      model: 'deepseek-v4-flash',
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: 'Perform a web search for the query: GLM' }],
    })
    const response = await box.fetch('https://api.deepseek.com/anthropic/v1/messages', {
      method: 'POST',
      body,
    })
    const json = await response.json()
    assert.equal(json.usage.input_tokens, 300)
    assert.equal(lines.length, 1)
    const row = JSON.parse(lines[0])
    assert.equal(row.task, '网页搜索')
    assert.equal(row.provider, 'deepseek-official')
    assert.equal(row.model, 'deepseek-v4-flash')
    assert.equal(row.prompt_tokens, 300)
    assert.equal(row.completion_tokens, 40)
    assert.equal(row.cache_read_tokens, 80)
    assert.equal(row.cache_write_tokens, 16)
    assert.equal(row.total_tokens, 436)
    assert.equal(usageFromAnthropic(json.usage).total, 436)
  })

  it('does not record an ordinary messages request', async () => {
    const lines = []
    const box = {
      fetch: async () => new Response(JSON.stringify({
        usage: { input_tokens: 9, output_tokens: 1 },
      })),
    }
    installWebSearchUsageCapture(box, (line) => lines.push(line))
    await box.fetch('https://api.deepseek.com/anthropic/v1/messages', {
      method: 'POST',
      body: JSON.stringify({ model: 'deepseek-flash', messages: [{ role: 'user', content: '你好' }] }),
    })
    assert.equal(lines.length, 0)
  })

  it('stamps the logged-in user and does not read usage from other hosts', async () => {
    setSideUsageUser(() => 'u_hebo')
    try {
      const lines = []
      const box = {
        fetch: async () => new Response(JSON.stringify({
          usage: { input_tokens: 3, output_tokens: 1 },
        })),
      }
      installWebSearchUsageCapture(box, (line) => lines.push(line))
      const body = JSON.stringify({
        model: 'deepseek-v4-flash',
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      })
      const ignored = await box.fetch('https://example.com/messages', { method: 'POST', body })
      assert.equal((await ignored.json()).usage.input_tokens, 3)
      assert.equal(lines.length, 0)
      await box.fetch('https://api.deepseek.com/anthropic/v1/messages', { method: 'POST', body })
      assert.equal(lines.length, 1)
      assert.equal(JSON.parse(lines[0]).user_id, 'u_hebo')
    } finally {
      setSideUsageUser(() => '')
    }
  })
})
