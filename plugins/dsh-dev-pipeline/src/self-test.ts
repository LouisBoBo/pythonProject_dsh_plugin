/** 自检：不依赖宿主、不碰网络，验证纯逻辑与本地文件行为。 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadConfig } from './config.js'
import { git, gitStatus, runCommand, runBinary } from './exec.js'
import { prepareImages } from './images.js'
import { isAllowedValidationCommand, safeCommand } from './steps/step4.js'
import {
  deltaSinceBaseline,
  filterScopePaths,
  isDbOrBinaryPath,
  sanitizeRelPath,
  snapshotScope,
} from './scope.js'
import { recoverOrphanedRuns, saveEpic, saveRun, loadRun, initSteps, nowIso, newId } from './store.js'
import { STEPS } from './steps/index.js'
import { STEP_IDS, type Epic, type PipelineConfig, type Run } from './types.js'
import {
  detectValidationCommands,
  normalizeWorkspace,
  redactSecrets,
  scanSecrets,
} from './workspace.js'
import { TERMINAL } from './cursorChat.js'

let failed = 0

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`  ✓ ${label}`)
  } else {
    failed += 1
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function testCommands(): void {
  console.log('验证命令安全')
  check('放行普通命令', safeCommand('npm run test') === 'npm run test')
  check('拒绝分号串联', safeCommand('npm test; rm -rf /') === '')
  check('拒绝 &&', safeCommand('npm test && deploy') === '')
  check('拒绝管道', safeCommand('cat x | sh') === '')
  check('拒绝命令替换', safeCommand('echo $(whoami)') === '')
  check('拒绝重定向', safeCommand('node x.js > out') === '')
  check('拒绝换行', safeCommand('npm test\nrm -rf /') === '')
  check('空串', safeCommand('  ') === '')
}

function testRegistry(): void {
  console.log('十步注册表')
  check('步骤数 10', STEPS.length === 10, String(STEPS.length))
  check(
    '顺序与 STEP_IDS 一致',
    STEPS.every((s, i) => s.id === STEP_IDS[i]),
  )
  check(
    '每步有技能名与标题',
    STEPS.every((s) => Boolean(s.skill && s.title && typeof s.run === 'function')),
  )
}

function testSecrets(): void {
  console.log('密钥扫描')
  const fakeToken = ['s', 'k', '-'].join('') + 'A'.repeat(24)
  check('识别 API Token', scanSecrets(`const key = "${fakeToken}"`).length > 0)
  check('识别私钥', scanSecrets('-----BEGIN RSA PRIVATE KEY-----').length > 0)
  check('识别明文口令', scanSecrets('password = "supersecretvalue"').length > 0)
  check('普通代码不误报', scanSecrets('const password = process.env.PASSWORD').length === 0)
}

function testScopeSanitize(): void {
  console.log('路径净化与范围过滤')
  const ws = '/tmp/ws-demo'
  check('放行普通相对路径', sanitizeRelPath(ws, 'src/a.ts') === 'src/a.ts')
  check('反斜杠归一', sanitizeRelPath(ws, 'src\\b.ts') === 'src/b.ts')
  check('拒绝上级目录', sanitizeRelPath(ws, '../etc/passwd') === '')
  check('拒绝嵌套上级目录', sanitizeRelPath(ws, 'src/../../x') === '')
  check('拒绝绝对路径', sanitizeRelPath(ws, '/etc/passwd') === '')
  check('拒绝盘符路径', sanitizeRelPath(ws, 'C:/Windows/win.ini') === '')
  check('拒绝 pathspec magic', sanitizeRelPath(ws, ':(glob)**/*') === '')
  check('拒绝 .git', sanitizeRelPath(ws, '.git/config') === '')
  check('拒绝换行', sanitizeRelPath(ws, 'a\nb') === '')
  check('数据库被过滤', isDbOrBinaryPath('engine/data/erp.db'))
  check('依赖目录被过滤', isDbOrBinaryPath('node_modules/x/index.js'))
  check('源码不过滤', !isDbOrBinaryPath('src/index.ts'))
  const filtered = filterScopePaths(ws, ['src/a.ts', './src/a.ts', 'foo.db', '../x', 42])
  check('范围过滤去重净化', filtered.length === 1 && filtered[0] === 'src/a.ts', JSON.stringify(filtered))
}

