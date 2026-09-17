import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { computeNextRunAt, shouldRunNow, rruleToScheduleLabel, enrichSchedule } from './schedule.js'
import { detectForbiddenAction } from './safety.js'
import { fingerprintPrompt } from './util.js'
import { createAutomation, deleteAutomation, listAutomations, listRuns, recoverOrphanRuns, appendRun, updateRun, usesTemplatePipeline } from './store.js'
import { executeAutomation } from './executor.js'
import { markRunning, clearRunning, anyRunning } from './runtime.js'
import { normalizeWebhookKey, buildWebhookUrl } from './wecom.js'
import { AUTOMATION_TEMPLATES } from './templates.js'
import { parseRrule } from './schedule.js'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

{
  const now = new Date('2026-09-17T08:00:00')
  const n = computeNextRunAt(
    {
      status: 'active',
      schedule_type: 'recurring',
      rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
      scheduled_at: null,
      valid_from: null,
      valid_until: null,
    },
    now,
  )
  const expect = Math.floor(new Date('2026-09-17T09:00:00').getTime() / 1000)
  assert(n === expect, `daily next got ${n} want ${expect}`)
}

{
  const now = new Date('2026-09-17T09:00:00')
  const n = computeNextRunAt(
    {
      status: 'active',
      schedule_type: 'recurring',
      rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
      scheduled_at: null,
      valid_from: null,
      valid_until: null,
    },
    now,
  )
  const expect = Math.floor(new Date('2026-09-18T09:00:00').getTime() / 1000)
  assert(n === expect, 'at exactly 9:00 next is tomorrow')
}

{
  const fri = new Date('2026-09-16T10:00:00') // Wednesday? 2026-09-17 is Thursday. 16 is Wednesday.
  const n = computeNextRunAt(
    {
      status: 'active',
      schedule_type: 'recurring',
      rrule: 'FREQ=WEEKLY;BYDAY=FR;BYHOUR=17;BYMINUTE=0',
      scheduled_at: null,
      valid_from: null,
      valid_until: null,
    },
    fri,
  )
  const expect = Math.floor(new Date('2026-09-18T17:00:00').getTime() / 1000)
  assert(n === expect, `weekly friday got ${n} want ${expect}`)
}

{
  const paused = computeNextRunAt({
    status: 'paused',
    schedule_type: 'recurring',
    rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
    scheduled_at: null,
    valid_from: null,
    valid_until: null,
  })
  assert(paused == null, 'paused has no next')
}

{
  const item = enrichSchedule({
    status: 'active' as const,
    schedule_type: 'recurring' as const,
    rrule: 'FREQ=DAILY;BYHOUR=8;BYMINUTE=0',
    scheduled_at: null,
    valid_from: null,
    valid_until: null,
    next_run_at: null,
    last_run_at: null,
  })
  assert(typeof item.next_run_at === 'number', 'enrich writes next_run_at')
  const nra = item.next_run_at
  if (typeof nra !== 'number') throw new Error('next_run_at missing')
  assert(!shouldRunNow({ ...item, last_run_at: null }, nra - 10), 'future not due')
  assert(shouldRunNow({ ...item, last_run_at: null }, nra), 'due at next_run_at')
  assert(!shouldRunNow({ ...item, last_run_at: nra }, nra + 1), 'last_run covers this slot')
}

assert(rruleToScheduleLabel('FREQ=DAILY;BYHOUR=9;BYMINUTE=0') === '每天 09:00', 'label daily')
assert(rruleToScheduleLabel('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0') === '工作日 09:00', 'label weekday')
assert(parseRrule('FREQ=DAILY;BYHOUR=8').FREQ === 'DAILY', 'parse rrule')

assert(detectForbiddenAction('提交代码并部署到预发') === 'forbidden_action', 'forbidden commit+deploy')
assert(detectForbiddenAction('git commit -am x') === 'forbidden_action', 'forbidden git commit')
assert(detectForbiddenAction('检索 PCB 新闻，不要取消推送') === null, 'must not treat 取消 as control')
assert(detectForbiddenAction('每日生产运营日报') === null, 'report not forbidden')

