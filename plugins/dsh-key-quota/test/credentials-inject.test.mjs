import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveCredentialsService } from '../lib/index.js'

describe('credentials without inject', () => {
  function cordisLike(base = {}) {
    return new Proxy(base, {
      get(target, prop, receiver) {
        if (prop === 'credentials') {
          throw new Error('cannot get property "credentials" without inject')
        }
        return Reflect.get(target, prop, receiver)
      },
    })
  }

  it('resolveCredentialsService 只走 get，不触碰 ctx.credentials', () => {
    const cred = { resolve: async () => ({ value: 'sk-x', source: 'test' }) }
    const ctx = cordisLike({
      get(name) {
        return name === 'credentials' ? cred : undefined
      },
    })
    assert.equal(resolveCredentialsService(ctx), cred)
  })

  it('无 credentials 时 resolve 返回 undefined 且不抛', () => {
    const ctx = cordisLike({ get: () => undefined })
    assert.equal(resolveCredentialsService(ctx), undefined)
  })

  it('误读 ctx.credentials 会抛（对照：修复前启用失败原因）', () => {
    const ctx = cordisLike({ get: () => undefined })
    assert.throws(() => ctx.credentials, /without inject/)
  })
})
