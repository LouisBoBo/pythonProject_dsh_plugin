import assert from 'node:assert/strict'
import test from 'node:test'
import {
  billableTokens,
  fetchGatewayPanel,
  gatewayUserFromJwt,
  identityFromModelRow,
  identityFromUsageRow,
  overlayCursorFromLocal,
  pickApiText,
  stripGatewayUsageReportUrl,
  unwrapFunctionResult,
} from '../lib/gateway-usage.js'
import { decryptCursorSafeStorage, normalizeCursorAuthToken, panelSyncDays } from '../lib/cursor-ledger.js'
import { createCipheriv, pbkdf2Sync } from 'node:crypto'

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

test('pickApiText reads Pascal or camel keys without a hardcoded value', () => {
  assert.equal(pickApiText({ CREAL_MODEL: 'deepseek-v4-flash' }, ['CREAL_MODEL', 'realModel']), 'deepseek-v4-flash')
  assert.equal(pickApiText({ realModel: 'glm-5' }, ['CREAL_MODEL', 'realModel']), 'glm-5')
  assert.equal(pickApiText({ cvendor_no: 'DEEPSEEK' }, ['CVENDOR_NO']), 'DEEPSEEK')
  assert.equal(pickApiText({}, ['CREAL_MODEL']), '')
})

test('identityFromModelRow takes vendor and real model from the catalog row', () => {
  const id = identityFromModelRow({
    CALIAS: 'standard',
    CREAL_MODEL: 'deepseek-v4-flash',
    CVENDOR_NO: 'DEEPSEEK',
    CVENDOR_NAME: 'DeepSeek',
  })
  assert.deepEqual(id, { alias: 'standard', provider: 'deepseek', model: 'deepseek-v4-flash' })
})

test('identityFromUsageRow prefers row fields then catalog alias lookup', () => {
  const catalog = new Map([
    ['standard', { alias: 'standard', provider: 'deepseek', model: 'deepseek-v4-flash' }],
  ])
  assert.deepEqual(identityFromUsageRow({ CMODEL_ALIAS: 'standard' }, catalog), {
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
  })
  assert.deepEqual(identityFromUsageRow({
    CMODEL_ALIAS: 'standard',
    CREAL_MODEL: 'glm-5.3',
    CVENDOR_NO: 'ZHIPU',
  }, catalog), {
    provider: 'zhipu',
    model: 'glm-5.3',
  })
  assert.deepEqual(identityFromUsageRow({ CMODEL_ALIAS: 'unknown-alias' }, catalog), {
    provider: '',
    model: 'unknown-alias',
  })
})

function okBody(datas, totalRows = 0) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      data: { Success: true, Content: '', Datas: datas, TotalRows: totalRows },
    }),
  }
}

test('fetchGatewayPanel resolves standard via Models/GetModelList, never hardcodes zr-gateway', async () => {
  const token = fakeJwt({
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier': 'u1',
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name': 'lzh',
  })
  const seen = []
  const fetchImpl = async (url) => {
    const u = String(url)
    seen.push(u)
    if (u.includes('/api/ai/Models/GetModelList')) {
      return okBody([{
        CALIAS: 'standard',
        CREAL_MODEL: 'deepseek-v4-flash',
        CVENDOR_NO: 'DEEPSEEK',
        CVENDOR_NAME: 'DeepSeek',
      }], 1)
    }
    if (u.includes('/api/ai/Usage/GetUsageList')) {
      return okBody([{
        CREQUEST_ID: 'req-1',
        CUSER_ID: 'u1',
        CUSER_CREATED: 'lzh',
        CMODEL_ALIAS: 'standard',
        CINPUT_TOKENS: 10,
        COUTPUT_TOKENS: 2,
        CTOTAL_TOKENS: 12,
        CCACHED_INPUT_TOKENS: 0,
        CCLIENT_TS: Date.parse('2026-11-09T09:13:00+08:00'),
      }], 1)
    }
    if (u.includes('/api/ai/Usage/My') && u.includes('groupBy=model')) {
      return okBody({
        totalTokens: 12,
        totalCalls: 1,
        breakdown: [{ modelAlias: 'standard', totalTokens: 12, calls: 1 }],
      })
    }
    if (u.includes('/api/ai/Usage/My')) {
      return okBody({ totalTokens: 12, totalCalls: 1, breakdown: [] })
    }
    return okBody({})
  }
  const panel = await fetchGatewayPanel({
    on: '2026-11-09',
    grain: 'day',
    scope: 'personal',
    viewerAdmin: false,
    resolveToken: async () => ({ value: token }),
    endpoint: { origin: 'http://gw.test', credentialRef: 'ZR_GATEWAY_TOKEN' },
    fetchImpl,
  })
  assert.ok(panel?.loaded)
  assert.equal(panel.usage.detail[0].provider, 'deepseek')
  assert.equal(panel.usage.detail[0].model, 'deepseek-v4-flash')
  assert.equal(panel.usage.llm.models[0].provider, 'deepseek')
  assert.equal(panel.usage.llm.models[0].model, 'deepseek-v4-flash')
  assert.equal(panel.usage.llm.models[0].calls, 1)
  assert.equal(panel.usage.detail.some((row) => row.provider === 'zr-gateway'), false)
  assert.equal(panel.usage.llm.models.some((row) => row.model === 'standard'), false)
  assert.ok(seen.some((u) => u.includes('/api/ai/Models/GetModelList')))
})

