import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { zstdCompressSync } from 'node:zlib'
import { loadEngineBundle, panelUsage } from '../lib/engine-usage.js'

describe('engine usage files', () => {
  it('keeps the admin login when the newest usage copy has no session file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kq-auth-'))
    const older = join(dir, 'zr-workbuddy-desktop', 'persist', 'engine-data')
    const newer = join(dir, 'zr-workbuddy-desktop', 'runtime-app', 'apps', 'zr-workbuddy', 'engine', 'data')
    await mkdir(join(older, 'usage'), { recursive: true })
    await mkdir(join(older, 'auth'), { recursive: true })
    await mkdir(join(newer, 'usage'), { recursive: true })
    await writeFile(join(older, 'usage', 'events.jsonl'), JSON.stringify({
      ts: '2026-10-22T08:00:00+08:00', source: 'llm', model: 'deepseek-chat', user_id: 'u_admin', total_tokens: 1500,
    }) + '\n')
    await writeFile(join(older, 'auth', 'users.json'), JSON.stringify({
      users: [{ id: 'u_admin', username: 'admin', display_name: '管理员', role: 'admin' }],
    }))
    await writeFile(join(older, 'auth', 'active.json'), JSON.stringify({
      id: 'u_admin', username: 'admin', role: 'admin', display_name: '管理员', exp: 4_000_000_000,
    }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    await writeFile(join(newer, 'usage', 'events.jsonl'), JSON.stringify({
      ts: '2026-10-23T09:00:10+08:00', source: 'llm', model: 'deepseek-chat', user_id: 'u_admin', total_tokens: 825,
    }) + '\n')
    try {
      const bundle = loadEngineBundle({ APPDATA: dir, DSH_HOME: join(dir, 'empty-home') }, dir)
      assert.equal(bundle.active && bundle.active.id, 'u_admin')
      assert.equal(bundle.active && bundle.active.role, 'admin')
      assert.equal(bundle.users.length, 1)
      assert.equal(bundle.events.length, 1)
      assert.equal(bundle.events[0].total, 825)
      const view = panelUsage('http://127.0.0.1/v1/local/panel?on=2026-10-23&grain=day&scope=personal', bundle)
      assert.equal(view.viewerAdmin, true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reads events beside the desktop engine data and hides other fields', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kq-eng-'))
    const root = join(dir, 'zr-workbuddy-desktop', 'persist', 'engine-data')
    await mkdir(join(root, 'usage'), { recursive: true })
    await mkdir(join(root, 'auth'), { recursive: true })
    await writeFile(join(root, 'usage', 'events.jsonl'), JSON.stringify({
      ts: '2026-10-22T08:00:00+08:00',
      source: 'llm',
      model: 'deepseek-chat',
      user_id: 'u_admin',
      prompt_tokens: 1000,
      completion_tokens: 500,
      cache_read_tokens: 0,
      total_tokens: 1500,
      password_hash: 'nope',
    }) + '\n')
    await writeFile(join(root, 'auth', 'users.json'), JSON.stringify({
      users: [{ id: 'u_admin', username: 'admin', display_name: '管理员', role: 'admin', password_hash: 'secret' }],
    }))
    await writeFile(join(root, 'auth', 'active.json'), JSON.stringify({
      id: 'u_admin', role: 'admin', display_name: '管理员',
    }))
    try {
      const bundle = loadEngineBundle({ APPDATA: dir, DSH_HOME: dir }, dir)
      assert.equal(bundle.events.length, 1)
      assert.equal(bundle.events[0].total, 1500)
      assert.equal(JSON.stringify(bundle).includes('secret'), false)
      assert.equal(JSON.stringify(bundle).includes('nope'), false)
      const view = panelUsage('http://127.0.0.1/v1/local/panel?on=2026-10-22&grain=day&scope=personal', bundle)
      assert.equal(view.viewerAdmin, true)
      assert.equal(view.usage.today.llm.tokens, 1500)
      assert.equal(view.usage.llm.models[0].model, 'deepseek-chat')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('counts a meter row the usage ledger has not ingested yet, and skips one it already has', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kq-meter-'))
    const root = join(dir, 'zr-workbuddy-desktop', 'persist', 'engine-data')
    await mkdir(join(root, 'usage'), { recursive: true })
    await mkdir(join(root, 'auth'), { recursive: true })
    await mkdir(join(dir, '.dsh', 'llm-meter'), { recursive: true })
    await writeFile(join(root, 'usage', 'events.jsonl'), JSON.stringify({
      ts: '2026-10-22T08:00:00+08:00',
      source: 'llm',
      model: 'deepseek-chat',
      user_id: 'u_admin',
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      job_id: 'meter_old',
    }) + '\n')
    await writeFile(join(root, 'auth', 'active.json'), JSON.stringify({
      id: 'u_admin', role: 'admin', display_name: '管理员',
    }))
    await writeFile(join(dir, '.dsh', 'llm-meter', 'events.jsonl'), [
      JSON.stringify({
        id: 'meter_old',
        ts: '2026-10-22T08:00:00+08:00',
        source: 'dsh_chat',
        model: 'deepseek-chat',
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      }),
      JSON.stringify({
        id: 'meter_today',
        ts: '2026-10-23T09:00:10+08:00',
        source: 'dsh_other',
        model: 'deepseek-chat',
        prompt_tokens: 447,
        completion_tokens: 250,
        cache_read_tokens: 128,
        cache_write_tokens: 0,
        reasoning_tokens: 70,
        total_tokens: 895,
      }),
    ].join('\n') + '\n')
    try {
      const bundle = loadEngineBundle({ APPDATA: dir, DSH_HOME: join(dir, 'empty-home') }, dir)
      assert.equal(bundle.events.length, 2)
      const view = panelUsage('http://127.0.0.1/v1/local/panel?on=2026-10-23&grain=day&scope=personal', bundle)
      assert.equal(view.usage.today.llm.calls, 1)
      assert.equal(view.usage.today.llm.tokens, 825)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('adds session usage the ledger stopped before, and keeps deepseek off the cursor card', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kq-sess-'))
    const root = join(dir, 'zr-workbuddy-desktop', 'persist', 'engine-data')
    const sessionDir = join(dir, 'local', 'ZR_DSH', 'dsh-home', 'sessions', 'ws', 'session-abc')
    await mkdir(join(root, 'usage'), { recursive: true })
    await mkdir(join(root, 'auth'), { recursive: true })
    await mkdir(sessionDir, { recursive: true })
    await writeFile(join(root, 'usage', 'events.jsonl'), JSON.stringify({
      ts: '2026-10-22T09:00:12+08:00', source: 'llm', model: 'deepseek-chat', user_id: 'u_admin', total_tokens: 10,
    }) + '\n')
    await writeFile(join(root, 'auth', 'active.json'), JSON.stringify({
      id: 'u_admin', role: 'admin', display_name: '管理员',
    }))
    const lines = [
      { seq: 1, time: Date.parse('2026-10-22T08:00:00+08:00'), type: 'assistant/message', data: { usage: { inputTokens: 9, outputTokens: 1, totalTokens: 10 }, message: { source: { provider: 'deepseek-official', model: 'deepseek-flash' } } } },
      { seq: 2, time: Date.parse('2026-10-25T11:52:00+08:00'), type: 'assistant/message', data: { usage: { inputTokens: 2010, outputTokens: 266, cacheReadTokens: 13312, cacheWriteTokens: 0, totalTokens: 15588 }, message: { source: { provider: 'deepseek-official', model: 'deepseek-flash' } } } },
      { seq: 3, time: Date.parse('2026-10-25T12:00:00+08:00'), type: 'assistant/message', data: { usage: { inputTokens: 20, outputTokens: 8, totalTokens: 28 }, message: { source: { provider: 'cursor', model: 'composer-2' } } } },
    ]
    await writeFile(join(sessionDir, 'session.v4.jsonl.zstd'), zstdCompressSync(Buffer.from(lines.map((row) => JSON.stringify(row)).join('\n') + '\n')))
    try {
      const bundle = loadEngineBundle({
        APPDATA: dir,
        DSH_HOME: join(dir, 'empty-home'),
        LOCALAPPDATA: join(dir, 'local'),
      }, dir)
      assert.equal(bundle.events.length, 3)
      const view = panelUsage('http://127.0.0.1/v1/local/panel?on=2026-10-25&grain=day&scope=personal', bundle)
      assert.equal(view.usage.today.llm.calls, 1)
      assert.equal(view.usage.today.llm.tokens, 15588)
      assert.equal(view.usage.llm.models[0].model, 'deepseek-flash')
      assert.equal(view.usage.llm.models[0].provider, 'deepseek-official')
      assert.equal(view.usage.today.cursor.calls, 1)
      assert.equal(view.usage.today.cursor.tokens, 28)
      assert.equal(view.usage.cursor.models[0].model, 'composer-2')
      assert.equal(view.usage.cursor.models[0].provider, 'cursor')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('treats a 10-digit session time as unix seconds and keeps providers apart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kq-sec-'))
    const sessionDir = join(dir, 'local', 'ZR_DSH', 'dsh-home', 'sessions', 'ws', 'session-abc')
    await mkdir(sessionDir, { recursive: true })
    const sec = Math.floor(Date.parse('2026-10-26T15:00:00+08:00') / 1000)
    assert.ok(sec < 1e12)
    const lines = [
      { seq: 1, time: sec, type: 'session/title', data: { title: '临时标题', source: { kind: 'fallback' } } },
      { seq: 2, time: sec, type: 'assistant/message', data: { usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 }, message: { source: { provider: 'deepseek-official', model: 'deepseek-flash' } } } },
      { seq: 3, time: sec + 60, type: 'assistant/message', data: { usage: { inputTokens: 40, outputTokens: 8, totalTokens: 48 }, message: { source: { provider: 'zhipu', model: 'glm-5.3' } } } },
      { seq: 4, time: sec + 90, type: 'session/title', data: { title: 'GLM5.3模型推理能力评估', source: { kind: 'provider' } } },
    ]
    await writeFile(join(sessionDir, 'session.v4.jsonl.zstd'), Buffer.concat(lines.map((row) => zstdCompressSync(Buffer.from(JSON.stringify(row) + '\n')))))
    try {
      const bundle = loadEngineBundle({
        APPDATA: join(dir, 'no-appdata'),
        DSH_HOME: join(dir, 'empty-home'),
        LOCALAPPDATA: join(dir, 'local'),
      }, dir)
      const view = panelUsage('http://127.0.0.1/v1/local/panel?on=2026-10-26&grain=day&scope=personal', bundle)
      assert.equal(view.usage.today.llm.calls, 2)
      assert.equal(view.usage.today.llm.tokens, 168)
      assert.deepEqual(view.usage.llm.models.map((row) => row.provider + '/' + row.model), [
        'deepseek-official/deepseek-flash',
        'zhipu/glm-5.3',
      ])
      assert.equal(view.usage.detail.length, 2)
      assert.equal(view.usage.detail[0].task, 'GLM5.3模型推理能力评估')
      assert.equal(view.usage.detail[1].task, 'GLM5.3模型推理能力评估')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('adds title and web-search provider usage and does not count the same call twice', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kq-side-'))
    const sideDir = join(dir, '.dsh', 'key-quota')
    const meterDir = join(dir, '.dsh', 'llm-meter')
    await mkdir(sideDir, { recursive: true })
    await mkdir(meterDir, { recursive: true })
    const title = {
      id: 'kqside_20261026111643_abc',
      ts: '2026-10-26T11:16:43+08:00',
      source: 'dsh_title',
      provider: 'deepseek-official',
      model: 'deepseek-flash',
      quality: 'provider',
      prompt_tokens: 400,
      completion_tokens: 20,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      reasoning_tokens: 30,
      total_tokens: 450,
      task: '会话标题',
    }
    const search = {
      id: 'kqside_20261026155120_def',
      ts: '2026-10-26T15:51:20+08:00',
      source: 'dsh_search',
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      quality: 'provider',
      prompt_tokens: 1000,
      completion_tokens: 80,
      cache_read_tokens: 200,
      cache_write_tokens: 16,
      reasoning_tokens: 0,
      total_tokens: 1296,
      task: '网页搜索',
    }
    await writeFile(join(sideDir, 'side-usage.jsonl'), `${JSON.stringify(title)}\n${JSON.stringify(search)}\n`)
    await writeFile(join(meterDir, 'events.jsonl'), JSON.stringify({
      ...title,
      id: 'meter_same_title',
    }) + '\n')
    const sessionDir = join(dir, 'local', 'ZR_DSH', 'dsh-home', 'sessions', 'ws', 'session-same-second')
    await mkdir(sessionDir, { recursive: true })
    const sec = Math.floor(Date.parse('2026-10-26T11:16:43+08:00') / 1000)
    const sessionLines = [
      { seq: 1, time: sec, type: 'session/title', data: { title: '同一秒的对话' } },
      { seq: 2, time: sec, type: 'assistant/message', data: { usage: { inputTokens: 400, outputTokens: 20, totalTokens: 420 }, message: { source: { provider: 'deepseek-official', model: 'deepseek-flash' } } } },
    ]
    await writeFile(join(sessionDir, 'session.v4.jsonl.zstd'), Buffer.concat(sessionLines.map((row) => zstdCompressSync(Buffer.from(JSON.stringify(row) + '\n')))))
    try {
      const bundle = loadEngineBundle({
        APPDATA: join(dir, 'no-appdata'),
        DSH_HOME: join(dir, 'empty-home'),
        LOCALAPPDATA: join(dir, 'local'),
      }, dir)
      const view = panelUsage('http://127.0.0.1/v1/local/panel?on=2026-10-26&grain=day&scope=personal', bundle)
      assert.equal(view.usage.today.llm.calls, 3)
      assert.equal(view.usage.today.llm.tokens, 420 + 1296 + 420)
      const tasks = view.usage.detail.map((row) => row.task).sort()
      assert.deepEqual(tasks, ['会话标题', '同一秒的对话', '网页搜索'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps another account off a side-usage row that names its user', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kq-side-user-'))
    const root = join(dir, 'zr-workbuddy-desktop', 'persist', 'engine-data')
    await mkdir(join(root, 'usage'), { recursive: true })
    await mkdir(join(root, 'auth'), { recursive: true })
    await mkdir(join(dir, '.dsh', 'key-quota'), { recursive: true })
    await writeFile(join(root, 'usage', 'events.jsonl'), '')
    await writeFile(join(root, 'auth', 'active.json'), JSON.stringify({
      id: 'u_admin', role: 'admin', display_name: '管理员',
    }))
    await writeFile(join(dir, '.dsh', 'key-quota', 'side-usage.jsonl'), JSON.stringify({
      id: 'kqside_20261026120000_abc',
      ts: '2026-10-26T12:00:00+08:00',
      source: 'dsh_title',
      provider: 'zhipu',
      model: 'glm-5.3',
      user_id: 'u_other',
      prompt_tokens: 10,
      completion_tokens: 2,
      total_tokens: 12,
      task: '会话标题',
    }) + '\n')
    try {
      const bundle = loadEngineBundle({
        APPDATA: dir,
        DSH_HOME: join(dir, 'empty-home'),
        LOCALAPPDATA: join(dir, 'no-local'),
      }, dir)
      const view = panelUsage('http://127.0.0.1/v1/local/panel?on=2026-10-26&grain=day&scope=personal', bundle)
      assert.equal(view.usage.today.llm.calls, 0)
      assert.equal(view.usage.today.llm.tokens, 0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
