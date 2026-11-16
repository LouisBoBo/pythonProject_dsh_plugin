import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../lib/config.js'
import {
  resolveBatchReviewRoot,
  resolveGitDeliverReviewBackend,
  runBatchCodeReview,
} from '../lib/gitDeliverReview.js'

const cfg = loadConfig()
if (cfg.gitDeliverReviewBackend !== 'embedded') {
  console.error('config backend not embedded', cfg.gitDeliverReviewBackend)
  process.exit(11)
}
if (resolveGitDeliverReviewBackend() !== 'embedded') {
  console.error('resolve backend not embedded')
  process.exit(12)
}

process.env.CURSOR_CHAT_GIT_REVIEW_BACKEND = 'off'
const off = await runBatchCodeReview({ workspace: 'D:/tmp', files: ['a.ts'] })
delete process.env.CURSOR_CHAT_GIT_REVIEW_BACKEND
if (!(off.engine === 'off' && off.passed && !off.unavailable)) {
  console.error('off result bad', off)
  process.exit(13)
}

const root = resolveBatchReviewRoot()
if (!root) {
  console.error('batch review root missing')
  process.exit(14)
}

const td = mkdtempSync(join(tmpdir(), 'dsh-rev-'))
writeFileSync(join(td, 'x.py'), 'print(1)\n')
const code = `
from dsh_batch_review.review_run import run_batch_review
import json, dsh_batch_review.review_run as rr
rr.load_workbuddy_config = lambda: {"deepseek": {"provider":"openai_compat","api_key":"sk","base_url":"http://gw.test/v1","model":"m"}}
def chat(llm, msgs, **kw):
    assert "gw.test" in llm["base_url"]
    return """:::code_review_findings
[{"file":"x.py","line":1,"severity":"low","title":"ok","description":"n"}]
:::"""
print(json.dumps(run_batch_review(workspace=${JSON.stringify(td)}, files=["x.py"], chat_fn=chat)))
`
const py = spawnSync(process.env.PYTHON || 'python', ['-c', code], {
  env: { ...process.env, PYTHONPATH: join(root, 'src'), DSH_BATCH_REVIEW_ALLOW_ANY_GATEWAY: '1' },
  encoding: 'utf8',
})
if (py.status !== 0) {
  console.error(py.stderr || py.stdout)
  process.exit(15)
}
const mocked = JSON.parse(String(py.stdout || '').trim())
if (!(mocked.passed && mocked.engine === 'embedded' && !mocked.unavailable)) {
  console.error('mock embedded bad', mocked)
  process.exit(16)
}

// 公司网关就绪（本机已登录 ZR_GATEWAY_TOKEN）
const status = spawnSync(process.env.PYTHON || 'python', ['-m', 'dsh_batch_review', 'llm-status'], {
  env: { ...process.env, PYTHONPATH: join(root, 'src') },
  encoding: 'utf8',
})
let llmStatus = {}
try {
  llmStatus = JSON.parse(String(status.stdout || '').trim() || '{}')
} catch {
  console.error('llm-status parse fail', status.stderr || status.stdout)
  process.exit(17)
}
if (!llmStatus.ok) {
  console.error('company gateway llm not ready', llmStatus)
  process.exit(18)
}
if (String(llmStatus.base_url || '').includes('api.deepseek.com')) {
  console.error('must not use official deepseek url', llmStatus)
  process.exit(19)
}

try {
  rmSync(td, { recursive: true, force: true })
} catch {
  /* ignore */
}
console.log(
  JSON.stringify({
    ok: true,
    default_backend: 'embedded',
    off_engine: off.engine,
    root,
    mocked_high: mocked.high_count,
    llm_provider: llmStatus.provider,
    llm_model: llmStatus.model,
    llm_base: llmStatus.base_url,
  }),
)
