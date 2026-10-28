import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { clampUtf8, projectTurn, sessionTitleFromEvents } from '../lib/events.js'
import { MAX_TRANSCRIPT_BYTES, renderTurnDocument } from '../lib/render.js'
import { shanghaiIso } from '../lib/time.js'

const writtenAt = '2026-10-27T11:20:00+08:00'

function render(events, turn = 1) {
  const projected = projectTurn(events, turn)
  assert.ok(projected)
  return renderTurnDocument({
    sessionTitle: sessionTitleFromEvents(events),
    sessionId: 'session-abc',
    turn,
    writtenAt,
    projected,
  })
}

describe('shanghai time', () => {
  it('formats Asia/Shanghai with a fixed offset', () => {
    assert.equal(shanghaiIso(new Date('2026-10-27T03:20:00.000Z')), '2026-10-27T11:20:00+08:00')
  })
})

describe('turn markdown', () => {
  it('keeps direct user text and drops plugin echoes', () => {
    const markdown = render([
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'session/title', data: { title: '旧标题' } },
      {
        type: 'user/message',
        data: {
          source: { kind: 'plugin', plugin: 'dsh-knowledge' },
          content: [{ type: 'text', text: 'SECRET_PLUGIN' }],
        },
      },
      {
        type: 'user/message',
        data: {
          source: { kind: 'user' },
          content: [{ type: 'text', text: '第一句' }, { type: 'image' }],
        },
      },
      {
        type: 'user/message',
        data: {
          source: { kind: 'user' },
          content: [{ type: 'text', text: '第二句' }],
        },
      },
      { type: 'session/title', data: { title: '报表中心考勤页' } },
      {
        type: 'assistant/message',
        data: {
          turn: 1,
          step: 2,
          message: { content: [{ type: 'text', text: '后写的一步' }] },
        },
      },
      {
        type: 'assistant/message',
        data: {
          turn: 1,
          step: 1,
          message: { content: [{ type: 'reasoning' }, { type: 'text', text: '先写的一步' }] },
        },
      },
    ])
    assert.equal(markdown.includes('SECRET_PLUGIN'), false)
    assert.match(markdown, /# 第 1 轮/)
    assert.match(markdown, /- 会话：报表中心考勤页/)
    assert.match(markdown, /第一句\n非文本：image\n\n第二句/)
    assert.ok(markdown.indexOf('## 助手 · 第 1 步') < markdown.indexOf('## 助手 · 第 2 步'))
    assert.match(markdown, /非文本：reasoning\n先写的一步/)
    assert.equal(sessionTitleFromEvents([
      { type: 'session/title', data: { title: '旧标题' } },
      { type: 'session/title', data: { title: '报表中心考勤页' } },
    ]), '报表中心考勤页')
  })

  it('pairs tool results by callId and keeps unpaired results', () => {
    const markdown = render([
      { type: 'turn/start', data: { turn: 1 } },
      {
        type: 'user/message',
        data: { source: { kind: 'user' }, content: [{ type: 'text', text: '查一下' }] },
      },
      { type: 'tool/call', data: { turn: 1, callId: 'c1', name: 'zr_cursor_begin', arguments: '{"ok":true}' } },
      {
        type: 'tool/result',
        data: {
          turn: 1,
          message: {
            source: { kind: 'tool', callId: 'c1' },
            content: [{ type: 'tool-result', content: [{ type: 'text', text: '已开始' }] }],
          },
        },
      },
      {
        type: 'tool/result',
        data: {
          turn: 1,
          message: {
            source: { kind: 'tool', callId: 'missing' },
            content: [{ type: 'tool-result', content: [{ type: 'text', text: '落单结果' }] }],
          },
        },
      },
    ])
    assert.match(markdown, /## 工具 · zr_cursor_begin/)
    assert.match(markdown, /- callId：`c1`/)
    assert.match(markdown, /\{"ok":true\}/)
    assert.match(markdown, /已开始/)
    assert.match(markdown, /## 工具结果（未配对）/)
    assert.match(markdown, /落单结果/)
  })

  it('titles assistants without step as 助手 and keeps event order', () => {
    const markdown = render([
      { type: 'turn/start', data: { turn: 1 } },
      {
        type: 'assistant/message',
        data: { turn: 1, message: { content: [{ type: 'text', text: '甲' }] } },
      },
      {
        type: 'assistant/message',
        data: { turn: 1, step: 4, message: { content: [{ type: 'text', text: '乙' }] } },
      },
    ])
    assert.match(markdown, /## 助手\n\n甲/)
    assert.ok(markdown.indexOf('甲') < markdown.indexOf('## 助手 · 第 4 步'))
  })

  it('does not project an empty turn', () => {
    const projected = projectTurn([
      { type: 'turn/start', data: { turn: 1 } },
      {
        type: 'user/message',
        data: { source: { kind: 'skill-catalog' }, content: [{ type: 'text', text: '目录' }] },
      },
    ], 1)
    assert.deepEqual(projected, { users: [], assistants: [], tools: [], unpaired: [] })
  })

  it('stops the slice at the next turn/start', () => {
    const projected = projectTurn([
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '一轮' }] } },
      { type: 'turn/start', data: { turn: 2 } },
      { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '二轮' }] } },
    ], 1)
    assert.equal(projected.users.map((item) => item.body).join(), '一轮')
  })

  it('truncates a document above 2 MiB and keeps a valid utf-8 boundary', () => {
    const markdown = render([
      { type: 'turn/start', data: { turn: 1 } },
      {
        type: 'assistant/message',
        data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '你'.repeat(MAX_TRANSCRIPT_BYTES) }] } },
      },
    ])
    assert.ok(Buffer.byteLength(markdown, 'utf8') <= MAX_TRANSCRIPT_BYTES)
    assert.match(markdown, /已截断/)
    assert.equal(markdown.includes('\uFFFD'), false)
    const clipped = clampUtf8('你你', 4)
    assert.equal(clipped.text, '你')
    assert.equal(clipped.truncated, true)
  })
})
