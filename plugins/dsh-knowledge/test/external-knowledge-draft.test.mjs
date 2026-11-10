import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeKnowledgeBaseDraft } from '../lib/domain.js'

const base = {
  name: '工艺规范',
  description: '',
  defaultTags: [],
  extractionInstructions: '',
  writebackPolicy: 'conservative',
}
const datasetId = '11111111-2222-4333-8444-555555555555'

describe('external Dify knowledge draft', () => {
  it('accepts an API root, dataset id, and API key without a login account', () => {
    const draft = normalizeKnowledgeBaseDraft({
      ...base,
      externalUrl: 'http://203.0.113.10:19770/v1',
      externalDatasetId: datasetId,
      externalApiKey: 'dataset-key',
      externalUsername: 'should-be-dropped',
    })
    assert.equal(draft.externalUrl, 'http://203.0.113.10:19770/v1')
    assert.equal(draft.externalDatasetId, datasetId)
    assert.equal(draft.externalUsername, '')
    assert.equal(draft.externalPassword, 'dataset-key')
  })

  it('keeps a saved key when the editor leaves the field empty', () => {
    const draft = normalizeKnowledgeBaseDraft({
      ...base,
      externalUrl: 'https://dify.example.com/v1',
      externalDatasetId: datasetId,
    })
    assert.equal(draft.externalUrl, 'https://dify.example.com/v1')
    assert.equal(draft.externalDatasetId, datasetId)
    assert.equal('externalPassword' in draft, false)
  })

  it('clears the link when the access URL is removed', () => {
    const draft = normalizeKnowledgeBaseDraft({
      ...base,
      externalUrl: '',
      externalDatasetId: '',
      externalApiKey: '',
    })
    assert.equal(draft.externalUrl, '')
    assert.equal(draft.externalDatasetId, '')
    assert.equal(draft.externalUsername, '')
    assert.equal(draft.externalPassword, '')
  })

  it('rejects a retrieve URL in the access address', () => {
    assert.throws(
      () => normalizeKnowledgeBaseDraft({
        ...base,
        externalUrl: `http://203.0.113.10:19770/v1/datasets/${datasetId}/retrieve`,
        externalDatasetId: datasetId,
        externalApiKey: 'dataset-key',
      }),
      /只填写到 \/v1/,
    )
  })

  it('rejects an API key that has no access URL', () => {
    assert.throws(
      () => normalizeKnowledgeBaseDraft({ ...base, externalApiKey: 'dataset-key' }),
      /需要同时填写访问地址/,
    )
  })
})
