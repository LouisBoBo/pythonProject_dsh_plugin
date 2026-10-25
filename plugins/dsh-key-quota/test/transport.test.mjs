import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { installAssignedKeyTransport, pullWithAssignedKey } from '../lib/transport.js'

describe('assigned key on the model call', () => {
  it('sends the logged-in key and leaves other requests on the project key', async () => {
    const original = globalThis.fetch
    const seen = []
    globalThis.fetch = async (url, init) => {
      seen.push({ url: String(url), authorization: new Headers(init?.headers).get('authorization'), apiKey: new Headers(init?.headers).get('x-api-key') })
      return new Response('ok')
    }
    const credentials = {
      async resolve(ref) {
        return { value: 'sk-project-key-empty', source: 'file' }
      },
    }
    try {
      installAssignedKeyTransport(credentials)
      async function* call() {
        const cred = await credentials.resolve('DEEPSEEK_API_KEY')
        const other = await credentials.resolve('ZHIPU_API_KEY')
        await fetch('https://api.deepseek.com/anthropic/messages', {
          headers: { authorization: 'Bearer sk-project-key-empty', 'x-api-key': 'sk-project-key-empty' },
        })
        await fetch('https://example.com/hook', { headers: { authorization: 'Bearer leave-me' } })
        yield { cred: cred.value, other: other.value }
      }
      const chunks = []
      for await (const chunk of pullWithAssignedKey('sk-hebo-key-e761', call())) chunks.push(chunk)
      assert.equal(chunks[0].cred, 'sk-hebo-key-e761')
      assert.equal(chunks[0].other, 'sk-project-key-empty')
      assert.equal(seen[0].apiKey, 'sk-hebo-key-e761')
      assert.equal(seen[0].authorization, 'Bearer sk-hebo-key-e761')
      assert.equal(seen[1].authorization, 'Bearer leave-me')
      assert.equal(seen[1].apiKey, null)
    } finally {
      globalThis.fetch = original
    }
  })
})
