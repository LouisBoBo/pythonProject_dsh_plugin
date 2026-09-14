/**
 * 阶段 B+C 自检：HITL + Mock Cursor → pending_review → apply 同步 + 续改。
 * 用法：CURSOR_CODING_MOCK=1 pnpm build && pnpm self-test
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _resetHitlStoreForTests, consume, issue } from './hitl.js'
import { loadConfig, saveConfig } from './config.js'
import { pathInScope } from './pathScope.js'
import {
  _resetPendingConfirmForTests,
  bindPendingJob,
  createPendingConfirm,
  findPendingForCard,
} from './pendingConfirm.js'
import { inferSparseBeforeAfter, diffSnapshots, prepareSandboxForJob, prepareSandboxSparse, prepareSandboxReuse } from './sandbox.js'
import {
  cardIdentity,
  detachStaleJobUi,
  requirementsConflict,
} from './cardBootstrap.js'
import { buildLiveEditSnippet, previewFileSnippet } from './editSnippet.js'
import {
  isProcessAssistantText,
  preferredConclusionAssistantText,
  refineAssistantSegmentText,
  relativizeToolPath,
  toolCommandFromArgs,
  toolPathFromArgs,
  toolPatternFromArgs,
  toolResultPreview,
  toolSnippetFromArgs,
  toolTodoSnippetFromArgs,
  snippetFromTextDiff,
  normalizeStatusDisplay,
} from './transcript.js'
import { createJob, findLatestJobForSession, loadJob, patchJob, setStatus } from './jobs.js'
import {
  hasClarifyEvidence,
  looksLikeFollowUp,
  needsRequirementClarify,
} from './requirementGate.js'
import { decideCodingGate, readAskUserAfterLastUser } from './clarifyFlow.js'
import {
  expandWriteScopeWithCompanions,
  selectCompanionPromotions,
} from './scopeCompanions.js'
import { compactParentHandoff } from './sessionMemory.js'
import { startServer, stopServer, getListenAddr } from './server.js'
import { checkCompat, satisfiesRange } from './compat.js'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

function withConfirmToken(
  workspace: string,
  requirement: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const pending = createPendingConfirm({ workspace, requirement })
  return { workspace, requirement, confirm_token: pending.id, ...extra }
}

async function waitJobStatus(
  base: string,
  jobId: string,
  statuses: string[],
  timeoutMs = 15000,
): Promise<{
  status: string
  detail?: string
  synced_files?: string[]
  review_in_scope?: string[]
}> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(base + '/api/cursor-coding/jobs/' + encodeURIComponent(jobId))
    const body = (await res.json()) as {
      job?: {
        status?: string
        detail?: string
        synced_files?: string[]
        review_in_scope?: string[]
      }
    }
    const st = body.job?.status || ''
    if (statuses.includes(st)) {
      return {
        status: st,
        detail: body.job?.detail,
        synced_files: body.job?.synced_files,
        review_in_scope: body.job?.review_in_scope,
      }
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('等待任务状态超时（期望 ' + statuses.join('|') + '）')
}

async function main() {
  process.env.CURSOR_CODING_MOCK = '1'
  const prevHome = process.env.CURSOR_CODING_HOME
  const home = mkdtempSync(join(tmpdir(), 'cc-self-test-'))
  process.env.CURSOR_CODING_HOME = home
  process.env.CURSOR_CODING_PORT = '18789'
  delete process.env.CURSOR_API_KEY

  const workspace = mkdtempSync(join(tmpdir(), 'cc-ws-'))
  writeFileSync(join(workspace, 'README.md'), '# self-test\n', 'utf8')

  // ~/ 展开：Agent 常传 ~/Desktop/...
  {
    const { homedir } = await import('node:os')
    const { resolve } = await import('node:path')
    const tilde = '~/Desktop/fake-ws-for-cc-test'
    const expanded = tilde.startsWith('~/')
      ? resolve(homedir(), tilde.slice(2))
      : resolve(tilde)
    assert(expanded === resolve(homedir(), 'Desktop/fake-ws-for-cc-test'), '~/ 展开失败')
    console.log('ok: tilde expand contract')
  }

  // 门禁极薄：只拦空诉求；意图分流交给 LLM（工具 description）
  {
    const colMsg = '员工工时报表列表新增一列班别 分白班和晚班'
    assert(!needsRequirementClarify(colMsg), '新增一列不得被当成新页面硬拦')
    assert(!needsRequirementClarify('员工工时报表写入成功 但提示请求失败 请修复'), '修 bug 不得硬拦')
    assert(needsRequirementClarify(''), '空诉求应硬拦')
    assert(needsRequirementClarify('再改一下', true) === false, 'clarified=true 应放行')
    assert(
      needsRequirementClarify('报表中心菜单新增设备维修报表'),
      '新增菜单/报表入口必须澄清',
    )
    assert(
      needsRequirementClarify('报表中心菜单删除设备维修、设备保养、设备点检报表'),
      '删除菜单/报表入口必须澄清',
    )
    assert(
      needsRequirementClarify('报表中心菜单删除设备维修、设备保养、设备点检报表', true),
      '空传 clarified=true 不得跳过澄清',
    )
    assert(
      needsRequirementClarify('报表中心菜单彻底删除员工工时报表', true),
      '原话含彻底删除 + 空 clarified 仍须拦',
    )
    assert(
      hasClarifyEvidence('报表中心菜单彻底删除员工工时报表') === false,
      '原话不得算已澄清',
    )
    assert(
      hasClarifyEvidence('报表中心菜单彻底删除员工工时报表\n范围：菜单入口 + 对应页面文件/路由'),
      '选择题结论（菜单入口+页面/路由）应算已澄清',
    )
    assert(
      !needsRequirementClarify(
        '报表中心菜单彻底删除员工工时报表\n范围：菜单入口 + 对应页面文件/路由',
        true,
      ),
      '答完选择题后的范围结论应出确认卡',
    )
    {
      const orig = '报表中心菜单彻底删除员工工时报表'
      assert(decideCodingGate({ message: orig }).action === 'block', '无事件须拦')
      assert(
        decideCodingGate({ message: orig, clarified: true }).action === 'block',
        '空 clarified 不得跳过',
      )
      const events = [
        { type: 'user/message', data: { message: { content: orig } } },
        { type: 'tool/call', data: { callId: 'c1', name: 'ask_user_question', arguments: '{}' } },
        {
          type: 'tool/result',
          data: {
            message: {
              source: { kind: 'tool', callId: 'c1' },
              content: [
                {
                  type: 'tool-result',
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify({
                        answers: [
                          {
                            id: 'scope',
                            selected: ['菜单入口 + 对应页面文件/路由'],
                          },
                        ],
                      }),
                    },
                  ],
                },
              ],
            },
          },
        },
      ]
      const ask = readAskUserAfterLastUser(events)
      assert(ask.answered === true, 'DSH call/result 配对应算已答完')
      assert(ask.summary.includes('菜单入口'), '应抽出选项文案')
      const passed = decideCodingGate({ message: orig, clarified: true, events })
      if (passed.action !== 'pass') throw new Error('答完后即使原话也放出确认卡')
      assert(passed.via === 'ask_user_answered', 'via 应为会话答完')
      assert(passed.requirement.includes('澄清结论'), '应把选项并进诉求')
      const evidence = decideCodingGate({
        message: orig + '\n范围：菜单入口 + 对应页面文件/路由',
        clarified: true,
      })
      if (evidence.action !== 'pass') throw new Error('无事件时文案兜底仍放行')
      assert(evidence.via === 'message_evidence', 'via 应为文案兜底')
      assert(
        decideCodingGate({
          message: orig,
          clarified: true,
          events: [
            { type: 'user/message', data: {} },
            { type: 'tool/call', data: { callId: 'c1', name: 'ask_user_question', arguments: '{}' } },
          ],
        }).action === 'block',
        '只出题未作答仍须拦',
      )
    }
    assert(
      !needsRequirementClarify(
        '报表中心菜单删除设备维修等报表\n澄清：只去菜单项，保留路由与页面文件',
        true,
      ),
      '带澄清痕迹后应放行',
    )
    assert(
      needsRequirementClarify('报表中心新增一个员工考勤汇总页'),
      '新增页面必须澄清',
    )
    assert(
      !needsRequirementClarify(
        '报表中心菜单新增设备维修报表\n澄清结论：明细表+筛选+分页',
        true,
      ),
      '澄清后应放行',
    )
    assert(looksLikeFollowUp(colMsg), '非空诉求可挂续改 parent')
    assert(looksLikeFollowUp('从零新增一个全新报表中心模块'), '非空即可；是否 begin/continue 由 LLM 选工具')
    const j = createJob({ workspace, requirement: 't' })
    setStatus(j, 'succeeded', 'ok')
    patchJob(j.id, { conclusion_delivered: true })
    assert(loadJob(j.id)?.conclusion_delivered === true, 'conclusion_delivered 应落盘')
    console.log('ok: page/menu clarify gate + conclusion_delivered')
  }

  // 进度卡代码片断：从写码工具 args 抽取、限行、敏感路径跳过
  {
    const sn = toolSnippetFromArgs(
      {
        path: 'src/a.ts',
        old_string: 'const x = 1',
        new_string: 'const x = 2\nconst y = 3\n',
      },
      'StrReplace',
      'src/a.ts',
    )
    assert(sn && sn.includes('+ const x = 2'), 'StrReplace 应抽 +new_string 片断')
    assert(!toolSnippetFromArgs({ path: '.env', contents: 'SECRET=1' }, 'Write', '.env'), '.env 不得抽片断')
    assert(!toolSnippetFromArgs({ path: 'a.ts', pattern: 'foo' }, 'Grep', 'a.ts'), 'Grep 不抽写码片断')
    assert(toolPathFromArgs({ path: 'a.ts', pattern: 'foo' }) === 'a.ts', 'path 不得被 pattern 污染')
    assert(toolPatternFromArgs({ path: 'a.ts', pattern: 'foo' }) === 'foo', '应抽出 pattern')
    assert(toolCommandFromArgs({ command: 'pytest -q' }) === 'pytest -q', '应抽出 command')
    assert(
      toolCommandFromArgs({ command: 'curl -H "Authorization: Bearer secret123"' }) ===
        '[已隐藏敏感命令]',
      '含 token 的命令不得进进度卡',
    )
    assert(!toolResultPreview({ content: 'api_key=abcd' }, 'Read', 'a.ts'), '结果含密钥不得预览')
    assert(
      toolResultPreview({ content: 'line1\nline2\n' }, 'Read', 'a.ts')?.includes('line1'),
      'Read 应有结果摘要',
    )
    assert(
      toolTodoSnippetFromArgs(
        {
          todos: [
            { content: 'A', status: 'completed' },
            { content: 'B', status: 'in_progress' },
          ],
        },
        'TodoWrite',
      )?.includes('[x] A'),
      'TodoWrite 应有清单摘要',
    )
    assert(isProcessAssistantText('接下来补前端菜单。'), '过程话应展示')
    assert(!isProcessAssistantText('## 说明方案\n**结论**\n完成'), '终稿不得进进度卡')
    assert(
      refineAssistantSegmentText(
        '先摸清仓库。\n后端已有 API。',
        ['先摸清仓库。'],
      ) === '后端已有 API。',
      '助手段应去掉复读前缀',
    )
    assert(
      refineAssistantSegmentText('## 说明方案\n**结论**\nok', ['过程']) === '',
      '纯终稿段应为空',
    )
    assert(
      refineAssistantSegmentText(
        '其余报表菜单与页面正常## 说明方案\n**结论：**\n已删除\n\n**验收步骤：**\n1. 刷新',
        [],
      ) === '其余报表菜单与页面正常',
      '粘在行尾的说明方案标题应剥掉',
    )
    assert(refineAssistantSegmentText('##\n\n**结论：**\n已删除', []) === '', '孤立##+结论体应丢弃')
    assert(
      refineAssistantSegmentText(
        '**结论：**\n已删除\n\n**改动文件：**\na.js\n\n**验收步骤：**\n1. x',
        [],
      ) === '',
      '无标题终稿体不得进进度卡',
    )
    assert(normalizeStatusDisplay('RUNNING') === 'Cursor 运行中，请稍候…', 'RUNNING 应中文化')
    const pref = preferredConclusionAssistantText(
      '先摸底…\n\n## 说明方案\n**菜单**\nok\n\n## 说明方案\n**菜单**\nok\n',
    )
    assert(pref.startsWith('## 说明方案'), '结论应优先取说明方案段')
    assert(pref.split('## 说明方案').length === 2, '终稿双份应去重')
    const live = snippetFromTextDiff('const a = 1\n', 'const a = 2\nconst b = 3\n')
    assert(live && live.includes('- const a = 1') && live.includes('+ const a = 2'), '沙箱 diff 片断应含 +/-')
    console.log('ok: progress tool snippets')
  }

  // 真实 edit 无 args：沙箱 diff + 写入后才发 running 的污染场景 + 预览兜底
  {
    const root = mkdtempSync(join(tmpdir(), 'cc-snip-'))
    const ws = join(root, 'ws')
    const sb = join(root, 'sb')
    mkdirSync(join(ws, 'src'), { recursive: true })
    mkdirSync(join(sb, 'src'), { recursive: true })
    writeFileSync(join(ws, 'src', 'a.ts'), 'export const a = 1\n', 'utf8')
    // 模拟 SDK：先写入沙箱，再发 running（旧逻辑会污染基线）
    writeFileSync(join(sb, 'src', 'a.ts'), 'export const a = 2\nexport const b = 3\n', 'utf8')
    const baseline = new Map<string, string>()
    buildLiveEditSnippet({
      sandbox: sb,
      workspace: ws,
      relPath: 'src/a.ts',
      baseline,
      phase: 'running',
    })
    const sn = buildLiveEditSnippet({
      sandbox: sb,
      workspace: ws,
      relPath: 'src/a.ts',
      baseline,
      phase: 'completed',
    })
    assert(sn && sn.includes('+ export const a = 2'), '晚到 running 仍须出 +/- diff，实际=' + sn)
    assert(previewFileSnippet('a\n\nb\nc\n')?.includes('c'), '预览兜底应取尾部非空行')
    // 无变更时也要有预览片断
    const baseline2 = new Map<string, string>()
    writeFileSync(join(ws, 'src', 'same.ts'), 'same line\n', 'utf8')
    writeFileSync(join(sb, 'src', 'same.ts'), 'same line\n', 'utf8')
    const prev = buildLiveEditSnippet({
      sandbox: sb,
      workspace: ws,
      relPath: 'src/same.ts',
      baseline: baseline2,
      phase: 'completed',
    })
    assert(prev && prev.includes('same line'), '无 diff 时须文件预览兜底')
    rmSync(root, { recursive: true, force: true })
    console.log('ok: live edit snippet race + fallback')
  }

  // 工具卡串台：新诉求不得挂上旧「已完成」job
  {
    const oldUi = {
      job_id: 'ccj-20260912-191312-37f8',
      requirement: '报表中心菜单新增设备点检报表\n澄清结论…',
      status: 'succeeded',
      kind: 'live',
    }
    const det = detachStaleJobUi({
      ui: oldUi,
      argsMessage: '报表中心菜单新增设备维修报表\n澄清结论…',
    })
    assert(det.stale === true, '点检→维修应判定串台')
    assert(!det.ui.job_id, '串台后必须清空 job_id')
    assert(String(det.ui.requirement || '').includes('维修'), '应改用本轮维修诉求')
    const same = detachStaleJobUi({
      ui: oldUi,
      argsMessage: '报表中心菜单新增设备点检报表 澄清结论',
    })
    assert(same.stale === false, '同诉求刷新不应误拆')
    assert(requirementsConflict('设备点检报表', '设备维修报表'), '点检/维修须冲突')
    assert(
      cardIdentity({ callId: 'call-new' }) !== cardIdentity({ callId: 'call-old' }),
      '不同 callId 须不同卡身份',
    )
    console.log('ok: card bootstrap anti-stale')
    {
      const dir = mkdtempSync(join(tmpdir(), 'cc-sparse-'))
      const ws = join(dir, 'ws')
      const sb = join(dir, 'sb')
      mkdirSync(join(ws, 'frontend/src/views/reports'), { recursive: true })
      mkdirSync(join(ws, 'frontend/src/views/other'), { recursive: true })
      mkdirSync(join(sb, 'frontend/src/views/reports'), { recursive: true })
      writeFileSync(join(ws, 'frontend/src/views/reports/Keep.vue'), 'keep')
      writeFileSync(join(ws, 'frontend/src/views/reports/Gone.vue'), 'gone')
      writeFileSync(join(ws, 'frontend/src/views/other/Skip.vue'), 'skip')
      writeFileSync(join(sb, 'frontend/src/views/reports/Keep.vue'), 'keep')
      const { before, after } = inferSparseBeforeAfter(ws, sb, ['frontend/src/views/'])
      const diff = diffSnapshots(before, after)
      assert(
        diff.deleted.includes('frontend/src/views/reports/Gone.vue'),
        '同目录缺失应视为删除',
      )
      assert(
        !diff.deleted.some((p) => p.includes('Skip.vue')),
        '未进沙箱的目录不得当删除',
      )
      rmSync(dir, { recursive: true, force: true })
      console.log('ok: sparse infer delete')
    }
  }

  // 写范围连带 + 审后提升（防半套契约）
  {
    const expanded = expandWriteScopeWithCompanions(['backend/app/routers/', 'frontend/src/views/reports/'])
    assert(expanded.some((x) => x.endsWith('schemas.py')), 'routers 应连带 schemas.py')
    assert(expanded.some((x) => x.endsWith('models.py')), 'routers 应连带 models.py')
    assert(expanded.some((x) => x.includes('api/')), 'views 应连带 api/')
    const promoted = selectCompanionPromotions(
      ['backend/app/routers/reports.py'],
      ['backend/app/schemas.py', 'backend/erp.db', 'README.md'],
    )
    assert(promoted.includes('backend/app/schemas.py'), '应提升 schemas.py')
    assert(!promoted.includes('backend/erp.db'), '不应提升 db')
    const byScope = selectCompanionPromotions(
      [],
      ['backend/app/schemas.py'],
      ['backend/app/routers/'],
    )
    assert(byScope.includes('backend/app/schemas.py'), '仅写范围含 routers 也应提升 schemas')
    console.log('ok: scope companions')
  }

  try {
    _resetHitlStoreForTests()
    _resetPendingConfirmForTests()
    saveConfig({
      listen: '127.0.0.1',
      port: 18789,
      cursorApiKey: '',
      writeScope: [],
      dataRoot: home,
      model: 'composer-2.5',
    })

    const boot = await startServer()
    assert(boot.ok, '服务启动失败: ' + boot.detail)
    const base = getListenAddr()
    assert(base, '无 listen addr')

    {
      assert(satisfiesRange('1.0.40', '>=1.0.31 <2.0.0'), 'semver range 应通过')
      assert(!satisfiesRange('2.0.0', '>=1.0.31 <2.0.0'), 'semver range 应拒绝大版本')
      const compat = checkCompat()
      assert(compat.ok, '兼容自检应通过: ' + compat.detail)
      const health = await fetch(base + '/health')
      const hj = (await health.json()) as {
        compat?: { ok?: boolean }
        serverMode?: string
        pluginVersion?: string
      }
      assert(hj.compat && hj.compat.ok === true, 'health.compat.ok 应为 true')
      assert(hj.pluginVersion, 'health 应含 pluginVersion')
      console.log('ok: compat + health', hj.serverMode || '?', hj.pluginVersion)
    }

    // 会话隔离：同一工作区两张卡不得互相抢 pending / 已开工 job
    {
      _resetPendingConfirmForTests()
      const a = createPendingConfirm({
        workspace,
        requirement: '会话A新增报表',
        call_id: 'call-a',
        session_id: 'sess-a',
      })
      const b = createPendingConfirm({
        workspace,
        requirement: '会话B改按钮',
        call_id: 'call-b',
        session_id: 'sess-b',
      })
      bindPendingJob(a.id, 'ccj-old-from-a')
      const hitB = findPendingForCard({
        workspace,
        call_id: 'call-b',
        session_id: 'sess-b',
        requirement: '会话B改按钮',
      })
      assert(hitB && hitB.id === b.id, 'call-b 应对上自己的 waiting pending')
      assert(!hitB.job_id, 'B 卡不应拿到 A 的 job_id')
      const hitA = findPendingForCard({ workspace, call_id: 'call-a' })
      assert(hitA && hitA.job_id === 'ccj-old-from-a', 'call-a 刷新后仍应对上已开工 job')
      const steal = findPendingForCard({
        workspace,
        session_id: 'sess-b',
        requirement: '会话B改按钮',
      })
      assert(steal && steal.id === b.id && steal.status === 'waiting', '无 call_id 时也不得返回已开工的 A')
      assert(
        !findPendingForCard({ workspace }),
        '仅 workspace 不得命中 pending（防 CSRF）',
      )
      const resBare = await fetch(
        base +
          '/api/cursor-coding/pending-latest?workspace=' +
          encodeURIComponent(workspace),
      )
      assert(resBare.status === 400, '仅 workspace 的 pending-latest 应 400，实际 ' + resBare.status)
      const resA = await fetch(
        base +
          '/api/cursor-coding/pending-latest?workspace=' +
          encodeURIComponent(workspace) +
          '&call_id=call-b',
      )
      const bodyA = (await resA.json()) as { pending?: { confirm_token?: string; job_id?: string } }
      assert(bodyA.pending && bodyA.pending.confirm_token === b.id, 'HTTP call_id 应对 B')
      assert(!bodyA.pending.job_id, 'HTTP 不得把 A 的 job 交给 B')
      _resetPendingConfirmForTests()
      console.log('ok: pending-latest isolated by call_id')
    }

    // 续改记忆：按 DSH session 隔离，不按工作区抢最新成功 Job
    {
      const wsIso = workspace + '-iso'
      mkdirSync(wsIso, { recursive: true })
      const ja = createJob({
        workspace: wsIso,
        requirement: '会话A',
        dsh_session_id: 'sess-a',
        dsh_call_id: 'call-a',
      })
      setStatus(ja, 'succeeded', 'A完成')
      const jb = createJob({
        workspace: wsIso,
        requirement: '会话B',
        dsh_session_id: 'sess-b',
        dsh_call_id: 'call-b',
      })
      setStatus(jb, 'succeeded', 'B完成')
      const hitB = findLatestJobForSession({ workspace: wsIso, session_id: 'sess-b' })
      assert(hitB && hitB.id === jb.id, '续改应命中本会话 Job')
      const miss = findLatestJobForSession({ workspace: wsIso, session_id: 'sess-x' })
      assert(!miss, '其它会话不得继承 Job')
      const noSid = findLatestJobForSession({ workspace: wsIso })
      assert(!noSid, '无 session_id 时不得按工作区抢成功 Job')
      const handoff = compactParentHandoff(loadJob(jb.id)!)
      assert(handoff.includes('parent=' + jb.id), 'handoff 须带 parent id')
      assert(handoff.includes('会话B'), 'handoff 须带上次诉求')
      console.log('ok: session-scoped job memory')
    }

    // 非本机 Origin：403
    {
      const res = await fetch(base + '/api/hitl/issue', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://evil.example',
        },
        body: JSON.stringify({
          action: 'cursor-coding.confirm',
          workspace,
          requirement: 'x',
        }),
      })
      assert(res.status === 403, '恶意 Origin 应 403，实际 ' + res.status)
    }

    // 无 Key：403
    {
      const pending = createPendingConfirm({ workspace, requirement: '改一下标题' })
      const issued = issue({
        action: 'cursor-coding.confirm',
        workspace,
        requirement: '改一下标题',
        confirm_token: pending.id,
      })
      const res = await fetch(base + '/api/cursor-coding/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace,
          requirement: '改一下标题',
          confirm_token: pending.id,
          nonce: issued.nonce,
        }),
      })
      assert(res.status === 403, '无 Key 时应 403，实际 ' + res.status)
    }

    saveConfig({ cursorApiKey: 'test-key-not-real' })
    _resetHitlStoreForTests()
    _resetPendingConfirmForTests()

    // 无 nonce：401
    {
      const res = await fetch(base + '/api/cursor-coding/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withConfirmToken(workspace, '改一下标题')),
      })
      assert(res.status === 401, '无 nonce 应 401，实际 ' + res.status)
    }

    // HTTP 签发 confirm 无 token：400
    {
      const res = await fetch(base + '/api/hitl/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'cursor-coding.confirm',
          workspace,
          requirement: '改一下标题',
        }),
      })
      assert(res.status === 400, 'HTTP confirm 无 confirm_token 应 400，实际 ' + res.status)
    }

    // 无 confirm_token：400
    {
      const issued = issue({
        action: 'cursor-coding.confirm',
        workspace,
        requirement: '改一下标题',
      })
      const res = await fetch(base + '/api/cursor-coding/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace,
          requirement: '改一下标题',
          nonce: issued.nonce,
        }),
      })
      assert(res.status === 400, '无 confirm_token 应 400，实际 ' + res.status)
    }

    // Mock → 默认自动同步 → succeeded；真工程出现 mock 文件
    let jobId = ''
    {
      const issued = issue({
        action: 'cursor-coding.confirm',
        workspace,
        requirement: '阶段 B 自检写码',
      })
      const res = await fetch(base + '/api/cursor-coding/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          withConfirmToken(workspace, '阶段 B 自检写码', { nonce: issued.nonce }),
        ),
      })
      const data = (await res.json()) as { ok?: boolean; job_id?: string }
      assert(res.ok && data.ok && data.job_id, 'confirm 应成功')
      jobId = data.job_id!

      const again = consume({
        nonce: issued.nonce,
        action: 'cursor-coding.confirm',
        workspace,
        requirement: '阶段 B 自检写码',
      })
      assert(!again.ok, 'nonce 不得复用')

      const terminal = await waitJobStatus(base, jobId, ['succeeded', 'failed', 'pending_review'])
      assert(terminal.status === 'succeeded', '默认应自动同步为 succeeded，实际 ' + terminal.status + ' ' + terminal.detail)
      assert(
        existsSync(join(workspace, '.cursor-coding-mock.md')),
        '自动同步后真工程应出现 mock 文件',
      )
      const body = readFileSync(join(workspace, '.cursor-coding-mock.md'), 'utf8')
      assert(body.includes('阶段 B 自检'), '同步内容应含诉求摘要')
      const jobRes = await fetch(base + '/api/cursor-coding/jobs/' + encodeURIComponent(jobId))
      const jobJson = (await jobRes.json()) as {
        job?: {
          assistant_text?: string
          transcript?: { kind?: string; name?: string; snippet?: string }[]
          thinking_text?: string
        }
      }
      assert(
        String(jobJson.job?.assistant_text || '').includes('说明方案'),
        'assistant_text 应保留 Cursor 正文',
      )
      assert(
        Array.isArray(jobJson.job?.transcript) && (jobJson.job?.transcript?.length || 0) > 0,
        'transcript 应有对话片段',
      )
      const writeTool = (jobJson.job?.transcript || []).find(
        (it) =>
          it.kind === 'tool' &&
          /write|edit/i.test(String(it.name || '')),
      )
      assert(writeTool && String(writeTool.snippet || '').length > 0, '写码工具进度行应带代码片断（无 args 时由沙箱 diff/预览补齐）')
      assert(
        /mock run|\+ |export|requirement/i.test(String(writeTool.snippet || '')),
        '片断应含实际代码内容，实际=' + String(writeTool.snippet || '').slice(0, 80),
      )
      assert(String(jobJson.job?.thinking_text || '').length > 0, 'thinking_text 应有内容（Mock）')

      // cancel 须 HITL
      {
        const bad = await fetch(
          base + '/api/cursor-coding/jobs/' + encodeURIComponent(jobId) + '/cancel',
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
        )
        assert(bad.status === 401, 'cancel 无 nonce 应 401，实际 ' + bad.status)
      }
    }

    // 续改：带 parent_job_id + 新诉求（增列班别）→ 新 job，不得复用旧 job id
    {
      _resetHitlStoreForTests()
      const contReq = '员工工时报表列表新增一列班别 分白班和晚班'
      const issued = issue({
        action: 'cursor-coding.confirm',
        workspace,
        requirement: contReq,
      })
      const res = await fetch(base + '/api/cursor-coding/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          withConfirmToken(workspace, contReq, {
            nonce: issued.nonce,
            parent_job_id: jobId,
          }),
        ),
      })
      const data = (await res.json()) as { ok?: boolean; job_id?: string }
      assert(res.ok && data.ok && data.job_id, '增列续改 confirm 应成功')
      assert(data.job_id !== jobId, '续改必须产生新 job_id，禁止复用旧完成任务')
      const childId = data.job_id!
      const terminal = await waitJobStatus(base, childId, ['succeeded', 'failed', 'pending_review'])
      assert(
        terminal.status === 'succeeded' || terminal.status === 'pending_review',
        '续改应跑完，实际 ' + terminal.status,
      )
      const jobRes = await fetch(base + '/api/cursor-coding/jobs/' + encodeURIComponent(childId))
      const jobBody = (await jobRes.json()) as {
        job?: { parent_job_id?: string; requirement?: string; status?: string }
      }
      assert(jobBody.job?.parent_job_id === jobId, '续改应记录 parent_job_id')
      assert(String(jobBody.job?.requirement || '').includes('班别'), '续改诉求应是本轮增列，不是旧请求失败文案')
      console.log('ok: continue new job for column tweak')
    }

    // 续改：带 parent_job_id → 自动同步成功
    {
      _resetHitlStoreForTests()
      const issued = issue({
        action: 'cursor-coding.confirm',
        workspace,
        requirement: '再改一下',
      })
      const res = await fetch(base + '/api/cursor-coding/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          withConfirmToken(workspace, '再改一下', {
            nonce: issued.nonce,
            parent_job_id: jobId,
          }),
        ),
      })
      const data = (await res.json()) as { ok?: boolean; job_id?: string }
      assert(res.ok && data.ok && data.job_id, '续改 confirm 应成功')
      const childId = data.job_id!
      const terminal = await waitJobStatus(base, childId, ['succeeded', 'failed', 'pending_review'])
      assert(terminal.status === 'succeeded', '续改应自动同步 succeeded，实际 ' + terminal.status)
    }

    // 关闭自动同步时仍走 pending_review → 手工 apply
    {
      // 子进程隔离时 env 在 spawn 时固定，改 AUTO_APPLY 需重启服务
      await stopServer()
      process.env.CURSOR_CODING_AUTO_APPLY = '0'
      const reboot = await startServer()
      assert(reboot.ok, '重启服务失败: ' + reboot.detail)
      _resetHitlStoreForTests()
      const issued = issue({
        action: 'cursor-coding.confirm',
        workspace,
        requirement: '手工审同步',
      })
      const res = await fetch(base + '/api/cursor-coding/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          withConfirmToken(workspace, '手工审同步', { nonce: issued.nonce }),
        ),
      })
      const data = (await res.json()) as { ok?: boolean; job_id?: string }
      assert(res.ok && data.ok && data.job_id, '手工模式 confirm 应成功')
      const mid = data.job_id!
      const review = await waitJobStatus(base, mid, ['pending_review', 'succeeded', 'failed'])
      assert(review.status === 'pending_review', 'AUTO_APPLY=0 应为 pending_review')
      const files = review.review_in_scope || []
      assert(files.length > 0, 'review_in_scope 应非空')
      _resetHitlStoreForTests()
      const issued2 = issue({ action: 'cursor-coding.apply', job_id: mid })
      const applyRes = await fetch(base + '/api/cursor-coding/jobs/' + encodeURIComponent(mid) + '/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nonce: issued2.nonce, accept: files }),
      })
      const applyData = (await applyRes.json()) as { ok?: boolean }
      assert(applyRes.ok && applyData.ok, '手工 apply 应成功')
      await stopServer()
      delete process.env.CURSOR_CODING_AUTO_APPLY
      const back = await startServer()
      assert(back.ok, '恢复 AUTO_APPLY 后重启失败: ' + back.detail)
    }

    console.log('[self-test] 阶段 B+C 全部通过（Mock Cursor + 自动同步 + 手工回退）')
    console.log('[self-test] port=', 18789)

    // 续改复用父沙箱（AUTO_APPLY 开）
    {
      _resetHitlStoreForTests()
      const issued = issue({
        action: 'cursor-coding.confirm',
        workspace,
        requirement: '复用沙箱续改',
      })
      const res = await fetch(base + '/api/cursor-coding/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          withConfirmToken(workspace, '复用沙箱续改', {
            nonce: issued.nonce,
            parent_job_id: jobId,
          }),
        ),
      })
      const data = (await res.json()) as { ok?: boolean; job_id?: string }
      assert(res.ok && data.ok && data.job_id, '复用续改 confirm 应成功')
      const childId = data.job_id!
      const terminal = await waitJobStatus(base, childId, ['succeeded', 'failed', 'pending_review'])
      assert(terminal.status === 'succeeded', '复用续改应 succeeded')
      const jobRes = await fetch(base + '/api/cursor-coding/jobs/' + encodeURIComponent(childId))
      const jobBody = (await jobRes.json()) as {
        job?: {
          parent_job_id?: string
          continue_count?: number
          transcript?: { kind?: string; text?: string }[]
        }
      }
      assert(jobBody.job?.parent_job_id === jobId, '应记录 parent_job_id')
      assert((jobBody.job?.continue_count || 0) >= 1, 'continue_count 应 >= 1')
      const reuseStatus = (jobBody.job?.transcript || []).find(
        (it) => it.kind === 'status' && String(it.text || '').includes('reuse'),
      )
      assert(reuseStatus, '续改应复用父沙箱（status 含 reuse）')
    }

    // 稀疏沙箱加厚（只读上下文；不扩大同步权限）
    {
      const sparseWs = mkdtempSync(join(tmpdir(), 'cc-sparse-'))
      try {
        mkdirSync(join(sparseWs, 'src'), { recursive: true })
        writeFileSync(join(sparseWs, 'package.json'), '{"name":"t"}\n', 'utf8')
        writeFileSync(join(sparseWs, 'README.md'), '# t\n', 'utf8')
        writeFileSync(join(sparseWs, 'src', 'a.ts'), 'export const a = 1\n', 'utf8')
        writeFileSync(join(sparseWs, 'src', 'b.ts'), 'export const b = 2\n', 'utf8')
        const meta = prepareSandboxSparse(home, 'ccj-sparse-thicken', sparseWs, ['src/a.ts'])
        assert(meta.mode === 'sparse', '应为 sparse')
        assert(existsSync(join(meta.sandbox, 'src/a.ts')), '写范围文件应存在')
        assert(existsSync(join(meta.sandbox, 'package.json')), '应拷入根锚点 package.json')
        assert(existsSync(join(meta.sandbox, 'src/b.ts')), '应拷入同级只读上下文')
        assert((meta.context_files || 0) >= 1, '应有 context_files')
        assert(!pathInScope('package.json', ['src/a.ts']), '锚点不在同步写范围')
        assert(!pathInScope('src/b.ts', ['src/a.ts']), '同级文件不在同步写范围')
        const rel = relativizeToolPath(join(meta.sandbox, 'src/a.ts'), meta.sandbox)
        assert(rel === 'src/a.ts', '工具路径应相对化，实际=' + rel)
        console.log('[self-test] 稀疏加厚 + 路径相对化 OK', meta.copied_files, meta.context_files)
      } finally {
        try {
          rmSync(sparseWs, { recursive: true, force: true })
        } catch {
          /* ignore */
        }
      }
    }

    // 父沙箱复用单元：父有独有文件 + 真工程刷新覆盖
    {
      const reuseWs = mkdtempSync(join(tmpdir(), 'cc-reuse-ws-'))
      const parentHome = home
      try {
        mkdirSync(join(reuseWs, 'src'), { recursive: true })
        writeFileSync(join(reuseWs, 'package.json'), '{"name":"reuse"}\n', 'utf8')
        writeFileSync(join(reuseWs, 'src', 'a.ts'), 'export const a = 1\n', 'utf8')
        const parentMeta = prepareSandboxSparse(parentHome, 'ccj-parent-sb', reuseWs, ['src/a.ts'])
        writeFileSync(join(parentMeta.sandbox, 'src', 'only-in-parent.ts'), 'parent-only\n', 'utf8')
        writeFileSync(join(reuseWs, 'src', 'a.ts'), 'export const a = 2\n', 'utf8') // 真工程已更新
        const child = prepareSandboxReuse(
          parentHome,
          'ccj-child-reuse',
          reuseWs,
          ['src/a.ts'],
          parentMeta.sandbox,
        )
        assert(child.mode === 'reuse', '应为 reuse')
        assert(
          existsSync(join(child.sandbox, 'src/only-in-parent.ts')),
          '应保留父沙箱独有上下文',
        )
        assert(
          readFileSync(join(child.sandbox, 'src/a.ts'), 'utf8').includes('a = 2'),
          '写范围文件应从真工程刷新',
        )
        const disabled = prepareSandboxForJob({
          dataRoot: parentHome,
          jobId: 'ccj-child-noreuse',
          targetWorkspace: reuseWs,
          writeScope: ['src/a.ts'],
          parentSandbox: parentMeta.sandbox,
          onProgress: () => undefined,
        })
        // 默认开启时仍是 reuse；临时关开关测回退
        process.env.CURSOR_CODING_REUSE_PARENT = '0'
        const fallback = prepareSandboxForJob({
          dataRoot: parentHome,
          jobId: 'ccj-child-fallback',
          targetWorkspace: reuseWs,
          writeScope: ['src/a.ts'],
          parentSandbox: parentMeta.sandbox,
        })
        delete process.env.CURSOR_CODING_REUSE_PARENT
        assert(fallback.mode === 'sparse', '开关关闭应回退 sparse，实际=' + fallback.mode)
        assert(!existsSync(join(fallback.sandbox, 'src/only-in-parent.ts')), '回退新建不应带父独有文件')
        assert(disabled.mode === 'reuse', '开启时应 reuse')
        console.log('[self-test] 父沙箱复用 + 开关回退 OK', child.copied_files, fallback.mode)
      } finally {
        delete process.env.CURSOR_CODING_REUSE_PARENT
        try {
          rmSync(reuseWs, { recursive: true, force: true })
        } catch {
          /* ignore */
        }
      }
    }
  } finally {
    await stopServer()
    try {
      rmSync(home, { recursive: true, force: true })
      rmSync(workspace, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    if (prevHome === undefined) delete process.env.CURSOR_CODING_HOME
    else process.env.CURSOR_CODING_HOME = prevHome
    delete process.env.CURSOR_CODING_PORT
    delete process.env.CURSOR_CODING_MOCK
  }
}

main().catch((err) => {
  console.error('[self-test] 失败', err)
  process.exit(1)
})