test('各模型次数: Usage/My 无 calls 时按 GetUsageList 行数计次', async () => {
  const token = fakeJwt({
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier': 'u1',
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name': 'lzh',
  })
  const fetchImpl = async (url) => {
    const u = String(url)
    if (u.includes('/api/ai/Models/GetModelList')) {
      return okBody([{
        CALIAS: 'standard',
        CREAL_MODEL: 'deepseek-flash',
        CVENDOR_NO: 'DEEPSEEK',
      }], 1)
    }
    if (u.includes('/api/ai/Usage/GetUsageList')) {
      const row = (id) => ({
        CREQUEST_ID: id,
        CUSER_ID: 'u1',
        CUSER_CREATED: 'lzh',
        CMODEL_ALIAS: 'standard',
        CINPUT_TOKENS: 10,
        COUTPUT_TOKENS: 2,
        CTOTAL_TOKENS: 12,
        CCACHED_INPUT_TOKENS: 0,
        CCLIENT_TS: Date.parse('2026-11-09T09:13:00+08:00'),
      })
      return okBody([row('req-1'), row('req-2')], 2)
    }
    if (u.includes('/api/ai/Usage/My') && u.includes('groupBy=model')) {
      return okBody({
        totalTokens: 24,
        breakdown: [{ modelAlias: 'standard', totalTokens: 24 }],
      })
    }
    if (u.includes('/api/ai/Usage/My')) {
      return okBody({ totalTokens: 24, breakdown: [] })
    }
    return okBody({})
  }
  const panel = await fetchGatewayPanel({
    on: '2026-11-09',
    grain: 'day',
    scope: 'personal',
    viewerAdmin: false,
    resolveToken: async () => ({ value: token }),
    endpoint: { origin: 'http://gw.test', credentialRef: 'ZR_GATEWAY_TOKEN' },
    fetchImpl,
  })
  assert.equal(panel.usage.llm.models[0].model, 'deepseek-flash')
  assert.equal(panel.usage.llm.models[0].tokens, 24)
  assert.equal(panel.usage.llm.models[0].calls, 2)
  assert.equal(panel.usage.today.llm.calls, 2)
})

