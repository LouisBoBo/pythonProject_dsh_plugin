import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { archiveTurn, describeArchive } from '../lib/archive.js'
import { apply } from '../lib/index.js'

const scratch = []

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-transcript-'))
  scratch.push(dir)
  return dir
}

after(async () => {
  await Promise.all(scratch.map((dir) => rm(dir, { recursive: true, force: true })))
})

function events(turn, user, assistant = '好的') {
  return [
    { type: 'turn/start', data: { turn } },
    { type: 'session/title', data: { title: '报表中心考勤页' } },
    { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: user }] } },
    {
      type: 'assistant/message',
      data: { turn, step: 1, message: { content: [{ type: 'text', text: assistant }] } },
    },
  ]
}

describe('archiveTurn', () => {
  it('writes the turn, cover, and index, then leaves earlier turns untouched', async () => {
    const root = await tempDir()
    const now = new Date('2026-10-27T03:20:00.000Z')
    const first = await archiveTurn({
      archiveRoot: root,
      sessionId: 'session-abc',
      turn: 1,
      events: events(1, '第一轮原话', '第一轮回答'),
      workspace: '/path/to/repo',
      now,
    })
    assert.deepEqual(first, { ok: true, wrote: true, sessionDir: join(root, 'session-abc') })
    const turnFile = join(root, 'session-abc', '001', '对话.md')
    const original = await readFile(turnFile, 'utf8')
    assert.match(original, /第一轮原话/)
    assert.match(original, /第一轮回答/)
    assert.match(original, /2026-10-27T11:20:00\+08:00/)

    const second = await archiveTurn({
      archiveRoot: root,
      sessionId: 'session-abc',
      turn: 2,
      events: [
        ...events(1, '第一轮原话', '第一轮回答'),
        { type: 'turn/start', data: { turn: 2 } },
        { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '第二轮原话' }] } },
        {
          type: 'assistant/message',
          data: { turn: 2, step: 1, message: { content: [{ type: 'text', text: '第二轮回答' }] } },
        },
      ],
      workspace: '/path/to/repo',
      now,
    })
    assert.equal(second.ok, true)
    assert.equal(await readFile(turnFile, 'utf8'), original)
    const cover = await readFile(join(root, 'session-abc', '会话.md'), 'utf8')
    assert.match(cover, /^# 报表中心考勤页/)
    assert.match(cover, /工作区：`\/path\/to\/repo`/)
    assert.match(cover, /- \[001\]\(001\/对话\.md\)/)
    assert.match(cover, /- \[002\]\(002\/对话\.md\)/)
    const index = await readFile(join(root, 'index.md'), 'utf8')
    assert.match(index, /报表中心考勤页/)
    assert.match(index, /session-abc/)
    assert.match(index, /最近一轮 002/)
    const names = await readFile(join(root, 'session-abc', '002', '对话.md'), 'utf8')
    assert.equal(names.includes('文件/'), false)
  })

  it('overwrites the same turn and skips empty, invalid, and unsafe turns', async () => {
    const root = await tempDir()
    await archiveTurn({
      archiveRoot: root,
      sessionId: 'session-abc',
      turn: 1,
      events: events(1, 'ALPHA', '回答'),
      now: new Date('2026-10-27T03:20:00.000Z'),
    })
    await archiveTurn({
      archiveRoot: root,
      sessionId: 'session-abc',
      turn: 1,
      events: events(1, 'BETA', '回答'),
      now: new Date('2026-10-27T03:21:00.000Z'),
    })
    const body = await readFile(join(root, 'session-abc', '001', '对话.md'), 'utf8')
    assert.match(body, /BETA/)
    assert.equal(body.includes('ALPHA'), false)

    const empty = await archiveTurn({
      archiveRoot: root,
      sessionId: 'session-abc',
      turn: 3,
      events: [
        { type: 'turn/start', data: { turn: 3 } },
        { type: 'user/message', data: { source: { kind: 'plugin' }, content: [{ type: 'text', text: 'SECRET_PLUGIN' }] } },
      ],
    })
    assert.deepEqual(empty, { ok: true, wrote: false })

    for (const turn of [0, 1.5, '1']) {
      const invalid = await archiveTurn({
        archiveRoot: root,
        sessionId: 'session-abc',
        turn,
        events: events(1, '不会写入', '不会写入'),
      })
      assert.deepEqual(invalid, { ok: false, category: 'invalid_turn' })
    }
    const unsafe = await archiveTurn({
      archiveRoot: root,
      sessionId: '../tmp',
      turn: 1,
      events: events(1, '不会写入', '不会写入'),
    })
    assert.deepEqual(unsafe, { ok: false, category: 'path_unsafe' })
    const where = await describeArchive(root, 'session-missing')
    assert.equal(where.pending, true)
    assert.equal(where.path, root)
  })

  it('does not throw when the archive root cannot be written', async () => {
    const dir = await tempDir()
    const blocked = join(dir, 'not-a-directory')
    await writeFile(blocked, 'x')
    const result = await archiveTurn({
      archiveRoot: blocked,
      sessionId: 'session-abc',
      turn: 1,
      events: events(1, 'SECRET_BODY', '回答'),
    })
    assert.equal(result.ok, false)
    assert.match(result.category, /^write_failed:/)
    assert.equal(JSON.stringify(result).includes('SECRET_BODY'), false)
  })
})

describe('apply', () => {
  it('does not register when disabled', () => {
    let calls = 0
    apply({
      logger: { warn() {}, info() {} },
      on() { calls += 1 },
      tools: { register() { calls += 1 } },
    }, { enabled: false, archiveRoot: '/tmp/unused' })
    assert.equal(calls, 0)
  })

  it('registers the stopping listener and the read-only path tool', async () => {
    const root = await tempDir()
    const warnings = []
    let listener
    let tool
    apply({
      logger: {
        info() {},
        warn(message) { warnings.push(message) },
      },
      on(name, fn) {
        assert.equal(name, 'agent/turn-stopping')
        listener = fn
      },
      tools: {
        register(value) { tool = value },
      },
    }, { enabled: true, archiveRoot: root })
    assert.equal(tool.name, 'zr_transcript_where')
    assert.deepEqual(tool.parameters.properties, {})
    const pending = await tool.execute({}, { agent: { session: { id: 'session-abc' } } })
    assert.match(pending, /尚未写入/)
    assert.match(pending, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

    await listener({
      agent: {
        session: {
          id: 'session-abc',
          header: { cwd: '/path/to/repo' },
          snapshotEvents: () => events(1, '用户原话', '助手正文'),
        },
      },
      turn: 1,
    })
    const saved = await readFile(join(root, 'session-abc', '001', '对话.md'), 'utf8')
    assert.match(saved, /用户原话/)
    assert.match(saved, /助手正文/)
    const located = await tool.execute({}, { agent: { session: { id: 'session-abc' } } })
    assert.equal(located, `本会话归档目录：${join(root, 'session-abc')}`)
    assert.equal(warnings.length, 0)

    await listener({
      agent: { session: { id: 'session-abc', snapshotEvents() { throw new Error('SECRET_BODY') } } },
      turn: 2,
    })
    assert.equal(warnings.some((line) => line.includes('snapshot_failed')), true)
    assert.equal(warnings.join('\n').includes('SECRET_BODY'), false)
  })
})
