import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { resolveAssignedKey, usesDeepseekApiKey } from '../lib/bind.js'
import { dispatch } from '../lib/http.js'
import { keyIdOf, tailOf } from '../lib/key-id.js'
import { Ledger } from '../lib/ledger.js'
import { KeyVault } from '../lib/vault.js'

const heboKey = 'sk-hebo-key-e761'
const adminKey = 'sk-admin-key-da22'

async function vaultDir() {
  return mkdtemp(join(tmpdir(), 'kq-vault-'))
}

describe('assigned key', () => {
  it('binds the official route and leaves the account route alone', () => {
    assert.equal(usesDeepseekApiKey({ provider: 'deepseek-official' }), true)
    assert.equal(usesDeepseekApiKey({ provider: 'deepseek-account' }), false)
    assert.equal(usesDeepseekApiKey({ provider: 'zhipu' }), false)
    assert.equal(usesDeepseekApiKey({}), false)
  })

  it('returns only the key sealed for the logged-in account', async () => {
    const dir = await vaultDir()
    try {
      const vault = new KeyVault(dir)
      const ledger = new Ledger(dir)
      await ledger.assign({
        keyId: keyIdOf(heboKey),
        tail: tailOf(heboKey),
        assigneeUserId: 'u_hebo',
        assigneeName: 'Hebo',
        limitTokens: 50000000,
        sealed: vault.seal(heboKey),
      })
      await ledger.assign({
        keyId: keyIdOf(adminKey),
        tail: tailOf(adminKey),
        assigneeUserId: 'u_admin',
        assigneeName: '管理员',
        limitTokens: 50000000,
        sealed: vault.seal(adminKey),
      })
      const rows = ledger.entries()
      const hebo = resolveAssignedKey({ viewerId: 'u_hebo', rows, open: (sealed) => vault.open(sealed) })
      const admin = resolveAssignedKey({ viewerId: 'u_admin', rows, open: (sealed) => vault.open(sealed) })
      assert.equal(hebo.ok, true)
      assert.equal(hebo.apiKey, heboKey)
      assert.equal(admin.ok, true)
      assert.equal(admin.apiKey, adminKey)
      assert.equal(JSON.stringify(rows).includes(heboKey), false)
      assert.equal(JSON.stringify(rows).includes(adminKey), false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses when the account has no saved key', async () => {
    const dir = await vaultDir()
    try {
      const vault = new KeyVault(dir)
      const missing = resolveAssignedKey({
        viewerId: 'u_hebo',
        rows: [{
          keyId: keyIdOf(adminKey),
          tail: tailOf(adminKey),
          assigneeUserId: 'u_admin',
          sealed: vault.seal(adminKey),
        }],
        open: (sealed) => vault.open(sealed),
      })
      assert.equal(missing.ok, false)
      assert.equal(missing.code, 'key_unassigned')
      const unsigned = resolveAssignedKey({ viewerId: '', rows: [], open: () => adminKey })
      assert.equal(unsigned.ok, false)
      assert.equal(unsigned.code, 'not_signed_in')
      assert.equal(unsigned.apiKey, undefined)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses a seal that does not open to the stored key id', async () => {
    const dir = await vaultDir()
    try {
      const vault = new KeyVault(dir)
      const other = new KeyVault(await mkdtemp(join(tmpdir(), 'kq-vault-other-')))
      const mismatch = resolveAssignedKey({
        viewerId: 'u_hebo',
        rows: [{
          keyId: keyIdOf(heboKey),
          tail: tailOf(heboKey),
          assigneeUserId: 'u_hebo',
          sealed: other.seal(heboKey),
        }],
        open: (sealed) => vault.open(sealed),
      })
      assert.equal(mismatch.ok, false)
      assert.equal(mismatch.code, 'key_unassigned')
      const swapped = resolveAssignedKey({
        viewerId: 'u_hebo',
        rows: [{
          keyId: keyIdOf(heboKey),
          tail: tailOf(heboKey),
          assigneeUserId: 'u_hebo',
          sealed: vault.seal(adminKey),
        }],
        open: (sealed) => vault.open(sealed),
      })
      assert.equal(swapped.ok, false)
      assert.equal(swapped.code, 'key_unassigned')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses when one account matches more than one key', () => {
    const doubled = resolveAssignedKey({
      viewerId: 'u_hebo',
      rows: [
        { keyId: 'a', tail: 'aaaa', assigneeUserId: 'u_hebo', sealed: 'one' },
        { keyId: 'b', tail: 'bbbb', assigneeUserId: 'u_hebo', sealed: 'two' },
      ],
      open: () => 'sk-should-not-be-used',
    })
    assert.equal(doubled.ok, false)
    assert.equal(doubled.code, 'key_ambiguous')
    assert.equal(doubled.apiKey, undefined)
  })

  it('stores the key for the page without sending the secret back', async () => {
    const dir = await vaultDir()
    try {
      const vault = new KeyVault(dir)
      const ledger = new Ledger(dir)
      const session = () => ({
        viewer: { id: 'u_admin', displayName: '管理员', role: 'admin' },
        colleagues: [{ id: 'u_hebo', displayName: 'Hebo' }],
      })
      const added = await dispatch({
        method: 'POST',
        path: '/v1/local/keys',
        headers: {},
        body: { apiKey: heboKey, assigneeUserId: 'u_hebo', limitTokens: 1000 },
        remoteAddress: '127.0.0.1',
      }, { ledger, reportToken: 't', role: 'server', session, seal: (apiKey) => vault.seal(apiKey) })
      assert.equal(added.body.ok, true)
      assert.equal(JSON.stringify(added.body).includes(heboKey), false)
      const panel = await dispatch({
        method: 'GET',
        path: '/v1/local/panel',
        headers: {},
        body: null,
        remoteAddress: '127.0.0.1',
      }, { ledger, reportToken: 't', role: 'server', session })
      assert.equal(JSON.stringify(panel.body).includes(heboKey), false)
      assert.equal(JSON.stringify(panel.body).includes('sealed'), false)
      assert.equal(panel.body.keys[0].ready, true)
      assert.equal(panel.body.keys[0].tail, 'e761')
      const bound = resolveAssignedKey({
        viewerId: 'u_hebo',
        rows: ledger.entries(),
        open: (sealed) => vault.open(sealed),
      })
      assert.equal(bound.ok, true)
      assert.equal(bound.apiKey, heboKey)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