test('调用明细丢掉 CTOTAL=0 的失败行，次数与卡片一致', async () => {
  const token = fakeJwt({
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier': 'u1',
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name': 'lzh',
  })
  const fetchImpl = async (url) => {
    const u = String(url)
    if (u.includes('/api/ai/Models/GetModelList')) {
      return okBody([{ CALIAS: 'standard', CREAL_MODEL: 'deepseek-flash', CVENDOR_NO: 'DEEPSEEK' }], 1)
    }
    if (u.includes('/api/ai/Usage/GetUsageList')) {
      const billed = {
        CREQUEST_ID: 'ok-1',
        CUSER_ID: 'u1',
        CUSER_CREATED: 'lzh',
        CMODEL_ALIAS: 'standard',
        CINPUT_TOKENS: 10,
        COUTPUT_TOKENS: 2,
        CTOTAL_TOKENS: 12,
        CSTATUS: 'ok',
        CCLIENT_TS: Date.parse('2026-11-09T09:13:00+08:00'),
      }
      const failed = {
        CREQUEST_ID: 'err-1',
        CUSER_ID: 'u1',
        CUSER_CREATED: 'lzh',
        CMODEL_ALIAS: 'standard',
        CINPUT_TOKENS: 0,
        COUTPUT_TOKENS: 0,
        CTOTAL_TOKENS: 0,
        CSTATUS: 'error',
        CCLIENT_TS: Date.parse('2026-11-09T09:13:00+08:00'),
      }
      return okBody([billed, failed, { ...failed, CREQUEST_ID: 'err-2' }], 3)
    }
    if (u.includes('/api/ai/Usage/My') && u.includes('groupBy=model')) {
      return okBody({ totalTokens: 12, breakdown: [{ modelAlias: 'standard', totalTokens: 12 }] })
    }
    if (u.includes('/api/ai/Usage/My')) {
      return okBody({ totalTokens: 12, breakdown: [] })
    }
    return okBody({})
  }
  const panel = await fetchGatewayPanel({
    on: '2026-11-09',
    grain: 'day',
    scope: 'personal',
    viewerAdmin: false,
    resolveToken: async () => ({ value: token }),
    endpoint: { origin: 'http://gw.test', credentialRef: 'ZR_GATEWAY_TOKEN' },
    fetchImpl,
  })
  assert.equal(panel.usage.detail.length, 1)
  assert.equal(panel.usage.detail[0].task, 'ok-1')
  assert.equal(panel.usage.llm.models[0].calls, 1)
  assert.equal(panel.usage.today.llm.calls, 1)
  assert.equal(panel.usage.detail.some((row) => row.tokens === 0), false)
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

test('overlayCursorFromLocal keeps gateway LLM and only fills coding', () => {
  const gateway = {
    ok: true,
    source: 'gateway',
    note: '',
    grain: 'day',
    on: '2026-11-06',
    month: '2026-11',
    month_from: '2026-11-01',
    month_to: '2026-11-06',
    today: { llm: { calls: 12, tokens: 2_980_000 }, cursor: { calls: 0, tokens: 0 } },
    hourly: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      llm_calls: hour === 10 ? 12 : 0,
      llm_tokens: hour === 10 ? 2_980_000 : 0,
      llm_cache_hit: 0,
      llm_cache_miss: 0,
      llm_output: 0,
      cursor_calls: 0,
      cursor_tokens: 0,
      cursor_cache_hit: 0,
      cursor_cache_miss: 0,
      cursor_output: 0,
      calls: hour === 10 ? 12 : 0,
    })),
    daily: [],
    monthly: [],
    llm: { models: [{ provider: 'zr-gateway', model: 'standard', tokens: 2_980_000, calls: 12 }] },
    cursor: { models: [] },
    detail: [{
      ts: '2026-11-06T10:00:00+08:00',
      provider: 'zr-gateway',
      model: 'standard',
      source: 'llm',
      lane: 'llm',
      tokens: 100,
      task: 'r1',
    }],
  }
  const local = {
    ok: true,
    grain: 'day',
    on: '2026-11-06',
    month: '2026-11',
    month_from: '2026-11-01',
    month_to: '2026-11-06',
    today: { llm: { calls: 99, tokens: 999 }, cursor: { calls: 3, tokens: 4500 } },
    hourly: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      llm_calls: 0,
      llm_tokens: 0,
      llm_cache_hit: 0,
      llm_cache_miss: 0,
      llm_output: 0,
      cursor_calls: hour === 11 ? 3 : 0,
      cursor_tokens: hour === 11 ? 4500 : 0,
      cursor_cache_hit: hour === 11 ? 1000 : 0,
      cursor_cache_miss: hour === 11 ? 2000 : 0,
      cursor_output: hour === 11 ? 1500 : 0,
      calls: hour === 11 ? 3 : 0,
    })),
    daily: [],
    monthly: [],
    llm: { models: [{ provider: 'noise', model: 'should-not-appear', tokens: 1, calls: 1 }] },
    cursor: { models: [{ provider: 'cursor', model: 'composer-1', tokens: 4500, calls: 3 }] },
    detail: [
      {
        ts: '2026-11-06T11:00:00+08:00',
        provider: 'cursor',
        model: 'composer-1',
        source: 'cursor',
        lane: 'cursor_code',
        tokens: 4500,
        task: '写码',
      },
      {
        ts: '2026-11-06T09:00:00+08:00',
        provider: 'deepseek',
        model: 'local-llm',
        source: 'llm',
        lane: 'dsh_chat',
        tokens: 999,
        task: '勿并入网关',
      },
    ],
  }
  const merged = overlayCursorFromLocal(gateway, local)
  assert.equal(merged.today.llm.calls, 12)
  assert.equal(merged.today.llm.tokens, 2_980_000)
  assert.equal(merged.today.cursor.calls, 3)
  assert.equal(merged.today.cursor.tokens, 4500)
  assert.equal(merged.llm.models[0].model, 'standard')
  assert.equal(merged.cursor.models[0].model, 'composer-1')
  assert.equal(merged.hourly[10].llm_tokens, 2_980_000)
  assert.equal(merged.hourly[10].cursor_tokens, 0)
  assert.equal(merged.hourly[11].cursor_tokens, 4500)
  assert.equal(merged.hourly[11].llm_tokens, 0)
  assert.equal(merged.hourly[11].calls, 3)
  assert.equal(merged.detail.some((row) => row.source === 'cursor'), true)
  assert.equal(merged.detail.some((row) => row.task === '勿并入网关'), false)
  assert.match(merged.note, /写码/)
})