function testValidationAllowlist(): void {
  console.log('验证命令白名单')
  const allowed = [
    'npm test',
    'npm run build',
    'pnpm run typecheck',
    'yarn lint',
    'pytest -q',
    'python3 -m pytest',
    'go test ./...',
    'cargo test',
    'make test',
    'git diff --check',
  ]
  for (const cmd of allowed) check(`放行 ${cmd}`, isAllowedValidationCommand(cmd))
  const denied = ['rm -rf /', 'npm test; rm -rf /', 'curl http://127.0.0.1:22', 'node evil.js', 'npm install left-pad']
  for (const cmd of denied) check(`拒绝 ${cmd}`, !isAllowedValidationCommand(cmd))
}

function testRedact(): void {
  console.log('输出脱敏')
  const token = ['s', 'k', '-'].join('') + 'B'.repeat(24)
  const bearer = 'abc123def456ghi789jkl0'
  const out = redactSecrets(`Authorization: Bearer ${bearer}\nkey=${token}`)
  check('Bearer 被掩码', !out.includes(bearer))
  check('sk- Token 被掩码', !out.includes(token))
  check('普通文本保留', redactSecrets('build ok').includes('build ok'))
}

function testImages(): void {
  console.log('附图转交')
  const home = mkdtempSync(join(tmpdir(), 'dev-pipeline-img-'))
  const prev = process.env.CURSOR_CHAT_HOME
  process.env.CURSOR_CHAT_HOME = home
  try {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    )
    const out = prepareImages([
      `data:image/png;base64,${png.toString('base64')}`,
      'https://example.com/x.png',
      '../secret.png',
    ])
    check('data URL 落盘为引用', out.refs.length === 1 && out.refs[0].mimeType === 'image/png', JSON.stringify(out.refs))
    check('远程图片被拒绝', out.warnings.some((w) => w.includes('远程图片')))
    check('落盘在 cursor-chat 目录', out.refs[0]?.path.startsWith(join(home, 'uploads')), out.refs[0]?.path)
  } finally {
    if (prev === undefined) delete process.env.CURSOR_CHAT_HOME
    else process.env.CURSOR_CHAT_HOME = prev
    rmSync(home, { recursive: true, force: true })
  }
}

