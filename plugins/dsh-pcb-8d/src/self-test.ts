import { assertSafeReportId } from './report_id.js'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

function main() {
  const ok = assertSafeReportId('8D-20261014-1133-ab12')
  assert(ok === '8D-20261014-1133-ab12', 'accept valid id')
  let bad = false
  try {
    assertSafeReportId('../etc/passwd')
  } catch {
    bad = true
  }
  assert(bad, 'reject path traversal id')
  bad = false
  try {
    assertSafeReportId('8D-evil')
  } catch {
    bad = true
  }
  assert(bad, 'reject short id')
  console.log('[pcb-8d self-test] ok')
}

main()
