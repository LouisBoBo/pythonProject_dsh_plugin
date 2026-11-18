/**
 * 用这次会话里的两段原文，核对「模型复述」会被藏、正式结论和文件卡会留下。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const modelText = `提交已完成。

- 仓库：https://github.com/LouisBoBo/pythonProject_zr_aicoding
- 分支：hebo
- Commit：98c00b6，已推送远端
- 本次提交文件：后端 openapi_zh.py、reports.py
- 审码：高危 0 · 中危 3 · 低危 4（已放行）

PR 未能自动创建（GitHub API 校验失败，缺凭据）。需要 PR 时可直接用：https://github.com/LouisBoBo/pythonProject_zr_aicoding/compare/main...hebo?expand=1`

const officialText = `Git 交付结论

提交已完成。

任务结果 代码已提交并推送到远端仓库 hebo 分支（commit 98c00b6）。GitHub API 开 PR 失败：Validation Failed。

做了什么

- 读取当前仓库未提交改动，经确认后执行 commit → push。
- 推送成功，目标分支 hebo。
- 开 PR 环节因缺少凭据跳过。

如何验证

手动开 PR 可用链接：

https://github.com/LouisBoBo/pythonProject_zr_aicoding/compare/main...hebo?expand=1

说明：
• 仓库：https://github.com/LouisBoBo/pythonProject_zr_aicoding
• 分支：hebo
• Commit：98c00b6`

function el(tag, attrs, children) {
  const node = {
    nodeType: 1,
    tag,
    attrs: attrs || {},
    className: (attrs && attrs.class) || '',
    children: children || [],
    style: {},
    parentElement: null,
  }
  for (const c of node.children) c.parentElement = node
  node.textContent = node.children.length
    ? node.children.map((c) => c.textContent || '').join('')
    : String((attrs && attrs.text) || '')
  node.getAttribute = (k) => (k in node.attrs ? String(node.attrs[k]) : null)
  node.setAttribute = (k, v) => {
    node.attrs[k] = v
  }
  node.closest = function (sel) {
    let n = this
    while (n) {
      if (match(n, sel)) return n
      n = n.parentElement
    }
    return null
  }
  node.contains = function (other) {
    if (other === this) return true
    return this.children.some((c) => c.contains(other))
  }
  node.querySelector = function (sel) {
    const all = this.querySelectorAll(sel)
    return all[0] || null
  }
  node.querySelectorAll = function (sel) {
    const out = []
    const walk = (n) => {
      for (const c of n.children) {
        if (sel.split(',').some((s) => match(c, s.trim()))) out.push(c)
        walk(c)
      }
    }
    walk(this)
    return out
  }
  return node
}

function match(n, sel) {
  if (!n || n.nodeType !== 1) return false
  if (sel === 'div' || sel === 'section' || sel === 'article') return n.tag === sel
  if (sel.startsWith('.')) return n.className.split(/\s+/).includes(sel.slice(1))
  const m = sel.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/)
  if (!m) return false
  if (m[2] === undefined) return n.getAttribute(m[1]) != null
  return n.getAttribute(m[1]) === m[2]
}

function linkSiblings(nodes) {
  for (let i = 0; i < nodes.length; i++) {
    nodes[i].previousElementSibling = i > 0 ? nodes[i - 1] : null
    nodes[i].nextElementSibling = i + 1 < nodes.length ? nodes[i + 1] : null
  }
}

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/client.js'), 'utf8')
const start = src.indexOf('function isHiddenConclusion')
const end = src.indexOf('function installGitConclusionDedupe')
if (start < 0 || end < 0) throw new Error('dedupe functions not found')
const api = new Function(
  `${src.slice(start, end)}\nreturn { hideModelGitSummariesNear, isModelGitDeliverSummary, isGitConclusionBlockText }`,
)()

if (!api.isModelGitDeliverSummary(modelText)) throw new Error('model summary not recognized')
if (api.isModelGitDeliverSummary(officialText)) throw new Error('official text misread as model summary')
if (!api.isGitConclusionBlockText(officialText)) throw new Error('official text not recognized')

const fileCard = el('div', { 'data-changed-files': '1', text: '已编辑 cch-20261117-161137-2ebe-审码报告.md' })
const tail = el('div', { 'data-cc-turn-tail': '1', 'data-cc-conclusion-official': officialText, text: officialText })
const toolCopy = el('div', { text: officialText })
const toolWrap = el('div', {}, [toolCopy, tail, fileCard])
const model = el('div', { text: modelText })
const modelTurn = el('div', { 'data-chat-turn': '1' }, [model])
const officialTurn = el('div', { 'data-chat-turn': '2' }, [toolWrap])
const group = el('div', { 'data-chat-group-key': 'g' }, [modelTurn, officialTurn])
linkSiblings(group.children)
const doc = { body: group }
group.parentElement = doc.body === group ? null : null

api.hideModelGitSummariesNear(tail)

if (model.style.display !== 'none') throw new Error('model summary still visible')
if (toolCopy.style.display !== 'none') throw new Error('second official copy still visible')
if (tail.style.display === 'none') throw new Error('official tail was hidden')
if (fileCard.style.display === 'none') throw new Error('file card was hidden')
if (tail.getAttribute('data-cc-dup-conclusion-hidden') === '1') throw new Error('tail marked hidden')

console.log('conclusion dedupe ok')