async function testScopeBaseline(): Promise<void> {
  console.log('写码基线增量（git）')
  const root = mkdtempSync(join(tmpdir(), 'dev-pipeline-git-'))
  try {
    const init = await runBinary('git', ['init', '-q'], { cwd: root })
    if (init.exit_code !== 0) {
      check('git 可用', false, init.stderr.slice(0, 200))
      return
    }
    await git(['config', 'user.email', 'test@example.com'], root)
    await git(['config', 'user.name', 'test'], root)
    writeFileSync(join(root, 'a.txt'), 'one\n')
    writeFileSync(join(root, 'b.txt'), 'one\n')
    writeFileSync(join(root, 'r1.txt'), 'rename\n')
    await git(['add', '-A'], root)
    await git(['commit', '-q', '-m', 'init'], root)

    writeFileSync(join(root, 'a.txt'), 'user-edit\n')
    writeFileSync(join(root, 'b.txt'), 'user-edit-b\n')
    mkdirSync(join(root, 'newdir'))
    writeFileSync(join(root, 'newdir', 'f.txt'), 'keep\n')
    const baseline = await snapshotScope(root)
    check(
      '基线记录脏文件',
      baseline.git && Object.keys(baseline.paths).length === 3,
      JSON.stringify(Object.keys(baseline.paths)),
    )
    check('未跟踪目录展开成文件', Boolean(baseline.paths['newdir/f.txt']))

    writeFileSync(join(root, 'a.txt'), 'run-edit\n')
    writeFileSync(join(root, 'c.txt'), 'new\n')
    const delta = await deltaSinceBaseline(root, baseline)
    check('识别本次修改', delta.changed.includes('a.txt'), JSON.stringify(delta.changed))
    check('识别本次新建', delta.changed.includes('c.txt'))
    check(
      '原有脏文件不误算',
      delta.untouched_baseline.includes('b.txt') && delta.untouched_baseline.includes('newdir/f.txt'),
      JSON.stringify(delta.untouched_baseline),
    )

    await git(['mv', 'r1.txt', 'r2.txt'], root)
    const rows = await gitStatus(root)
    const rename = rows.find((r) => r.code.startsWith('R'))
    check('重命名取新路径', Boolean(rename && rename.path === 'r2.txt'), JSON.stringify(rows))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function makeCfg(root: string): PipelineConfig {
  const cfg = loadConfig()
  cfg.dataRoot = root
  cfg.warnings = []
  return cfg
}

function testStore(): void {
  console.log('账本与恢复')
  const root = mkdtempSync(join(tmpdir(), 'dev-pipeline-test-'))
  try {
    const cfg = makeCfg(root)
    mkdirSync(join(root, 'runs'), { recursive: true })
    mkdirSync(join(root, 'epics'), { recursive: true })
    const now = nowIso()
    const epic: Epic = {
      id: newId('epic'),
      workspace: root,
      raw_intake: { text: '测试', chars: 2, images: [], one_liner: '测试', source: 'text' },
      artifacts: {},
      created_at: now,
      updated_at: now,
    }
    saveEpic(cfg, epic)
    const run: Run = {
      id: newId('run'),
      epic_id: epic.id,
      session_id: 's1',
      workspace: root,
      status: 'running',
      current_step: '3',
      steps: initSteps(),
      events: [],
      fix_round: 0,
      max_fix_rounds: 3,
      cancel_requested: false,
      mode: 'auto',
      message: '测试',
      created_at: now,
      updated_at: now,
      started_at: now,
      ended_at: '',
      error: '',
    }
    run.steps[2].status = 'running'
    saveRun(cfg, run)
    const loaded = loadRun(cfg, run.id)
    check('Run 落盘可读', Boolean(loaded && loaded.id === run.id))
    const recovered = recoverOrphanedRuns(cfg)
    const after = loadRun(cfg, run.id)
    check('遗留 running 被暂停', recovered === 1 && after?.status === 'paused')
    check('运行中的步骤回到 pending', after?.steps[2].status === 'pending')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

async function testWorkspace(): Promise<void> {
  console.log('工程画像与命令探测')
  const root = mkdtempSync(join(tmpdir(), 'dev-pipeline-ws-'))
  try {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'x', scripts: { test: 'node -e ""', typecheck: 'tsc --noEmit' } }),
    )
    writeFileSync(join(root, 'README.md'), '# demo')
    const ws = normalizeWorkspace(root)
    check('工作区规范化', ws === root)
    let rejected = false
    try {
      normalizeWorkspace(join(root, 'missing'))
    } catch {
      rejected = true
    }
    check('拒绝不存在的目录', rejected)
    const commands = detectValidationCommands(root)
    check('探测到 npm 验证命令', commands.some((c) => c.startsWith('npm run ')), commands.join(', '))
    const out = await runCommand('echo dev-pipeline-ok', { cwd: root, timeoutMs: 10_000 })
    check('子进程执行', out.exit_code === 0 && out.stdout.includes('dev-pipeline-ok'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function testCursorTerminal(): void {
  console.log('写码终态')
  check('succeeded 为终态', TERMINAL.has('succeeded'))
  check('blocked_no_runner 为终态', TERMINAL.has('blocked_no_runner'))
  check('running 不是终态', !TERMINAL.has('running'))
}

async function main(): Promise<void> {
  testCommands()
  testRegistry()
  testSecrets()
  testScopeSanitize()
  testValidationAllowlist()
  testRedact()
  testImages()
  testStore()
  await testWorkspace()
  await testScopeBaseline()
  testCursorTerminal()
  if (failed > 0) {
    console.error(`\n自检失败：${failed} 项`)
    process.exit(1)
  }
  console.log('\n自检通过')
}

void main()