test('overlayCursorFromLocal does not duplicate coding rows already on the ledger', () => {
  const cursorRow = {
    ts: '2026-11-06T11:00:00+08:00',
    provider: 'cursor',
    model: 'composer-1',
    source: 'cursor',
    lane: 'cursor_code',
    tokens: 4500,
    task: '写码',
  }
  const base = {
    ok: true,
    grain: 'day',
    on: '2026-11-06',
    month: '2026-11',
    month_from: '2026-11-01',
    month_to: '2026-11-06',
    today: { llm: { calls: 1, tokens: 100 }, cursor: { calls: 1, tokens: 4500 } },
    hourly: [],
    daily: [],
    monthly: [],
    llm: { models: [{ provider: 'deepseek', model: 'deepseek-flash', tokens: 100, calls: 1 }] },
    cursor: { models: [{ provider: 'cursor', model: 'composer-1', tokens: 4500, calls: 1 }] },
    detail: [
      {
        ts: '2026-11-06T10:00:00+08:00',
        provider: 'deepseek',
        model: 'deepseek-flash',
        source: 'llm',
        lane: 'llm',
        tokens: 100,
        task: 'r1',
      },
      cursorRow,
    ],
  }
  const merged = overlayCursorFromLocal(base, { ...base, detail: [cursorRow] })
  assert.equal(merged.detail.filter((row) => row.source === 'cursor').length, 1)
  assert.equal(merged.detail.filter((row) => row.source === 'llm').length, 1)
  assert.equal(merged.today.cursor.calls, 1)
})

test('overlayCursorFromLocal keeps coding hours when gateway hourly is empty', () => {
  const gateway = {
    ok: true,
    source: 'gateway',
    note: '',
    grain: 'day',
    on: '2026-10-27',
    month: '2026-10',
    month_from: '2026-10-01',
    month_to: '2026-10-27',
    today: { llm: { calls: 0, tokens: 0 }, cursor: { calls: 0, tokens: 0 } },
    hourly: [],
    daily: [],
    monthly: [],
    llm: { models: [] },
    cursor: { models: [] },
    detail: [],
  }
  const local = {
    ok: true,
    grain: 'day',
    on: '2026-10-27',
    month: '2026-10',
    month_from: '2026-10-01',
    month_to: '2026-10-27',
    today: { llm: { calls: 0, tokens: 0 }, cursor: { calls: 2, tokens: 900 } },
    hourly: [
      {
        hour: 15,
        llm_calls: 0,
        llm_tokens: 0,
        llm_cache_hit: 0,
        llm_cache_miss: 0,
        llm_output: 0,
        cursor_calls: 2,
        cursor_tokens: 900,
        cursor_cache_hit: 100,
        cursor_cache_miss: 700,
        cursor_output: 100,
        calls: 2,
      },
    ],
    daily: [],
    monthly: [],
    llm: { models: [] },
    cursor: { models: [{ provider: 'cursor', model: 'composer', tokens: 900, calls: 2 }] },
    detail: [],
  }
  const merged = overlayCursorFromLocal(gateway, local)
  assert.equal(merged.today.cursor.calls, 2)
  assert.equal(merged.today.cursor.tokens, 900)
  assert.equal(merged.hourly.length, 1)
  assert.equal(merged.hourly[0].hour, 15)
  assert.equal(merged.hourly[0].cursor_tokens, 900)
})

