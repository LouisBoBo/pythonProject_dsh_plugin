import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { Ledger } from '../lib/ledger.js'
import { startQuotaServer } from '../lib/server.js'

describe('desktop page origin', () => {
  it('echoes dsh-app://app and refuses other sites', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kq-cors-'))
    const server = startQuotaServer({
      listen: '127.0.0.1',
      port: 0,
      deps: { ledger: new Ledger(dir), reportToken: 't', role: 'client' },
      apiKey: () => 'sk-test-key-1234',
      clientPanel: async () => ({ ok: true, self: { tail: '1234' }, keys: null, canAppoint: false }),
    })
    try {
      await new Promise((resolve, reject) => {
        if (server.listening) resolve()
        else {
          server.once('listening', resolve)
          server.once('error', reject)
        }
      })
      const addr = server.address()
      assert.ok(addr && typeof addr === 'object')
      const url = `http://127.0.0.1:${addr.port}/v1/local/panel`

      const page = await fetch(url, { headers: { origin: 'dsh-app://app' } })
      assert.equal(page.status, 200)
      assert.equal(page.headers.get('access-control-allow-origin'), 'dsh-app://app')
      const body = await page.json()
      assert.equal(body.self.tail, '1234')

      const loopback = await fetch(url, { headers: { origin: 'http://127.0.0.1:63689' } })
      assert.equal(loopback.headers.get('access-control-allow-origin'), 'http://127.0.0.1:63689')

      const other = await fetch(url, { headers: { origin: 'https://evil.example' } })
      assert.equal(other.headers.get('access-control-allow-origin'), 'http://127.0.0.1')
    } finally {
      await new Promise((resolve) => server.close(resolve))
      await rm(dir, { recursive: true, force: true })
    }
  })
})
