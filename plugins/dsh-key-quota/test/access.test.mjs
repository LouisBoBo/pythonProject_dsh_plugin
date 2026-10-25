import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { dispatch } from '../lib/http.js'
import { Ledger } from '../lib/ledger.js'

const token = 'report-token-test'

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'kq-http-'))
  const ledger = new Ledger(dir)
  await ledger.ensure('member-key', 'mmmm', '2026-10')
  await ledger.ensure('admin-key', 'aaaa', '2026-10')
  await ledger.appoint('admin-key')
  await ledger.report({
    callId: 'm1',
    keyId: 'member-key',
    tail: 'mmmm',
    period: '2026-10',
    source: 'dsh_chat',
    model: 'deepseek-chat',
    quality: 'provider',
    prompt_tokens: 10,
    completion_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    reasoning_tokens: 0,
    total_tokens: 10,
  })
  return { dir, ledger }
}

function call(ledger, over) {
  return dispatch({
    method: over.method,
    path: over.path,
    headers: over.headers || {},
    body: over.body,
    remoteAddress: over.remoteAddress || '192.168.1.30',
  }, { ledger, reportToken: token, role: 'server', now: () => new Date('2026-10-22T02:00:00.000Z') })
}

describe('access', () => {
  it('hides other keys from a member', async () => {
    const { dir, ledger } = await setup()
    try {
      const listed = await call(ledger, {
        method: 'GET',
        path: '/v1/admin/keys',
        headers: { authorization: `Bearer ${token}`, 'x-key-id': 'member-key' },
      })
      assert.equal(listed.body.error.code, 'not_admin')
      assert.equal(JSON.stringify(listed.body).includes('admin-key'), false)
      assert.equal(JSON.stringify(listed.body).includes('aaaa'), false)

      const mine = await call(ledger, {
        method: 'GET',
        path: '/v1/me',
        headers: { authorization: `Bearer ${token}`, 'x-key-id': 'member-key' },
      })
      assert.equal(mine.body.tail, 'mmmm')
      assert.equal(mine.body.used, 10)
      assert.equal(JSON.stringify(mine.body).includes('admin-key'), false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects a report that names a different key', async () => {
    const { dir, ledger } = await setup()
    try {
      const res = await call(ledger, {
        method: 'POST',
        path: '/v1/report',
        headers: { authorization: `Bearer ${token}`, 'x-key-id': 'member-key' },
        body: {
          callId: 'x',
          keyId: 'admin-key',
          tail: 'aaaa',
          period: '2026-10',
          source: 'dsh_chat',
          model: 'deepseek-chat',
          quality: 'provider',
          prompt_tokens: 4,
          completion_tokens: 0,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          reasoning_tokens: 0,
          total_tokens: 4,
        },
      })
      assert.equal(res.body.error.code, 'not_owner')
      assert.equal(ledger.used('admin-key', '2026-10'), 0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('lets only the admin key change a limit', async () => {
    const { dir, ledger } = await setup()
    try {
      const denied = await call(ledger, {
        method: 'PATCH',
        path: '/v1/admin/keys/member-key',
        headers: { authorization: `Bearer ${token}`, 'x-key-id': 'member-key' },
        body: { limitTokens: 5 },
      })
      assert.equal(denied.body.error.code, 'not_admin')
      assert.equal(ledger.get('member-key')?.limitTokens, null)

      const ok = await call(ledger, {
        method: 'PATCH',
        path: '/v1/admin/keys/member-key',
        headers: { authorization: `Bearer ${token}`, 'x-key-id': 'admin-key' },
        body: { alias: '张三', limitTokens: 1000 },
      })
      assert.equal(ok.body.ok, true)
      assert.equal(ledger.get('member-key')?.alias, '张三')
      assert.equal(ledger.get('member-key')?.limitTokens, 1000)

      const role = await call(ledger, {
        method: 'PATCH',
        path: '/v1/admin/keys/member-key',
        headers: { authorization: `Bearer ${token}`, 'x-key-id': 'admin-key' },
        body: { role: 'admin' },
      })
      assert.equal(role.body.error.code, 'role_change_forbidden')
      assert.equal(ledger.get('member-key')?.role, 'member')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('appoints an admin only from loopback', async () => {
    const { dir, ledger } = await setup()
    try {
      const remote = await call(ledger, {
        method: 'POST',
        path: '/v1/local/admin',
        remoteAddress: '10.0.0.8',
        headers: { authorization: `Bearer ${token}`, 'x-key-id': 'admin-key' },
        body: { keyId: 'member-key' },
      })
      assert.equal(remote.body.error.code, 'admin_appoint_local_only')
      assert.equal(ledger.get('admin-key')?.role, 'admin')

      const local = await call(ledger, {
        method: 'POST',
        path: '/v1/local/admin',
        remoteAddress: '127.0.0.1',
        body: { keyId: 'member-key' },
      })
      assert.equal(local.body.ok, true)
      assert.equal(ledger.get('member-key')?.role, 'admin')
      assert.equal(ledger.get('admin-key')?.role, 'member')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('shows every assigned key only to the platform admin', async () => {
    const { dir, ledger } = await setup()
    try {
      await ledger.assign({
        keyId: 'member-key',
        tail: 'mmmm',
        assigneeUserId: 'u_hebo',
        assigneeName: 'Hebo',
        limitTokens: null,
      })
      const people = {
        viewer: { id: 'u_hebo', displayName: 'Hebo', role: 'user' },
        colleagues: [
          { id: 'u_admin', displayName: '管理员' },
          { id: 'u_hebo', displayName: 'Hebo' },
        ],
      }
      const memberPanel = await dispatch({
        method: 'GET',
        path: '/v1/local/panel',
        headers: {},
        body: null,
        remoteAddress: '127.0.0.1',
      }, { ledger, reportToken: token, role: 'server', session: () => people })
      assert.equal(memberPanel.body.keys, null)
      assert.equal(memberPanel.body.self.tail, 'mmmm')
      assert.equal(memberPanel.body.self.used, 10)
      assert.equal(JSON.stringify(memberPanel.body).includes('admin-key'), false)
      assert.equal(JSON.stringify(memberPanel.body).includes('sk-secret-value'), false)

      const adminPanel = await dispatch({
        method: 'GET',
        path: '/v1/local/panel',
        headers: {},
        body: null,
        remoteAddress: '127.0.0.1',
      }, {
        ledger,
        reportToken: token,
        role: 'server',
        session: () => ({ ...people, viewer: { id: 'u_admin', displayName: '管理员', role: 'admin' } }),
      })
      assert.equal(adminPanel.body.viewer.admin, true)
      assert.equal(adminPanel.body.keys.length, 2)
      assert.equal(adminPanel.body.colleagues.length, 2)
      assert.equal(Object.hasOwn(adminPanel.body, 'reportToken'), false)

      const secret = 'sk-secret-value'
      const added = await dispatch({
        method: 'POST',
        path: '/v1/local/keys',
        headers: {},
        body: { apiKey: secret, assigneeUserId: 'u_hebo', limitTokens: 1000 },
        remoteAddress: '127.0.0.1',
      }, {
        ledger,
        reportToken: token,
        role: 'server',
        session: () => ({ ...people, viewer: { id: 'u_admin', displayName: '管理员', role: 'admin' } }),
      })
      assert.equal(added.body.ok, true)
      assert.equal(added.body.tail, 'alue')
      assert.equal(JSON.stringify(added.body).includes(secret), false)
      assert.equal(JSON.stringify(ledger.entries()).includes(secret), false)

      const removed = await dispatch({
        method: 'DELETE',
        path: '/v1/local/keys/member-key',
        headers: {},
        body: null,
        remoteAddress: '127.0.0.1',
      }, {
        ledger,
        reportToken: token,
        role: 'server',
        session: () => ({ ...people, viewer: { id: 'u_admin', displayName: '管理员', role: 'admin' } }),
      })
      assert.equal(removed.body.ok, true)
      assert.equal(ledger.get('member-key'), undefined)

      const deniedDelete = await dispatch({
        method: 'DELETE',
        path: '/v1/local/keys/admin-key',
        headers: {},
        body: null,
        remoteAddress: '127.0.0.1',
      }, { ledger, reportToken: token, role: 'server', session: () => people })
      assert.equal(deniedDelete.body.error.code, 'not_admin')
      assert.ok(ledger.get('admin-key'))

      const denied = await dispatch({
        method: 'POST',
        path: '/v1/local/keys',
        headers: {},
        body: { apiKey: secret, assigneeUserId: 'u_hebo' },
        remoteAddress: '127.0.0.1',
      }, { ledger, reportToken: token, role: 'server', session: () => people })
      assert.equal(denied.body.error.code, 'not_admin')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
