/**
 * 真实 Cursor 验证阶段 B（密钥从环境变量读，不打印）：
 * confirm → pending_review（真工程未改）→ HITL apply → 真工程 color=red。
 * CURSOR_API_KEY=... node lib/verify-real-a.js
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _resetHitlStoreForTests, issue } from './hitl.js'
import { saveConfig } from './config.js'
import { createPendingConfirm } from './pendingConfirm.js'
import { startServer, stopServer, getListenAddr } from './server.js'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
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
        events?: unknown[]
      }
    }
    const st = body.job?.status || ''
    const detail = body.job?.detail || ''
    if (detail && detail !== last) {
      console.log('[verify-a] status=', st, 'detail=', detail.slice(0, 160))
      last = detail
    }
    if (statuses.includes(st)) {
      return {
        status: st,
        detail,
        synced: body.job?.synced_files || [],
        review_in_scope: body.job?.review_in_scope || [],
        events: body.job?.events?.length || 0,
      }
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
  throw new Error('等待任务超时（期望 ' + statuses.join('|') + '）')
}

async function main() {
  delete process.env.CURSOR_CODING_MOCK
  const key = String(process.env.CURSOR_API_KEY || '').trim()
  assert(key && !key.startsWith('test-'), '请设置真实 CURSOR_API_KEY（勿用 test- 前缀）')

  const home = mkdtempSync(join(tmpdir(), 'cc-real-a-'))
  const workspace = mkdtempSync(join(tmpdir(), 'cc-real-ws-'))
  process.env.CURSOR_CODING_HOME = home
  process.env.CURSOR_CODING_PORT = '18791'

  writeFileSync(join(workspace, 'hello.txt'), 'color=blue\nversion=1\n', 'utf8')

  try {
    _resetHitlStoreForTests()
    saveConfig({
      listen: '127.0.0.1',
      port: 18791,
      cursorApiKey: key,
      writeScope: [],
      dataRoot: home,
      model: 'composer-2.5',
    })

    const boot = await startServer()
    assert(boot.ok, '服务启动失败: ' + boot.detail)
    const base = getListenAddr()!
    console.log('[verify-a] service', base)
    console.log('[verify-a] workspace', workspace)

    const requirement =
      '只修改 hello.txt：把 color=blue 改成 color=red，不要改其他文件，不要新建文件。改完写简短说明方案。'
    const issued = issue({
      action: 'cursor-coding.confirm',
      workspace,
      requirement,
    })
    const pending = createPendingConfirm({ workspace, requirement })
    const res = await fetch(base + '/api/cursor-coding/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace,
        requirement,
        nonce: issued.nonce,
        confirm_token: pending.id,
      }),
    })
    const data = (await res.json()) as { ok?: boolean; job_id?: string; detail?: string }
    assert(res.ok && data.ok && data.job_id, 'confirm 失败: ' + JSON.stringify(data))
    console.log('[verify-a] job', data.job_id)

    const review = await waitJobStatus(
      base,
      data.job_id!,
      ['pending_review', 'failed', 'cancelled', 'blocked_no_runner', 'succeeded'],
      12 * 60 * 1000,
    )
    console.log('[verify-a] review', review.status, review.detail)
    console.log('[verify-a] review_in_scope', review.review_in_scope.join(', ') || '(none)')
    console.log('[verify-a] events', review.events)

    assert(review.status === 'pending_review', '期望 pending_review，实际 ' + review.status)
    const beforeApply = readFileSync(join(workspace, 'hello.txt'), 'utf8')
    assert(/color\s*=\s*blue/i.test(beforeApply), '未 apply 前 hello.txt 应仍为 color=blue')
    assert(!/color\s*=\s*red/i.test(beforeApply), '未 apply 前不应已是 red')

    const accept = review.review_in_scope.length
      ? review.review_in_scope
      : ['hello.txt']
    const applyIssued = issue({ action: 'cursor-coding.apply', job_id: data.job_id! })
    const applyRes = await fetch(
      base + '/api/cursor-coding/jobs/' + encodeURIComponent(data.job_id!) + '/apply',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nonce: applyIssued.nonce,
          accept,
        }),
      },
    )
    const applyData = (await applyRes.json()) as {
      ok?: boolean
      detail?: string
      synced_files?: string[]
    }
    assert(applyRes.ok && applyData.ok, 'apply 失败: ' + JSON.stringify(applyData))
    console.log('[verify-a] apply synced', (applyData.synced_files || []).join(', ') || '(none)')

    const terminal = await waitJobStatus(
      base,
      data.job_id!,
      ['succeeded', 'failed'],
      60 * 1000,
    )
    assert(terminal.status === 'succeeded', '期望 succeeded，实际 ' + terminal.status)

    const hello = readFileSync(join(workspace, 'hello.txt'), 'utf8')
    console.log('[verify-a] hello.txt =>\n' + hello)
    assert(/color\s*=\s*red/i.test(hello), 'hello.txt 应含 color=red')
    assert(existsSync(join(workspace, 'hello.txt')), 'hello.txt 应存在')

    console.log('[verify-a] PASS 真实 Cursor 阶段 B 验证通过（审后同步）')
  } finally {
    await stopServer()
    try {
      rmSync(home, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    try {
      rmSync(workspace, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    delete process.env.CURSOR_CODING_HOME
    delete process.env.CURSOR_CODING_PORT
  }
}

main().catch((err) => {
  console.error('[verify-a] FAIL', err)
  process.exit(1)
})
