import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { classifyCall, countPromptChars } from '../lib/classify.js'

const EXTRACTION_SYS = `You maintain a durable document-oriented knowledge base for an AI coding assistant.
Extract only knowledge that is reusable beyond this single answer.`

describe('classifyCall', () => {
  it('honors allowlisted meterTag over heuristics', () => {
    const meta = classifyCall({
      meterTag: 'dsh_knowledge',
      sessionId: 's1',
      system: 'hello title',
    })
    assert.equal(meta.source, 'dsh_knowledge')
  })

  it('ignores unknown meterTag and continues', () => {
    const meta = classifyCall({
      meterTag: 'not-a-source',
      sessionId: 's1',
      system: 'x',
    })
    assert.equal(meta.source, 'dsh_chat')
  })

  it('uses official purpose=session-title', () => {
    const meta = classifyCall({
      purpose: 'session-title',
      sessionId: 's1',
      system: 'Write a title',
    })
    assert.equal(meta.source, 'dsh_title')
  })

  it('does not count compaction as dsh_chat even with sessionId', () => {
    const meta = classifyCall({
      purpose: 'compaction',
      sessionId: 's1',
      system: 'compress the transcript',
    })
    assert.equal(meta.source, 'dsh_other')
  })

  it('labels knowledge extraction by system prompt', () => {
    const meta = classifyCall({
      sessionId: 's1',
      system: EXTRACTION_SYS,
    })
    assert.equal(meta.source, 'dsh_knowledge')
  })

  it('labels mneme-like memory prompts', () => {
    const meta = classifyCall({
      system: 'mneme dream consolidator summarize_compress',
    })
    assert.equal(meta.source, 'dsh_memory')
  })

  it('labels short title prompts', () => {
    const meta = classifyCall({
      system: '请为会话标题生成一句话',
    })
    assert.equal(meta.source, 'dsh_title')
  })

  it('uses isAgentLoop when provided', () => {
    const meta = classifyCall(
      { system: 'You are a coding assistant with tools.' },
      { isAgentLoop: () => true },
    )
    assert.equal(meta.source, 'dsh_chat')
  })

  it('falls back to dsh_other without session', () => {
    const meta = classifyCall({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    assert.equal(meta.source, 'dsh_other')
    assert.equal(meta.provider, 'deepseek-official')
    assert.equal(meta.model, 'deepseek-v4-flash')
  })

  it('counts prompt chars without exposing body', () => {
    const options = {
      system: 'abc',
      messages: [{ content: [{ type: 'text', text: 'hello' }] }],
    }
    assert.equal(countPromptChars(options), 8)
  })
})
