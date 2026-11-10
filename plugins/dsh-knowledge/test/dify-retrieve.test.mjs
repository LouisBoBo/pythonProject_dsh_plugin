import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { describe, it } from 'node:test'
import { difyRecordsToHits, retrieveDifyDataset } from '../lib/dify-retrieve.js'

describe('Dify retrieve mapping', () => {
  it('keeps scored segments and drops incomplete records', () => {
    const hits = difyRecordsToHits({
      records: [
        { score: 0.42, segment: { id: 'seg-1', content: '阻焊开窗 0.1mm', document: { name: '工艺.pdf' } } },
        { score: 1.8, segment: { id: 'seg-2', content: '超出 1 的分数钳到 1' } },
        { score: null, segment: { id: 'seg-3', content: '没有分数' } },
        { score: 0.9, segment: { id: '', content: '没有片段 id' } },
        { score: 0.5, segment: { id: 'seg-4', content: '   ' } },
      ],
    }, 'base-1')
    assert.equal(hits.length, 2)
    assert.equal(hits[0].entry.id, 'difyseg:seg1')
    assert.equal(hits[0].entry.knowledgeBaseId, 'base-1')
    assert.equal(hits[0].entry.title, '工艺.pdf')
    assert.equal(hits[0].score, 0.42)
    assert.equal(hits[1].score, 1)
    assert.equal(hits[1].entry.title, 'Dify 片段')
  })

  it('posts to /datasets/{id}/retrieve and returns an empty list on HTTP failure', async () => {
    const seen = {}
    const server = createServer((req, res) => {
      seen.method = req.method
      seen.url = req.url
      seen.authorization = req.headers.authorization
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        seen.body = JSON.parse(body)
        if (req.url.endsWith('/missing/retrieve')) {
          res.writeHead(401, { 'content-type': 'application/json' })
          res.end('{"code":"unauthorized"}')
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          records: [{ score: 0.7, segment: { id: 'abc', content: '命中正文', document: { name: '规范.md' } } }],
        }))
      })
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address()
    try {
      const hits = await retrieveDifyDataset({
        baseUrl: `http://127.0.0.1:${port}/v1`,
        datasetId: 'dataset-1',
        apiKey: 'secret-key',
        query: '阻焊',
        topK: 4,
        knowledgeBaseId: 'kb',
      })
      assert.equal(seen.method, 'POST')
      assert.equal(seen.url, '/v1/datasets/dataset-1/retrieve')
      assert.equal(seen.authorization, 'Bearer secret-key')
      assert.equal(seen.body.query, '阻焊')
      assert.equal(seen.body.retrieval_model.top_k, 4)
      assert.equal(hits.length, 1)
      assert.equal(hits[0].entry.body, '命中正文')
      const failed = await retrieveDifyDataset({
        baseUrl: `http://127.0.0.1:${port}/v1`,
        datasetId: 'missing',
        apiKey: 'secret-key',
        query: '阻焊',
        topK: 4,
        knowledgeBaseId: 'kb',
      })
      assert.deepEqual(failed, [])
    }
    finally {
      await new Promise(resolve => server.close(resolve))
    }
  })

  it('does not follow a redirect or send the API key to another host', async () => {
    let stolen = 0
    const sink = createServer((req, res) => {
      stolen += 1
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"records":[{"score":0.9,"segment":{"id":"x","content":"stolen"}}]}')
    })
    await new Promise(resolve => sink.listen(0, '127.0.0.1', resolve))
    const sinkPort = sink.address().port
    const server = createServer((req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${sinkPort}/steal` })
      res.end()
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address()
    try {
      const hits = await retrieveDifyDataset({
        baseUrl: `http://127.0.0.1:${port}/v1`,
        datasetId: 'dataset-1',
        apiKey: 'secret-key',
        query: '阻焊',
        topK: 4,
        knowledgeBaseId: 'kb',
      })
      assert.deepEqual(hits, [])
      assert.equal(stolen, 0)
      const skipped = await retrieveDifyDataset({
        baseUrl: `http://127.0.0.1:${port}/admin`,
        datasetId: 'dataset-1',
        apiKey: 'secret-key',
        query: '阻焊',
        topK: 4,
        knowledgeBaseId: 'kb',
      })
      assert.deepEqual(skipped, [])
    }
    finally {
      await new Promise(resolve => server.close(resolve))
      await new Promise(resolve => sink.close(resolve))
    }
  })
})
