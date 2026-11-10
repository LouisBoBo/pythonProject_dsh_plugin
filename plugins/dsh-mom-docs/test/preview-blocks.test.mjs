import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('../src/client.js', import.meta.url)), 'utf8')
const start = source.indexOf('/* preview-blocks:start */')
const end = source.indexOf('/* preview-blocks:end */')
const previewBlocks = new Function(`${source.slice(start, end)}\nreturn previewBlocks`)()

const report = readFileSync('/Users/hebo/Desktop/中软项目/pythonProject_zr_aicoding/MOM/2026-11-09/近7日生产品质分析报告.md', 'utf8')

test('renders the quality report tables and images as blocks', () => {
  const blocks = previewBlocks(report, true)
  const tables = blocks.filter((block) => block.type === 'table')
  const images = blocks.filter((block) => block.type === 'img')
  assert.equal(tables.length, 9)
  assert.deepEqual(tables[2].header, ['日期', '实际产出（件）', '不良件数', '不良率', '环比'])
  assert.equal(tables[2].rows[0][0], '11-03')
  assert.equal(tables[2].rows[4][0], '**合计**')
  assert.equal(images.length, 5)
  assert.equal(images[0].alt, '日不良件数趋势（件，日报口径）')
  assert.equal(images[0].src.startsWith('https://'), true)
  assert.equal(blocks.some((block) => block.type === 'p' && block.text.includes('| 11-03 |')), false)
})

test('leaves pipe text alone when it is not a table', () => {
  const blocks = previewBlocks('先看 | 这个 | 不是表\n\n普通段落', true)
  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].type, 'p')
})

test('does not turn tables into blocks for plain text files', () => {
  const blocks = previewBlocks('| 日期 | 件数 |\n| --- | --- |\n| 11-03 | 1 |', false)
  assert.equal(blocks.some((block) => block.type === 'table'), false)
})

test('keeps fenced tables and unsafe image URLs as text', () => {
  const fenced = previewBlocks('```\n| 日期 | 件数 |\n| --- | --- |\n| 11-03 | 1 |\n```', true)
  assert.equal(fenced.some((block) => block.type === 'table'), false)
  const local = previewBlocks('![内网](http://127.0.0.1/secret.png)', true)
  assert.equal(local.some((block) => block.type === 'img'), false)
  assert.equal(local[0].text.includes('127.0.0.1'), true)
  const remote = previewBlocks('![趋势](https://cdn.example.com/a.png)', true)
  assert.equal(remote[0].type, 'img')
  assert.equal(remote[0].src, 'https://cdn.example.com/a.png')
})
