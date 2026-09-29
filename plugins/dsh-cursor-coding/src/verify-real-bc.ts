/**
 * 真实工程 + 真实 Cursor 的阶段 B+C 抽检。
 * 工作区：pythonProject_zr_aicoding（仅触碰专用探测文件，结束清理）。
 * Key：从 DSH-ZR-WorkBuddy config.yaml 读取（不打印）。
 *
 * 用法：node lib/verify-real-bc.js
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _resetHitlStoreForTests, issue } from './hitl.js'
import { saveConfig } from './config.js'
import { createPendingConfirm } from './pendingConfirm.js'
import { startServer, stopServer, getListenAddr } from './server.js'
import { formatDialogMarkdown } from './transcript.js'

const WORKSPACE = '/Users/hebo/Desktop/中软项目/pythonProject_zr_aicoding'
const PROBE = '_dsh_cursor_coding_bc_probe.txt'
const KEY_CANDIDATES = [
  '/Users/hebo/ai_projects/DSH-ZR-WorkBuddy/apps/zr-workbuddy/engine/config/config.yaml',
  '/Users/hebo/Library/Application Support/zr-workbuddy-desktop/runtime-app/apps/zr-workbuddy/engine/config/config.yaml',
  '/Users/hebo/Library/Application Support/zr-workbuddy-desktop/persist/config.yaml',
]

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

function loadKeyFromWorkBuddy(): string {
  const fromEnv = String(process.env.CURSOR_API_KEY || '').trim()
  if (fromEnv && !fromEnv.startsWith('test-')) return fromEnv
  for (const p of KEY_CANDIDATES) {
    if (!existsSync(p)) continue
    const text = readFileSync(p, 'utf8')
    const m = text.match(/cursor_api_key\s*:\s*["']?([^"'\s#]+)/)
    const key = m?.[1]?.trim() || ''
    if (key && !key.startsWith('test-') && key.length > 8) return key
  }
  throw new Error('未在 WorkBuddy config 中找到可用 cursor_api_key')
}

async function waitJobStatus(
  base: string,
  jobId: string,
  statuses: string[],
  timeoutMs: number,
): Promise<{
  status: string
  detail: string
  synced: string[]
  review_in_scope: string[]
  review_deferred: string[]
  changed: string[]
  events: number
}> {
  const start = Date.now()
  let last = ''
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(base + '/api/cursor-coding/jobs/' + encodeURIComponent(jobId))
    const body = (await res.json()) as {
      job?: {
        status?: string
        detail?: string
        synced_files?: string[]
        review_in_scope?: string[]
        review_deferred?: string[]
        changed_files?: string[]
        events?: unknown[]
      }
    }
    const st = body.job?.status || ''
    const detail = body.job?.detail || ''
    if (detail && detail !== last) {
      console.log('[verify-bc] status=', st, 'detail=', detail.slice(0, 200))
      last = detail
    }
    if (statuses.includes(st)) {
      return {
        status: st,
        detail,
        synced: body.job?.synced_files || [],
        review_in_scope: body.job?.review_in_scope || [],
        review_deferred: body.job?.review_deferred || [],
        changed: body.job?.changed_files || [],
        events: body.job?.events?.length || 0,
      }
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
  throw new Error('等待任务超时（期望 ' + statuses.join('|') + '）')
}

function readProbe(): string {
  return readFileSync(join(WORKSPACE, PROBE), 'utf8')
}

async function main() {
  delete process.env.CURSOR_CODING_MOCK
  assert(existsSync(WORKSPACE), '真实工程不存在: ' + WORKSPACE)
  assert(existsSync(join(WORKSPACE, 'README.md')), '工程缺 README.md')

  const key = loadKeyFromWorkBuddy()
  console.log('[verify-bc] key_ok len=', key.length, 'prefix=', key.slice(0, 4) + '…')
  console.log('[verify-bc] workspace=', WORKSPACE)

  const home = mkdtempSync(join(tmpdir(), 'cc-real-bc-'))
  process.env.CURSOR_CODING_HOME = home
  process.env.CURSOR_CODING_PORT = '18792'

  const probePath = join(WORKSPACE, PROBE)
  const probeHadExisted = existsSync(probePath)
  const probeBackup = probeHadExisted ? readFileSync(probePath, 'utf8') : null
  writeFileSync(probePath, 'color=blue\nmarker=bc-verify\n', 'utf8')
  console.log('[verify-bc] wrote probe', PROBE)

  try {
    _resetHitlStoreForTests()
    saveConfig({
      listen: '127.0.0.1',
      port: 18792,
      cursorApiKey: key,
      writeScope: [PROBE],
      dataRoot: home,
      model: 'composer-2.5',
    })

    const boot = await startServer()
    assert(boot.ok, '服务启动失败: ' + boot.detail)
    const base = getListenAddr()!
    console.log('[verify-bc] service', base)

    const requirement =
      `只修改仓库根目录文件 ${PROBE}：把 color=blue 改成 color=red，不要改其他任何文件，不要新建文件。改完写一句说明即可。`

    // 1) confirm
    const issued = issue({ action: 'cursor-coding.confirm', workspace: WORKSPACE, requirement })
    const pending = createPendingConfirm({ workspace: WORKSPACE, requirement })
    const res = await fetch(base + '/api/cursor-coding/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace: WORKSPACE,
        requirement,
        nonce: issued.nonce,
        confirm_token: pending.id,
        write_scope: [PROBE],
      }),
    })
    const data = (await res.json()) as { ok?: boolean; job_id?: string; detail?: string }
    assert(res.ok && data.ok && data.job_id, 'confirm 失败: ' + JSON.stringify(data))
    const jobId = data.job_id!
    console.log('[verify-bc] job', jobId)

    // 2) wait pending_review
    const review = await waitJobStatus(
      base,
      jobId,
      ['pending_review', 'failed', 'cancelled', 'blocked_no_runner', 'succeeded'],
      12 * 60 * 1000,
    )
    console.log('[verify-bc] after-cursor status=', review.status)
    console.log('[verify-bc] review_in_scope=', review.review_in_scope.join(', ') || '(none)')
    console.log('[verify-bc] review_deferred=', review.review_deferred.join(', ') || '(none)')
    console.log('[verify-bc] changed=', review.changed.join(', ') || '(none)')
    console.log('[verify-bc] events=', review.events)
    assert(review.status === 'pending_review', '期望 pending_review，实际 ' + review.status + ' ' + review.detail)

    // 拉取并落盘 Cursor 对话（Thinking + 工具 + 正文）
    {
      const jobRes = await fetch(base + '/api/cursor-coding/jobs/' + encodeURIComponent(jobId))
      const jobJson = (await jobRes.json()) as {
        job?: {
          assistant_text?: string
          thinking_text?: string
          transcript?: { kind: string; text?: string; name?: string; path?: string; tool_status?: string }[]
          events?: unknown[]
        }
      }
      const body = String(jobJson.job?.assistant_text || '')
      const thinking = String(jobJson.job?.thinking_text || '')
      const transcript = (jobJson.job?.transcript || []) as import('./transcript.js').TranscriptItem[]
      const outPath = join(
        '/Users/hebo/Desktop/中软项目/pythonProject_dsh_plugin/dsh-cursor-coding',
        '.last-assistant-body.md',
      )
      writeFileSync(
        outPath,
        formatDialogMarkdown({
          jobId,
          workspace: WORKSPACE,
          thinking,
          assistant: body,
          transcript,
        }),
        'utf8',
      )
      console.log('[verify-bc] thinking chars=', thinking.length)
      console.log('[verify-bc] assistant chars=', body.length)
      console.log('[verify-bc] transcript items=', transcript.length)
      console.log('[verify-bc] dialog saved →', outPath)
      console.log('[verify-bc] assistant preview:\n' + body.slice(0, 600) + (body.length > 600 ? '\n…' : ''))
      if (thinking) {
        console.log('[verify-bc] thinking preview:\n' + thinking.slice(0, 400) + (thinking.length > 400 ? '\n…' : ''))
      }
      assert(body.length > 0, '真实 Cursor 应返回非空正文')
    }

    // 3) 真工程在 apply 前不得被改
    const beforeApply = readProbe()
    assert(/color\s*=\s*blue/i.test(beforeApply), '未 apply 前 probe 应仍为 color=blue\n' + beforeApply)
    assert(!/color\s*=\s*red/i.test(beforeApply), '未 apply 前不应已是 red')
    console.log('[verify-bc] PASS gate: pending_review 且真工程未改')

    // 4) apply 无 nonce → 401
    {
      const bad = await fetch(base + '/api/cursor-coding/jobs/' + encodeURIComponent(jobId) + '/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accept: [PROBE] }),
      })
      assert(bad.status === 401, 'apply 无 nonce 应 401，实际 ' + bad.status)
      assert(/color\s*=\s*blue/i.test(readProbe()), '401 后 probe 仍应为 blue')
      console.log('[verify-bc] PASS gate: apply 无 nonce → 401，工程未动')
    }

    // 5) 子集：只 accept probe（即使还有其他变更也不全量 sync）
    const accept = review.review_in_scope.includes(PROBE)
      ? [PROBE]
      : review.review_in_scope.length
        ? [review.review_in_scope[0]]
        : [PROBE]
    const applyIssued = issue({ action: 'cursor-coding.apply', job_id: jobId })
    const applyRes = await fetch(base + '/api/cursor-coding/jobs/' + encodeURIComponent(jobId) + '/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nonce: applyIssued.nonce, accept }),
    })
    const applyData = (await applyRes.json()) as {
      ok?: boolean
      detail?: string
      synced_files?: string[]
    }
    assert(applyRes.ok && applyData.ok, 'apply 失败: ' + JSON.stringify(applyData))
    console.log('[verify-bc] apply synced=', (applyData.synced_files || []).join(', ') || '(none)')

    const terminal = await waitJobStatus(base, jobId, ['succeeded', 'failed'], 60 * 1000)
    assert(terminal.status === 'succeeded', '期望 succeeded，实际 ' + terminal.status + ' ' + terminal.detail)

    const after = readProbe()
    console.log('[verify-bc] probe after apply =>\n' + after)
    assert(/color\s*=\s*red/i.test(after), 'apply 后 probe 应含 color=red')
    assert((applyData.synced_files || []).includes(PROBE) || accept[0] === PROBE, '应同步探测文件')
    console.log('[verify-bc] PASS 真实工程 B+C（审后同步）')
  } finally {
    await stopServer()
    try {
      if (probeBackup !== null) writeFileSync(probePath, probeBackup, 'utf8')
      else if (existsSync(probePath)) unlinkSync(probePath)
      console.log('[verify-bc] cleaned probe')
    } catch (e) {
      console.warn('[verify-bc] probe cleanup failed', e)
    }
    try {
      rmSync(home, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    delete process.env.CURSOR_CODING_HOME
    delete process.env.CURSOR_CODING_PORT
  }
}

main().catch((err) => {
  console.error('[verify-bc] FAIL', err)
  process.exit(1)
})