test('panelSyncDays covers selected day or month to today', () => {
  const now = new Date('2026-11-07T01:00:00+08:00')
  assert.deepEqual(panelSyncDays('2026-11-06', 'day', now), ['2026-11-06'])
  // 打开「今天」顺带补昨天
  assert.deepEqual(panelSyncDays('2026-11-07', 'day', now), ['2026-11-06', '2026-11-07'])
  const month = panelSyncDays('2026-11-06', 'month', now)
  assert.equal(month[0], '2026-11-01')
  assert.equal(month[month.length - 1], '2026-11-07')
  const week = panelSyncDays('2026-11-07', 'week', now)
  assert.equal(week[0], '2026-11-01')
  assert.equal(week[week.length - 1], '2026-11-07')
  assert.equal(week.length, 7)
})

test('week emptyUsage fills 7 daily buckets (avoids client dual-chart white screen)', async () => {
  const panel = await fetchGatewayPanel({
    on: '2026-11-09',
    grain: 'week',
    scope: 'personal',
    viewerAdmin: false,
    resolveToken: async () => ({ value: '' }),
    endpoint: { baseUrl: 'http://127.0.0.1:9', credentialRef: 'ZR_GATEWAY_TOKEN' },
  })
  assert.ok(panel)
  assert.equal(panel.usage.grain, 'week')
  assert.equal(panel.usage.month_from, '2026-11-03')
  assert.equal(panel.usage.month_to, '2026-11-09')
  assert.equal(panel.usage.monthly.length, 7)
  assert.equal(panel.usage.monthly[0].date, '2026-11-03')
  assert.equal(panel.usage.monthly[6].date, '2026-11-09')
})

test('decryptCursorSafeStorage unlocks Chromium v10 blobs', () => {
  const password = 'unit-test-pass'
  const key = pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1')
  const iv = Buffer.alloc(16, 0x20)
  const cipher = createCipheriv('aes-128-cbc', key, iv)
  const plain = 'cursor-session-token-abc'
  const enc = Buffer.concat([Buffer.from('v10'), cipher.update(plain, 'utf8'), cipher.final()])
  const stored = 'cursor-safe-storage:v1:' + enc.toString('base64')
  assert.equal(decryptCursorSafeStorage(stored, password), plain)
  assert.equal(normalizeCursorAuthToken(plain), plain)
  assert.equal(decryptCursorSafeStorage(stored, 'wrong'), '')
})

test('cursor ledger can read accessToken from state.vscdb when auth.json is absent', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { DatabaseSync } = await import('node:sqlite')
  const { syncCursorUsage } = await import('../lib/cursor-ledger.js')
  const dir = await mkdtemp(join(tmpdir(), 'kq-vscdb-'))
  try {
    const root = join(dir, 'zr-workbuddy-desktop', 'persist', 'engine-data')
    await mkdir(join(root, 'usage'), { recursive: true })
    await mkdir(join(root, 'auth'), { recursive: true })
    await writeFile(join(root, 'usage', 'events.jsonl'), '')
    await writeFile(join(root, 'auth', 'active.json'), JSON.stringify({
      id: 'u_admin', role: 'admin', display_name: '管理员', exp: 4_000_000_000,
    }))
    const dbDir = join(dir, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage')
    await mkdir(dbDir, { recursive: true })
    const dbPath = join(dbDir, 'state.vscdb')
    const db = new DatabaseSync(dbPath)
    db.exec('CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)')
    db.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)').run('cursorAuth/accessToken', 'tok-from-vscdb')
    db.close()
    let sawAuth = ''
    const fetchImpl = async (_url, init) => {
      sawAuth = String(init?.headers?.authorization || '')
      return {
        ok: true,
        json: async () => ({
          totalUsageEventsCount: 1,
          usageEventsDisplay: [{
            timestamp: String(Date.parse('2026-11-06T15:00:00+08:00')),
            model: 'composer-1',
            usageEventId: 'evt-yday',
            tokenUsage: { inputTokens: 8, outputTokens: 2, cacheReadTokens: 10 },
          }],
        }),
      }
    }
    const result = await syncCursorUsage({
      force: true,
      env: { APPDATA: dir, DSH_HOME: join(dir, 'empty') },
      home: dir,
      fetchImpl,
      days: ['2026-11-06'],
    })
    assert.equal(sawAuth, 'Bearer tok-from-vscdb')
    assert.equal(result.appended, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
