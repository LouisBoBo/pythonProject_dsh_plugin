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
  createPendingConfirm,
} from './pendingConfirm.js'
import { prepareSandboxForJob, prepareSandboxSparse, prepareSandboxReuse } from './sandbox.js'
import { relativizeToolPath } from './transcript.js'
import { startServer, stopServer, getListenAddr } from './server.js'

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
      const issued = issue({
        action: 'cursor-coding.confirm',
        workspace,
        requirement: '改一下标题',
      })
      const res = await fetch(base + '/api/cursor-coding/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          withConfirmToken(workspace, '改一下标题', { nonce: issued.nonce }),
        ),
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
      const jobJson = (await jobRes.json()) as { job?: { assistant_text?: string; transcript?: unknown[]; thinking_text?: string } }
      assert(
        String(jobJson.job?.assistant_text || '').includes('说明方案'),
        'assistant_text 应保留 Cursor 正文',
      )
      assert(
        Array.isArray(jobJson.job?.transcript) && (jobJson.job?.transcript?.length || 0) > 0,
        'transcript 应有对话片段',
      )
      assert(String(jobJson.job?.thinking_text || '').length > 0, 'thinking_text 应有内容（Mock）')
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
      process.env.CURSOR_CODING_AUTO_APPLY = '0'
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
      delete process.env.CURSOR_CODING_AUTO_APPLY
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
