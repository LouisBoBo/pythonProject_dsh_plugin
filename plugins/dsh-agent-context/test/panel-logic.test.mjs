import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildSessionBubbleSummary,
  buildSkillMcpRows,
  buildAbsoluteFileResourceUri,
  buildSourceRows,
  extractJobHighlight,
  extractUserAttachmentsFromEvents,
  formatShortstatLabel,
  isNonUserSourcePath,
  jobLooksActive,
  mergeChangePaths,
  peerMissingMessage,
  resolveWorkspaceAbsPath,
  sessionUsedCoding,
  truncatePath,
} from '../lib/panelLogic.js'

describe('agent-context panelLogic', () => {
  it('merges git and job paths without duplicates', () => {
    const rows = mergeChangePaths(['a.ts', 'b.ts'], ['b.ts', 'c.ts'], ['d.ts'])
    assert.equal(rows.length, 4)
    const b = rows.find((r) => r.path === 'b.ts')
    assert.equal(b?.source, 'both')
    assert.equal(rows.find((r) => r.path === 'a.ts')?.source, 'git')
    assert.equal(rows.find((r) => r.path === 'd.ts')?.source, 'job')
  })

  it('normalizes slashes and drops empties', () => {
    const rows = mergeChangePaths(['x\\y.ts', ''], ['x/y.ts'], [])
    assert.equal(rows.length, 1)
    assert.equal(rows[0].path, 'x/y.ts')
    assert.equal(rows[0].source, 'both')
  })

  it('formats shortstat label', () => {
    assert.equal(formatShortstatLabel({ add: 12, del: 3 }), '+12 -3')
    assert.equal(formatShortstatLabel(null), '+0 -0')
  })

  it('truncates long paths', () => {
    const long = 'abcdefghijklmnopqrstuvwxyz/0123456789/' + 'x'.repeat(40)
    const t = truncatePath(long, 20)
    assert.ok(t.startsWith('…'))
    assert.ok(t.length <= 20)
  })

  it('peer missing copy', () => {
    assert.match(peerMissingMessage('cursor-chat'), /写码/)
    assert.match(peerMissingMessage('esc'), /专家技能/)
  })

  it('job active only from status field', () => {
    assert.equal(jobLooksActive('running'), true)
    assert.equal(jobLooksActive('pending_review'), true)
    assert.equal(jobLooksActive('succeeded'), false)
    assert.equal(jobLooksActive('failed'), false)
    assert.equal(jobLooksActive('cancelled'), false)
  })

  it('extractJobHighlight prefers 改动 bullets over hollow sync count', () => {
    const hi = extractJobHighlight(
      '## 本轮结论\n\n结果：✅ 已完成。已同步 3 个文件。\n\n改动：\n• 删除物料出库菜单入口\n• 同步页面与接口\n',
    )
    assert.match(hi, /删除物料出库/)
    assert.ok(!/^已同步/.test(hi))
    assert.ok(!/落盘/.test(hi))
  })

  it('extractJobHighlight skips hollow-only result', () => {
    const hi = extractJobHighlight('## 本轮结论\n\n结果：✅ 已完成。已同步 3 个文件。\n')
    assert.equal(hi, '')
  })

  it('buildSessionBubbleSummary is Qode-like prose not stats or 本轮结论', () => {
    const text = buildSessionBubbleSummary({
      sessionTitle: '仓库管理删除物料出库',
      jobs: [
        {
          status: 'succeeded',
          work_kind: 'coding',
          requirement: '删除停机报表入口',
          chat_conclusion:
            '## 本轮结论\n\n结果：✅ 已完成。已同步 1 个文件。\n\n改动：\n• 已删除停机报表\n',
          synced_files: ['a.ts'],
        },
        {
          status: 'succeeded',
          work_kind: 'coding',
          requirement: '同步菜单配置',
          chat_conclusion:
            '## 本轮结论\n\n结果：✅ 已完成。已同步 2 个文件。\n\n改动：\n• 已同步菜单配置\n',
          synced_files: ['b.ts', 'c.ts'],
        },
        { status: 'running', work_kind: 'git_deliver', chat_conclusion: '不应计入' },
      ],
      summary: { is_git: true, dirty: true },
      ccReady: true,
    })
    assert.match(text, /仓库管理删除物料出库/)
    assert.match(text, /删除停机报表|同步菜单配置/)
    assert.match(text, /未提交/)
    assert.ok(!/本会话共/.test(text))
    assert.ok(!/本会话跨轮摘要：已同步/.test(text))
    assert.ok(!/概要：/.test(text))
    assert.ok(!/本轮结论/.test(text))
    assert.ok(!/落盘/.test(text))
    assert.ok(!/不应计入/.test(text))
  })

  it('skill/MCP rows: coding job + ESC used, no enabled-only noise', () => {
    assert.equal(sessionUsedCoding([]), false)
    assert.equal(sessionUsedCoding([{ work_kind: 'coding' }]), true)
    const codingOnly = buildSkillMcpRows({ jobs: [{ work_kind: 'git_deliver' }] })
    assert.equal(codingOnly.length, 1)
    assert.equal(codingOnly[0].label, '写码（Cursor）')
    const mixed = buildSkillMcpRows({
      jobs: [{ work_kind: 'coding' }],
      usedSkillIds: ['mes-ops-analysis'],
      usedConnectorIds: ['mes', 'mcp-chart'],
      skillTitles: { 'mes-ops-analysis': 'MES 运营分析' },
      connectorTitles: { mes: '公司 MES', 'mcp-chart': 'AntV 图表' },
    })
    assert.equal(mixed.length, 4)
    assert.equal(mixed[0].kind, 'coding')
    assert.equal(mixed[1].label, 'MES 运营分析')
    assert.equal(mixed[2].kind, 'connector')
    assert.equal(mixed[2].label, '公司 MES')
    assert.equal(mixed[3].label, 'AntV 图表')
    assert.equal(buildSkillMcpRows({ jobs: [], usedSkillIds: [], usedConnectorIds: [] }).length, 0)
  })

  it('source rows only from user inputs, never workspace changes', () => {
    const empty = buildSourceRows({
      jobImages: [],
      messageAttachments: [],
    })
    assert.equal(empty.length, 0)
    const rows = buildSourceRows({
      jobImages: [{ name: 'shot.png', path: '/tmp/shot.png' }],
      messageAttachments: [{ name: 'spec.pdf', path: '/tmp/spec.pdf', kind: 'file' }],
    })
    assert.equal(rows.length, 2)
    assert.equal(rows[0].origin, 'user')
    assert.equal(rows[0].kind, 'image')
    assert.equal(rows[1].name, 'spec.pdf')
    assert.equal(isNonUserSourcePath('.dsh-cursor-chat/reviews/x-审码报告.md'), true)
    const fromEv = extractUserAttachmentsFromEvents([
      {
        type: 'user/message',
        data: {
          message: {
            source: { kind: 'user' },
            content: [
              { type: 'text', text: '看看这个' },
              { type: 'image', name: 'ui.png', path: '/tmp/uploads/ui.png', mimeType: 'image/png' },
              {
                type: 'file',
                name: 'spec.pdf',
                path: '/home/x/attachments/v1/objects/spec.pdf',
                attachment: { id: 'att-1', name: 'spec.pdf' },
              },
              // 裸工作区路径：禁止当来源
              { type: 'file', name: 'MaterialOutboundView.vue', path: 'src/views/MaterialOutboundView.vue' },
              {
                type: 'file',
                name: 'cch-审码报告.md',
                path: '.dsh-cursor-chat/reviews/cch-审码报告.md',
              },
            ],
          },
        },
      },
      {
        type: 'user/message',
        data: {
          message: {
            source: { kind: 'plugin' },
            content: [{ type: 'file', name: 'injected.bin', path: '/x', attachment: { id: 'p' } }],
          },
        },
      },
    ])
    assert.equal(fromEv.length, 2)
    assert.equal(fromEv[0].name, 'ui.png')
    assert.equal(fromEv[1].name, 'spec.pdf')
  })

  it('builds absolute file resource URI without session scope', () => {
    assert.equal(
      resolveWorkspaceAbsPath('/Users/hebo/proj', 'src/a.vue'),
      '/Users/hebo/proj/src/a.vue',
    )
    assert.equal(resolveWorkspaceAbsPath('/Users/hebo/proj', '/abs/x.ts'), '/abs/x.ts')
    const uri = buildAbsoluteFileResourceUri('/Users/hebo/proj/src/MaterialOutboundView.vue')
    assert.equal(uri.indexOf('dsh-resource://file/absolute/'), 0)
    assert.ok(uri.indexOf('session/') < 0)
    assert.ok(uri.indexOf('MaterialOutboundView.vue') > 0)
  })
})