assert(AUTOMATION_TEMPLATES.length === 4, 'four templates')
const news = AUTOMATION_TEMPLATES.find((t) => t.id === 'daily-ai-news')
assert(news && fingerprintPrompt(news.prompt).length === 16, 'fingerprint')

{
  const key = normalizeWebhookKey('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc-def')
  assert(key === 'abc-def', 'normalize url key')
  assert(buildWebhookUrl(key).includes('key=abc-def'), 'build url')
  let threw = false
  try {
    normalizeWebhookKey('https://example.com/hook?key=x')
  } catch {
    threw = true
  }
  assert(threw, 'reject non-wecom host')
}

{
  const root = mkdtempSync(join(tmpdir(), 'dsh-auto-'))
  mkdirSync(join(root, 'data'), { recursive: true })
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-auto-cwd-'))
  writeFileSync(join(cwd, 'a.txt'), 'hello')

  void (async () => {
    process.env.DSH_AUTOMATIONS_HOME = root
    const created = await createAutomation(root, {
      name: '目录巡检',
      template_id: 'dir-watch-digest',
      cwds: [cwd],
      push_to_wecom: false,
    })
    assert(created.template_id === 'dir-watch-digest', 'template id kept')
    assert(usesTemplatePipeline(created), 'untouched template uses pipeline')
    const listed = listAutomations(root)
    assert(listed.length === 1 && listed[0].id === created.id, 'list')

    const updated = await createAutomation(root, { name: '自定义', prompt: '只读汇总目录', cwds: [cwd] })
    assert(updated.source === 'custom', 'custom source')
    assert(!usesTemplatePipeline(updated), 'custom not pipeline')

    const okLock = await markRunning(root, created.id, 'run-1')
    assert(okLock, 'first lock')
    assert(await anyRunning(root), 'any running')
    const second = await markRunning(root, updated.id, 'run-2')
    assert(!second, 'global mutex')
    await clearRunning(root, created.id, 'run-1')
    assert(!(await anyRunning(root)), 'cleared')

    const run = await appendRun(root, { automation_id: created.id, automation_name: created.name, status: 'running' })
    const settled = await updateRun(root, run.id, { status: 'succeeded', summary: '无新文件', finished_at: 1 })
    assert(settled?.status === 'succeeded', 'succeed')
    const dirty = await updateRun(root, run.id, { status: 'cancelled', summary: '不该改' })
    assert(dirty?.status === 'succeeded', 'terminal status frozen')
    assert(dirty?.summary === '无新文件', 'terminal summary frozen')

    await appendRun(root, { automation_id: created.id, status: 'running', automation_name: 'x' })
    const n = await recoverOrphanRuns(root)
    assert(n >= 1, 'orphan recovered')
    const runs = listRuns(root, 1, 10)
    assert(runs.items.some((r) => r.status === 'failed' && r.error?.code === 'interrupted'), 'interrupted code')

    const ran = await executeAutomation(root, created)
    assert(ran.ok, 'dir watch execute ok')
    assert((ran.run?.summary || '').includes('无新文件') || (ran.run?.summary || '').includes('变更'), 'dir summary')

    const bad = await createAutomation(root, { name: '禁止', prompt: '请提交代码并部署到预发' })
    const denied = await executeAutomation(root, bad)
    assert(!denied.ok, 'forbidden should fail')
    assert(denied.run?.error?.code === 'forbidden_action', 'forbidden code')
    assert(denied.run?.status === 'failed', 'failed not cancelled')

    const removed = await deleteAutomation(root, created.id)
    assert(removed, 'delete def')
    assert(listAutomations(root).every((x) => x.id !== created.id), 'def gone')
    assert(listRuns(root, 1, 50).items.some((r) => r.automation_id === created.id), 'runs kept')

    rmSync(root, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
    console.log('self-test ok')
  })().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
