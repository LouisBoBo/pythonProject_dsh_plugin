/**
 * Git 交付审码闸端到端自验（不伤写码 begin/continue）。
 * 退出码非 0 = 未通过。
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from '../lib/config.js'
import {
  evaluateBatchReviewPayload,
  resolveBatchReviewRoot,
  resolveGitDeliverReviewBackend,
  runBatchCodeReview,
} from '../lib/gitDeliverReview.js'

const here = dirname(fileURLToPath(import.meta.url))
const pluginRoot = join(here, '..')
const batchRoot = resolveBatchReviewRoot()
const py = process.env.PYTHON || 'python'
const report = { ok: false, steps: [] }

function step(name, detail) {
  report.steps.push({ name, ...detail })
  if (!detail.ok) {
    console.error(JSON.stringify({ fail: name, ...detail }, null, 2))
    console.log(JSON.stringify(report, null, 2))
    process.exit(detail.code || 1)
  }
}

function runPy(args, extraEnv = {}) {
  return spawnSync(py, args, {
    env: { ...process.env, PYTHONPATH: join(batchRoot, 'src'), ...extraEnv },
    encoding: 'utf8',
    cwd: batchRoot,
  })
}

// —— 1. 默认开关 ——
const cfg = loadConfig()
step('default_backend', {
  ok: cfg.gitDeliverReviewBackend === 'embedded' && resolveGitDeliverReviewBackend() === 'embedded',
  backend: cfg.gitDeliverReviewBackend,
  resolved: resolveGitDeliverReviewBackend(),
  code: 11,
})

// —— 2. off 关闸仍可直接放行 ——
process.env.CURSOR_CHAT_GIT_REVIEW_BACKEND = 'off'
const off = await runBatchCodeReview({ workspace: 'D:/tmp', files: ['a.ts'] })
delete process.env.CURSOR_CHAT_GIT_REVIEW_BACKEND
step('off_bypass', {
  ok: off.engine === 'off' && off.passed === true && off.unavailable === false && off.ran === true,
  off,
  code: 12,
})

// —— 3. 旁路根目录 ——
step('batch_root', {
  ok: Boolean(batchRoot),
  batchRoot,
  code: 13,
})

// —— 4. 公司网关就绪且非官网 ——
const statusProc = runPy(['-m', 'dsh_batch_review', 'llm-status'])
let llmStatus = {}
try {
  llmStatus = JSON.parse(String(statusProc.stdout || '').trim() || '{}')
} catch {
  step('llm_status_parse', { ok: false, stdout: statusProc.stdout, stderr: statusProc.stderr, code: 14 })
}
step('company_gateway', {
  ok:
    llmStatus.ok === true &&
    String(llmStatus.provider || '') === 'zr-gateway' &&
    String(llmStatus.base_url || '').includes('/api/ai') &&
    !String(llmStatus.base_url || '').includes('api.deepseek.com'),
  llmStatus,
  code: 15,
})

// —— 5. TS → 子进程 embedded 真审（公司网关）——
const td = mkdtempSync(join(tmpdir(), 'dsh-e2e-'))
writeFileSync(join(td, 'safe.py'), 'def add(a, b):\n    return a + b\n', 'utf8')
writeFileSync(
  join(td, 'risk.js'),
  'const key = process.env.SECRET || "hardcoded-sk-live";\neval(userInput);\n',
  'utf8',
)

const embeddedSafe = await runBatchCodeReview({
  workspace: td,
  files: ['safe.py'],
  focus: '自验：无高危应通过',
})
step('embedded_safe_pass', {
  ok:
    embeddedSafe.engine === 'embedded' &&
    embeddedSafe.ran === true &&
    embeddedSafe.unavailable === false &&
    embeddedSafe.passed === true &&
    embeddedSafe.high_count === 0,
  embeddedSafe: {
    engine: embeddedSafe.engine,
    passed: embeddedSafe.passed,
    unavailable: embeddedSafe.unavailable,
    high: embeddedSafe.high_count,
    medium: embeddedSafe.medium_count,
    low: embeddedSafe.low_count,
    detail: embeddedSafe.detail,
  },
  code: 16,
})

const embeddedRisk = await runBatchCodeReview({
  workspace: td,
  files: ['risk.js'],
  focus: '自验：高危应挡住',
})
step('embedded_high_blocks', {
  ok:
    embeddedRisk.engine === 'embedded' &&
    embeddedRisk.ran === true &&
    embeddedRisk.unavailable === false &&
    embeddedRisk.passed === false &&
    embeddedRisk.high_count >= 1 &&
    Array.isArray(embeddedRisk.high_findings) &&
    embeddedRisk.high_findings.length >= 1,
  embeddedRisk: {
    engine: embeddedRisk.engine,
    passed: embeddedRisk.passed,
    unavailable: embeddedRisk.unavailable,
    high: embeddedRisk.high_count,
    highTitles: (embeddedRisk.high_findings || []).map((f) => f.title || f.severity).slice(0, 5),
    detail: embeddedRisk.detail,
  },
  code: 17,
})

// —— 6. evaluateBatchReviewPayload 契约 ——
const judged = evaluateBatchReviewPayload({
  findings: [
    { file: 'a.ts', line: 1, severity: 'high', title: 'x', description: 'y' },
    { file: 'b.ts', line: 2, severity: 'low', title: 'z', description: 'w' },
  ],
})
step('evaluate_payload', {
  ok: judged.passed === false && judged.high_count === 1 && judged.low_count === 1,
  judged,
  code: 18,
})

// —— 7. 源码隔离：审码适配器 / 旁路禁止官网；写码主路径不 import 审码旁路 ——
const reviewSrc = readFileSync(join(pluginRoot, 'src', 'gitDeliverReview.ts'), 'utf8')
const launchSrc = readFileSync(join(pluginRoot, 'src', 'launchGitDeliver.ts'), 'utf8')
const runJobSrc = readFileSync(join(pluginRoot, 'src', 'orchestrator', 'runJob.ts'), 'utf8')
const indexSrc = readFileSync(join(pluginRoot, 'src', 'index.ts'), 'utf8')
const clientSrc = readFileSync(join(pluginRoot, 'src', 'client.js'), 'utf8')
step('no_official_url_in_adapters', {
  ok: !/api\.deepseek\.com/.test(reviewSrc) && !/api\.deepseek\.com/.test(launchSrc),
  code: 19,
})
step('coding_path_isolated', {
  ok:
    !/dsh_batch_review|runBatchCodeReview|runEmbeddedBatchReview/.test(runJobSrc) &&
    launchSrc.includes('runBatchCodeReview') &&
    launchSrc.includes('waitForGitDeliverRisk') &&
    indexSrc.includes('GIT_DELIVER_MODEL_STOP_PAUSED') &&
    clientSrc.includes('await_risk'),
  code: 20,
})

// —— 8. 官网 WB 配置必须被跳过，落到公司网关 ——
const preferCode = `
from dsh_batch_review.dsh_gateway import prefer_review_llm
import json, os
os.environ["ZR_GATEWAY_TOKEN"] = "tok"
os.environ["ZR_MODEL_GATEWAY_URL"] = "http://113.90.149.166:19772"
got = prefer_review_llm({
  "provider":"deepseek","api_key":"sk","base_url":"https://api.deepseek.com","model":"deepseek-chat"
})
print(json.dumps(got))
`
const preferProc = spawnSync(py, ['-c', preferCode], {
  env: { ...process.env, PYTHONPATH: join(batchRoot, 'src') },
  encoding: 'utf8',
})
let prefer = null
try {
  prefer = JSON.parse(String(preferProc.stdout || '').trim())
} catch {
  step('prefer_parse', { ok: false, stdout: preferProc.stdout, stderr: preferProc.stderr, code: 21 })
}
step('reject_official_prefer_gateway', {
  ok:
    prefer &&
    prefer.provider === 'zr-gateway' &&
    String(prefer.base_url || '').includes('113.90.149.166') &&
    !String(prefer.base_url || '').includes('api.deepseek.com'),
  prefer: { provider: prefer?.provider, base_url: prefer?.base_url, model: prefer?.model },
  code: 22,
})

try {
  rmSync(td, { recursive: true, force: true })
} catch {
  /* ignore */
}

report.ok = true
report.summary = {
  default_backend: 'embedded',
  gateway: llmStatus.base_url,
  model: llmStatus.model,
  safe_passed: embeddedSafe.passed,
  risk_high: embeddedRisk.high_count,
  coding_path_clean: true,
}
console.log(JSON.stringify(report, null, 2))
