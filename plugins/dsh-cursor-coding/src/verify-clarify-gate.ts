/**
 * 自证：删除菜单诉求必须澄清，禁止空转 clarified 出确认。
 * 用法：pnpm build && node lib/verify-clarify-gate.js
 */
import { needsRequirementClarify, hasClarifyEvidence } from './requirementGate.js'
import { startServer, stopServer, getListenAddr } from './server.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

async function main() {
  const msg = '报表中心菜单删除设备维修、设备保养、设备点检报表'
  assert(needsRequirementClarify(msg) === true, '原话必须澄清')
  assert(needsRequirementClarify(msg, true) === true, '空传 clarified 必须仍拦')
  assert(hasClarifyEvidence('报表中心菜单彻底删除员工工时报表') === false, '原话不得算已澄清')
  assert(
    hasClarifyEvidence(
      '报表中心菜单彻底删除员工工时报表\n范围：菜单入口 + 对应页面文件/路由',
    ) === true,
    '选择题结论写法应算已澄清',
  )
  assert(
    needsRequirementClarify(msg + '\n澄清：只去菜单项，保留页面与路由', true) === false,
    '有澄清痕迹应放行',
  )

  const prevHome = process.env.CURSOR_CODING_HOME
  const home = mkdtempSync(join(tmpdir(), 'cc-clarify-'))
  process.env.CURSOR_CODING_HOME = home
  process.env.CURSOR_CODING_PORT = '18791'
  process.env.CURSOR_CODING_MOCK = '1'
  try {
    await startServer()
    const base = getListenAddr()
    assert(base, '应有 listen addr')
    const res = await fetch(base + '/health')
    const body = (await res.json()) as {
      pluginVersion?: string
      gate?: { mustClarify?: boolean; fakeClarifiedBlocked?: boolean }
    }
    assert(res.ok && body.gate?.mustClarify === true, 'health.gate.mustClarify')
    assert(body.gate?.fakeClarifiedBlocked === true, 'health.gate.fakeClarifiedBlocked')
    console.log('VERIFY_CLARIFY_OK', body.pluginVersion, body.gate)
  } finally {
    await stopServer()
    rmSync(home, { recursive: true, force: true })
    if (prevHome) process.env.CURSOR_CODING_HOME = prevHome
    else delete process.env.CURSOR_CODING_HOME
  }
}

main().catch((e) => {
  console.error('VERIFY_CLARIFY_FAIL', e)
  process.exit(1)
})
