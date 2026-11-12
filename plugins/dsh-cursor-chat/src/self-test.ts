/**
 * 阶段 B+C 自检：HITL + Mock Cursor → pending_review → apply 同步 + 续改。
 * 用法：CURSOR_CHAT_MOCK=1 pnpm build && pnpm self-test
 */
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _resetHitlStoreForTests, consume, issue } from './hitl.js'
import { loadConfig, saveConfig } from './config.js'
import { isLocalDbRel, partitionChangedPaths, pathInScope } from './pathScope.js'
import {
  _resetPendingConfirmForTests,
  bindPendingJob,
  createPendingConfirm,
  findPendingForCard,
} from './pendingConfirm.js'
import {
  dropStaleFrontendDownNote,
  liveAuditScope,
  pathsForThisRound,
  probeLiveAudit,
  requirementEvidenceChecks,
} from './completionAudit.js'
import { runDeliveryAudit } from './deliveryAudit.js'
import { verifyAddMenuOnTarget } from './menuVerify.js'
import {
  inferSparseBeforeAfter,
  diffSnapshots,
  filterMeaningfulRels,
  listSandboxTargetDrift,
  prepareSandboxForJob,
  prepareSandboxSparse,
  prepareSandboxReuse,
  syncChangedToTarget,
  verifySyncedFingerprints,
} from './sandbox.js'
import {
  cardIdentity,
  cardVisiblePhase,
  detachStaleJobUi,
  preferJobStatus,
  readToolJobFields,
  requirementsConflict,
  shouldApplyJobSnapshot,
  sseMayForceRunning,
  toolBlockCancelled,
  resolveCardBoot,
  shouldShowLiveChrome,
  toolViewPhase,
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
  transcriptMutatedProject,
} from './transcript.js'
import {
  appendEvent,
  createJob,
  findLatestJobByCallId,
  findLatestJobForSession,
  jobCardView,
  loadJob,
  onJobChange,
  patchJob,
  setStatus,
} from './jobs.js'
import {
  hasClarifyEvidence,
  looksLikeAddOrDeletePageMenu,
  looksLikeFollowUp,
  needsRequirementClarify,
} from './requirementGate.js'
import { decideCodingGate, readAskUserAfterLastUser } from './clarifyFlow.js'
import { launchCodingJob } from './launchJob.js'
import { classifyWork, codingParentLink, isInventoryOnlyRequirement } from './workKind.js'
import { isDeleteIntent } from './deleteIntent.js'
import { patchMenuRouterInSandbox, validateDeletePlan } from './deleteEnforce.js'
import { BOOT_ATTEMPTS, isTransientBootError, shouldRetryBoot, transcriptHasRunningTools } from './cursor/runner.js'
import {
  assertBackendRestartReady,
  buildRestartPowerShellBody,
  evaluateBackendRestartOffer,
  executeBackendRestart,
  listBackendRestartHits,
  settleBackendRestartAfterSync,
} from './backendRestart.js'
import { assessBackend, buildServicePrompt, collectRoutePaths, extractRoutePaths, openApiBodyWithRoutes, shouldKeepRunningBackend } from './serviceEnsure.js'
import {
  expandWriteScopeWithCompanions,
  selectCompanionPromotions,
} from './scopeCompanions.js'
import { formatChatConclusion } from './conclusion.js'
import { cardFileNames, pickConclusionForCard } from './conclusionAnchor.js'
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
    const res = await fetch(base + '/api/cursor-chat/jobs/' + encodeURIComponent(jobId))
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
  process.env.CURSOR_CHAT_MOCK = '1'
  const prevHome = process.env.CURSOR_CHAT_HOME
  const home = mkdtempSync(join(tmpdir(), 'cc-self-test-'))
  process.env.CURSOR_CHAT_HOME = home
  process.env.CURSOR_CHAT_PORT = '18797'
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

  // 开发需求（含重启服务）必须交给写码插件里的 Cursor SDK，宿主不得自己动手
  {
    const routeSrc = readFileSync(
      fileURLToPath(new URL('../src/index.ts', import.meta.url)),
      'utf8',
    )
    const runnerSrc = readFileSync(
      fileURLToPath(new URL('../src/cursor/runner.ts', import.meta.url)),
      'utf8',
    )
    assert(routeSrc.includes('开发需求一律交给'), '路由须写明开发需求交给写码插件')
    assert(routeSrc.includes('启动/重启前后端'), '路由须包含重启服务，不能只写改代码')
    assert(routeSrc.includes('bash/grep/read/glob/pwsh'), '宿主不得用自己的 shell 做开发操作')
    assert(routeSrc.includes('不限于改代码'), '工具说明须写明 Cursor 不限于改代码')
    assert(
      !runnerSrc.includes('禁止 npm run dev/build、npx vite、长驻进程；改完即收工。'),
      'SDK 不得再一刀切禁止启动服务',
    )
    assert(runnerSrc.includes('启动/重启前后端'), 'SDK 提示须允许启动或重启服务')
    assert(
      decideCodingGate({ message: '重启前后端服务' }).action === 'pass',
      '重启服务不是入口级变更，不得要求先澄清',
    )
    assert(
      transcriptMutatedProject([{ kind: 'tool', name: 'search_replace' }]) === true,
      'search_replace 必须算改了真实项目',
    )
    assert(
      transcriptMutatedProject([{ kind: 'tool', name: 'apply_patch' }]) === true,
      'apply_patch 必须算改了真实项目',
    )
    assert(
      transcriptMutatedProject([{ kind: 'tool', name: 'shell', command: 'Get-Content app.log 2>&1' }]) === false,
      '只看日志的重定向不得当成改文件',
    )
    assert(
      transcriptMutatedProject([{ kind: 'tool', name: 'shell', command: 'Set-Content -Path a.txt -Value x' }]) === true,
      'Set-Content 必须算改了真实项目',
    )
    const runJobSrc = readFileSync(
      fileURLToPath(new URL('../src/orchestrator/runJob.ts', import.meta.url)),
      'utf8',
    )
    const clientSrcEarly = readFileSync(
      fileURLToPath(new URL('../src/client.js', import.meta.url)),
      'utf8',
    )
    assert(runJobSrc.indexOf("workKind === 'ops'") >= 0, '开工须能走上开发操作分支')
    assert(
      runJobSrc.indexOf("workKind === 'ops'") < runJobSrc.indexOf("setStatus(job, 'running', '准备沙箱…')"),
      '开发操作必须在准备写码沙箱之前返回',
    )
    assert(clientSrcEarly.includes('正在准备执行，不改代码'), '进度卡不得把重启显示成准备写码环境')
    assert(classifyWork('重启前后端服务') === 'ops', '重启前后端是启动服务')
    assert(classifyWork('帮我把服务重启一下') === 'ops', '重启服务是启动服务')
    assert(classifyWork('跑一下测试') === 'ops', '跑测试按 Cursor 在真实项目执行')
    assert(classifyWork('看一下后端日志') === 'ops', '看日志按 Cursor 在真实项目执行')
    assert(classifyWork('排障登录失败') === 'ops', '不改代码的排障按 Cursor 在真实项目执行')
    assert(classifyWork('安装依赖') === 'ops', '装依赖按 Cursor 在真实项目执行')
    assert(classifyWork('把项目跑起来') === 'ops', '把项目跑起来不进写码沙箱')
    assert(classifyWork('排查并修复登录') === 'code', '排障同时要修仍走写码')
    assert(classifyWork('不要改代码，重启前后端') === 'ops', '明确不改代码的重启仍只启动服务')
    assert(classifyWork('新增一个报表页面') === 'code', '新增页面仍是写码')
    assert(classifyWork('修一下登录报错') === 'code', '修 bug 仍是写码')
    assert(classifyWork('重启服务并把端口改成 8080') === 'code', '带改动的重启仍走写码')
    assert(
      isInventoryOnlyRequirement(
        '删除设备OEE看板。本轮只做定位和清单输出，不要修改任何文件。',
      ),
      '明确只出清单且不改文件',
    )
    assert(
      !isInventoryOnlyRequirement('删除设备OEE看板的页面和菜单'),
      '普通删除不是清单轮',
    )
    assert(
      !isInventoryOnlyRequirement('不要修改任何文件以外的配置，直接删除页面'),
      '「以外」不是不改文件',
    )
    assert(
      !isInventoryOnlyRequirement('删除看板页面。本轮只做定位和清单输出，不要修改任何文件。'),
      '用户要删页面时不能收成只出清单',
    )
    const isolated = codingParentLink({
      work_kind: 'ops',
      sandbox_path: workspace,
      agent_id: 'ops-agent',
      workspace,
    })
    assert(isolated.parentSandbox === null && isolated.resumeAgentId === null, '启动服务的父任务不得进入写码沙箱继承')
    const kept = codingParentLink({
      work_kind: 'code',
      sandbox_path: join(workspace, 'sandbox'),
      agent_id: 'code-agent',
      workspace,
    })
    assert(kept.parentSandbox === join(workspace, 'sandbox') && kept.resumeAgentId === 'code-agent', '写码父沙箱仍应继承')
    const opsLaunch = launchCodingJob({ workspace, requirement: '重启前后端服务' })
    assert(opsLaunch.ok, 'ops 开工失败')
    if (opsLaunch.ok) {
      assert(opsLaunch.job.work_kind === 'ops', '重启任务须标记为开发操作')
      assert(!String(opsLaunch.job.detail || '').includes('沙箱'), '开工文案不得提沙箱')
      const opsDeadline = Date.now() + 8000
      let opsJob = loadJob(opsLaunch.job.id)
      while (opsJob && !['succeeded', 'failed', 'cancelled'].includes(opsJob.status) && Date.now() < opsDeadline) {
        await new Promise((r) => setTimeout(r, 40))
        opsJob = loadJob(opsLaunch.job.id)
      }
      assert(opsJob?.status === 'succeeded', '开发操作 Mock 应成功，实际 ' + opsJob?.status + ' ' + opsJob?.detail)
      const opsText = (opsJob?.transcript || []).map((it) => String(it.text || '')).join('\n')
      assert(!opsText.includes('正在改码'), '开发操作过程不得说正在改码')
      assert(!opsText.includes('准备沙箱'), '开发操作不得准备沙箱')
      const opsConclusion = formatChatConclusion(opsJob!)
      assert(!opsConclusion.includes('写码空跑'), '未改代码的重启不得写成写码空跑')
      assert(opsConclusion.includes('未改代码'), '结论须写明未改代码')
      assert(!opsJob?.sandbox_path, '启动服务不得把真实项目记成沙箱')
    }
    console.log('ok: dev work routes to cursor sdk')
  }

  // 路 A：附图归一化 → SDK images
  {
    const { materializeImages, parseImageArgs, toSdkImages } = await import('./images.js')
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    )
    const shot = join(workspace, 'shot.png')
    writeFileSync(shot, png)
    const parsed = parseImageArgs(JSON.stringify([{ path: shot }]))
    assert(parsed.length === 1 && parsed[0].path === shot, 'parseImageArgs path')
    const dest = join(home, 'uploads-test')
    const { refs, errors } = materializeImages(parsed, dest, { allowedRoots: [workspace] })
    assert(!errors.length && refs.length === 1, 'materializeImages')
    const sdk = toSdkImages(refs)
    assert(sdk.length === 1 && 'data' in sdk[0] && sdk[0].mimeType === 'image/png', 'toSdkImages')
    // 安全：工作区外敏感路径不得被读入
    const outside = join(home, 'secret.env')
    writeFileSync(outside, 'SECRET=1\n', 'utf8')
    const denied = materializeImages([{ path: outside }], dest, { allowedRoots: [workspace] })
    assert(denied.refs.length === 0 && denied.errors.length >= 1, 'outside workspace path must be denied')
    console.log('ok: image multimodal pipeline')
  }

  // 空闲超时：工具仍 running 时须识别（避免探索阶段误杀 → 0 文件假成功）
  {
    assert(
      transcriptHasRunningTools([
        { id: '1', kind: 'tool', at: '', name: 'task', tool_status: 'running' },
      ]) === true,
      'running tool 须识别',
    )
    assert(
      transcriptHasRunningTools([
        { id: '1', kind: 'tool', at: '', name: 'glob', tool_status: 'completed' },
      ]) === false,
      'completed 不得当 running',
    )
    assert(transcriptHasRunningTools([]) === false, '空列表')
    console.log('ok: running tools detect')
  }

  // 删除意图：禁止把「新增…含 CRUD 删除字样」判成删除（曾导致假「已下线」收口）
  {
    const addWithCrud =
      '物料管理菜单新增物料信息列表\n完整前后端：列表查询 + 新增/编辑/删除，走工程现有的路由、菜单、接口、表格组件写法。'
    assert(isDeleteIntent(addWithCrud) === false, '新增菜单含 CRUD「删除」字样不得判删除意图')
    assert(isDeleteIntent('物料管理菜单新增物料信息列表') === false, '纯新增不得判删除')
    assert(
      looksLikeAddOrDeletePageMenu('物料管理菜单新增物料信息列表') === true,
      '新增菜单入口须进澄清门禁（有疑先问）',
    )
    assert(
      decideCodingGate({ message: '物料管理菜单新增物料信息列表' }).action === 'block',
      '未澄清的新增菜单须拦 begin',
    )
    assert(isDeleteIntent('删除物料管理菜单') === true, '真删除菜单须判删除意图')
    assert(isDeleteIntent('移除报表中心设备维修菜单') === true, '真移除菜单须判删除意图')
    assert(
      isDeleteIntent('完整前后端：列表查询 + 新增/编辑/删除，走工程现有的路由') === false,
      '孤立 CRUD 三元组不得判删除意图',
    )
    assert(
      isDeleteIntent('新增设备台账页面，支持列表查询与增删改') === false,
      '主诉求新增不得因「增删改」进删除分支',
    )
    assert(
      isDeleteIntent('本页支持增删改，走现有路由') === false,
      '裸「增删改」不得判删除意图',
    )
    console.log('ok: delete intent CRUD noise')
  }

  // 后端重启门禁：仅路由/挂载 + 可解析 Vite 代理端口与 uvicorn 时才开放
  {
    const root = mkdtempSync(join(tmpdir(), 'cc-be-'))
    mkdirSync(join(root, 'backend', 'app', 'routers'), { recursive: true })
    mkdirSync(join(root, 'frontend'), { recursive: true })
    writeFileSync(
      join(root, 'backend', 'app', 'main.py'),
      'from fastapi import FastAPI\napp = FastAPI()\nfrom app.routers import materials\napp.include_router(materials.router)\n',
      'utf8',
    )
    writeFileSync(
      join(root, 'backend', 'app', 'routers', 'materials.py'),
      'from fastapi import APIRouter\nrouter = APIRouter()\n',
      'utf8',
    )
    writeFileSync(
      join(root, 'frontend', 'vite.config.js'),
      "export default { server: { proxy: { '/api': { target: 'http://127.0.0.1:8009' } } } }\n",
      'utf8',
    )

    assert(
      listBackendRestartHits(['frontend/src/views/X.vue'], []).length === 0,
      '纯前端不得命中后端重启',
    )
    assert(
      listBackendRestartHits(['backend/tests/test_x.py'], []).length === 0,
      '测试文件不得命中',
    )
    assert(
      listBackendRestartHits(['backend/app/schemas.py'], []).length === 1,
      'schemas 属运行时代码须命中',
    )
    assert(
      listBackendRestartHits(['backend/app/routers/reports.py'], []).length === 1,
      'reports 路由须命中',
    )
    assert(
      evaluateBackendRestartOffer({
        workspace: root,
        syncedFiles: ['frontend/src/views/X.vue'],
      }) === null,
      '纯前端不得出重启 offer',
    )
    const offer = evaluateBackendRestartOffer({
      workspace: root,
      syncedFiles: ['backend/app/routers/reports.py'],
    })
    assert(offer && offer.offered === true, '仅改 reports 路由也应出重启 offer')
    assert(offer!.port === 8009, '端口须来自 Vite 代理')
    assert(/uvicorn app\.main:app/.test(offer!.command), '启动命令须为 uvicorn app.main')
    assert(offer!.shell_lines.length >= 1, '须有终端脚本行')
    assert(
      /powershell\s+-NoProfile/i.test(offer!.shell_lines[0] || ''),
      'Windows 脚本须为 cmd 可执行的 powershell 单行（避免写进 cmd 等于没跑）',
    )
    const body = buildRestartPowerShellBody({
      cwd: join(root, 'backend'),
      command: offer!.command,
      port: 8009,
    })
    assert(/Set-Location/.test(body) && /uvicorn/.test(body), 'PS 正文须含 cwd + uvicorn')
    // 不在自测里真杀端口；只验证参数校验
    assert(
      executeBackendRestart({ cwd: '', command: 'x', port: 8009 }).ok === false,
      '空 cwd 不得执行',
    )

    const settledSchema = settleBackendRestartAfterSync({
      workspace: root,
      syncedFiles: ['backend/app/schemas.py'],
    })
    assert(settledSchema.offer && settledSchema.offer.offered, 'schemas 同步也应可出 offer')

    const ready = assertBackendRestartReady({
      status: 'succeeded',
      workspace: root,
      synced_files: ['backend/app/routers/reports.py'],
      backend_restart: offer!,
    })
    assert(ready.ok === true, 'succeeded + offer 应可下发重启')
    assert(
      assertBackendRestartReady({
        status: 'failed',
        workspace: root,
        synced_files: ['backend/app/routers/reports.py'],
        backend_restart: offer!,
      }).ok === true,
      'failed 但已同步后端时仍可下发重启',
    )
    assert(
      assertBackendRestartReady({
        status: 'running',
        workspace: root,
        synced_files: ['backend/app/main.py'],
        backend_restart: offer!,
      }).ok === false,
      'running 不得重启',
    )
    assert(
      assertBackendRestartReady({
        status: 'succeeded',
        workspace: root,
        synced_files: ['backend/app/main.py'],
        backend_restart: { ...offer!, started_at: new Date().toISOString() },
      }).ok === false,
      '已下发过不得连点',
    )
    console.log('ok: backend restart gate')
  }

  {
    const paths = extractRoutePaths(
      'from fastapi import APIRouter\nrouter = APIRouter(prefix="/api/materials")\n@router.get("/list")\ndef list_materials():\n    return []\n',
    )
    assert(paths.length === 1 && paths[0] === '/api/materials/list', '应拼出带前缀的新路径，实际 ' + paths.join(','))
    const focused = pathsForThisRound(
      [
        'frontend/src/views/reports/EquipmentDowntimeReportView.vue',
        'backend/app/routers/reports.py',
        'backend/tests/test_equipment_downtime_report.py',
      ],
      [
        '/api/reports/wip',
        '/api/reports/daily-output',
        '/api/reports/equipment-downtime',
        '/api/reports/employee-work-hours',
      ],
    )
    assert(
      focused.length === 1 && focused[0] === '/api/reports/equipment-downtime',
      '只保留本轮停机接口，实际 ' + focused.join(','),
    )
    const onlyFront = liveAuditScope(['frontend/src/views/kanban/EquipmentOeeKanbanView.vue'])
    assert(onlyFront.frontend && !onlyFront.backend, '只改前端时不探后端')
    const onlyBack = liveAuditScope(['backend/app/routers/kanban_equipment_oee.py'])
    assert(!onlyBack.frontend && onlyBack.backend, '只改后端时不探前端')
    const onlyDoc = liveAuditScope(['docs/API.md'])
    assert(!onlyDoc.frontend && !onlyDoc.backend, '没改前后端文件时不探服务')
    assert(
      pathsForThisRound(['backend/app/routers/reports.py'], ['/api/reports/wip']).length === 0,
      '只有泛名文件时不把旧接口算成本轮',
    )
    const stale =
      '已同步 6 个文件；已触碰前端文件；:5175 未在监听（请本机自行开 Vite，插件不再自动 npm run dev）。'
    assert(dropStaleFrontendDownNote(stale, true).indexOf('未在监听') < 0, '前端已响应时去掉未监听说明')
    assert(dropStaleFrontendDownNote(stale, false).indexOf('未在监听') >= 0, '前端未响应时保留说明')
    const prompt = buildServicePrompt({
      workspace: 'D:/proj',
      backendFiles: ['backend/app/routers/materials.py'],
      frontendFiles: [],
      backendPort: 8009,
      frontendPort: 5175,
      frontendUp: true,
      backendRoot: 'D:/proj/backend',
      pythonExe: 'D:/proj/backend/.venv/Scripts/python.exe',
      hintCommand: 'python -m uvicorn app.main:app --port 8009',
    })
    assert(prompt.includes('禁止修改'), '终端确认提示必须禁止改文件')
    assert(prompt.includes('不要重启前端'), '前端已在听时不得要求重启前端')
    assert(prompt.includes('8009'), '提示里要带上原端口')
    assert(shouldKeepRunningBackend(true) === true, '后端已在监听时不得重启')
    assert(shouldKeepRunningBackend(false) === false, '后端没在监听时才允许按命令拉起')
    const server = await import('node:http').then((m) =>
      m.createServer((req, res) => {
        if (req.url === '/openapi.json') {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ paths: { '/api/materials/list': {} } }))
          return
        }
        res.writeHead(200)
        res.end('docs')
      }),
    )
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const addr = server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    try {
      const hit = await assessBackend(port, ['/api/materials/list'])
      assert(hit.ok, '文档里有新路径时应通过：' + hit.api)
      const miss = await assessBackend(port, ['/api/missing'], { timeoutMs: 0 })
      assert(miss.ok === false, '文档里没有的新路径不得通过')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    let reads = 0
    const reloading = await import('node:http').then((m) =>
      m.createServer((req, res) => {
        if (req.url === '/openapi.json') {
          reads += 1
          const paths =
            reads < 3
              ? { '/api/equipment-maintenance/plans': {} }
              : {
                  '/api/equipment-maintenance/plans': {},
                  '/api/equipment-maintenance-records': {},
                }
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ paths }))
          return
        }
        res.writeHead(200)
        res.end('docs')
      }),
    )
    await new Promise<void>((resolve) => reloading.listen(0, '127.0.0.1', () => resolve()))
    const reloadAddr = reloading.address()
    const reloadPort = typeof reloadAddr === 'object' && reloadAddr ? reloadAddr.port : 0
    try {
      const settled = await openApiBodyWithRoutes(reloadPort, ['/api/equipment-maintenance-records'], {
        timeoutMs: 3_000,
        intervalMs: 20,
      })
      assert(settled.missing.length === 0, '热重载后文档出现本轮接口就应通过')
      assert(reads >= 3, '不能拿第一次旧文档下结论，实际读取 ' + reads)
      const still = await openApiBodyWithRoutes(reloadPort, ['/api/not-loaded'], {
        timeoutMs: 40,
        intervalMs: 20,
      })
      assert(
        still.missing.length === 1 && still.missing[0] === '/api/not-loaded',
        '等到超时仍没有的接口才算没加载',
      )
    } finally {
      await new Promise<void>((resolve) => reloading.close(() => resolve()))
    }
    console.log('ok: service ensure probe')
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
    assert(!looksLikeAddOrDeletePageMenu('删除废弃路由'), '裸删路由不拦')
    assert(!looksLikeAddOrDeletePageMenu('添加路由守卫'), '裸加路由守卫不拦')
    assert(
      looksLikeAddOrDeletePageMenu('删除设置页面相关路由'),
      '删页面相关路由仍须澄清',
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
      const echoEvents = events.concat([
        { type: 'user/message', data: { message: { content: '菜单入口 + 对应页面文件/路由' } } },
      ])
      assert(readAskUserAfterLastUser(echoEvents).answered === true, '紧挨结果的答题回声仍算已答完')
      assert(
        decideCodingGate({ message: orig, clarified: true, events: echoEvents }).action === 'pass',
        '答题回声后须出确认卡',
      )
      const followUpEvents = echoEvents.concat([
        { type: 'tool/call', data: { callId: 'begin1', name: 'zr_cchat_begin', arguments: '{}' } },
        {
          type: 'tool/result',
          data: { message: { source: { kind: 'tool', callId: 'begin1' }, content: [] } },
        },
        { type: 'user/message', data: { message: { content: '报表中心再新增一个考勤汇总页' } } },
      ])
      assert(
        readAskUserAfterLastUser(followUpEvents).answered === false,
        '续改新原话不得沿用上一轮选择题',
      )
      assert(
        decideCodingGate({
          message: '报表中心再新增一个考勤汇总页',
          clarified: true,
          events: followUpEvents,
        }).action === 'block',
        '入口级续改仍须重新澄清',
      )
      const aliasEvents = [
        { type: 'user.message', data: {} },
        { type: 'tool.call', data: { callId: 'c2', name: 'ask_user_question', arguments: '{}' } },
        {
          type: 'tool.result',
          data: {
            callId: 'c2',
            message: {
              source: { callId: 'c2' },
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ answers: [{ id: 'scope', selected: ['仅菜单'] }] }),
                },
              ],
            },
          },
        },
      ]
      assert(readAskUserAfterLastUser(aliasEvents).answered === true, 'tool.call 别名应配对')
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

  // 结论只挂到对得上的那张「已编辑」卡，不能因单个公共文件贴到别的任务上
  {
    const cardText = [
      '已编辑 5 个文件',
      'backend/app/routers/reports.py',
      'backend/app/schemas.py',
      'frontend/src/api/reports/equipmentDowntime.js',
      'frontend/src/config/reportFeatures.js',
    ].join('\n')
    const names = cardFileNames(cardText)
    assert(names.includes('reports.py') && names.includes('equipmentdowntime.js'), '改动卡应抽出文件名')
    const newer = {
      id: 'cch-delete',
      updated_at: '2026-11-06T08:45:19.880Z',
      chat_conclusion: '## 本轮结论\n\n结果：✅ 已完成。已删除停机报表\n',
      synced_files: [
        'frontend/src/config/reportFeatures.js',
        'backend/app/schemas.py',
        'backend/app/routers/reports.py',
      ],
      deleted_files: [
        'frontend/src/views/reports/EquipmentDowntimeReportView.vue',
        'frontend/src/api/reports/equipmentDowntime.js',
      ],
    }
    const sharedOne = {
      id: 'cch-other',
      updated_at: '2026-11-06T07:37:00.000Z',
      chat_conclusion: '## 本轮结论\n\n结果：✅ 已完成。另一份\n',
      synced_files: ['frontend/src/config/reportFeatures.js'],
      deleted_files: [] as string[],
    }
    const picked = pickConclusionForCard([sharedOne, newer], names)
    assert(picked?.id === 'cch-delete', '多文件卡不得按单个公共文件挂旧结论')
    assert(pickConclusionForCard([sharedOne], names) === null, '只重合 1 个文件时不挂')
    const clientSrc = readFileSync(
      fileURLToPath(new URL('../src/client.js', import.meta.url)),
      'utf8',
    )
    const start = clientSrc.indexOf('function fileBasename(')
    const end = clientSrc.indexOf('function findEditedCardIn(')
    assert(start > 0 && end > start, 'client 应内联同一套对卡函数')
    const clientFns = new Function(
      `${clientSrc.slice(start, end)}\nreturn { cardFileNames, pickConclusionForCard }`,
    )() as {
      cardFileNames: (t: string) => string[]
      pickConclusionForCard: typeof pickConclusionForCard
    }
    const fromClient = clientFns.pickConclusionForCard([sharedOne, newer], clientFns.cardFileNames(cardText))
    assert(fromClient?.id === 'cch-delete', 'client 对卡结果须与 conclusionAnchor 一致')
    assert(
      clientSrc.includes('工具卡收在「已调用工具」里'),
      '工具卡路径不得再插正文',
    )
    assert(
      /function installGlobalConclusionPublisher\(\) \{[\s\S]{0,500}?return/.test(clientSrc),
      '不得再改宿主对话 DOM，否则其它会话正文会被掏空',
    )
    assert(clientSrc.includes("conversation.chat.turnTail"), '结论须挂 turnTail')
    assert(
      /name: 'conversation\.chat\.turnTail'[\s\S]{0,200}?select:/.test(clientSrc),
      'turnTail 注册须带 select，兼容 chain 版宿主（list 版忽略）',
    )
    assert(clientSrc.includes('session-conclusion?session_id='), 'turnTail 须按 session 取结论')
    assert(clientSrc.includes('cc-be-hoist'), '结论区须常显后端重启条，避免进度卡折叠后一闪消失')
    assert(clientSrc.includes('issueBackendRestartAndRun'), '进度卡与结论区须共用重启下发')
    const serverSrc = readFileSync(
      fileURLToPath(new URL('../src/server.ts', import.meta.url)),
      'utf8',
    )
    assert(
      serverSrc.includes('backend_restart: job.backend_restart'),
      'session-conclusion 须下发 backend_restart',
    )
    console.log('ok: conclusion anchors to changed-files card')
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
    {
      const ended = createJob({ workspace, requirement: '结论正文' })
      patchJob(ended.id, {
        assistant_text: '过程…\n\n## 说明方案\n**结论**\n已改菜单\n\n**改动文件**\n- a.js\n',
        synced_files: ['frontend/src/a.js'],
        last_synced_files: ['frontend/src/a.js'],
      })
      setStatus(loadJob(ended.id)!, 'succeeded', '已同步 1 个文件')
      const body = formatChatConclusion(loadJob(ended.id)!)
      assert(body.indexOf('## 本轮结论') === 0, '正文须以本轮结论开头')
      assert(body.indexOf('结果：') >= 0, '须含结果段')
      assert(body.indexOf('改动：') >= 0, '须含改动段')
      assert(body.indexOf('请你验收：') >= 0, '须含请你验收段')
      assert(body.indexOf('改动文件：') < 0, '路径清单交给底座「已编辑 N 个文件」卡片，正文不再重复')
      assert(body.indexOf('### 2. 做了什么') < 0, '旧标题不得再出现')
      assert((body.match(/##\s*本轮结论/g) || []).length === 1, '正文只能有一份本轮结论')
      assert(body.indexOf('已改菜单') >= 0, '须带上说明方案要点')
    }
    {
      // 空跑：0 同步 + 仅有 db 噪音 → failed + 不得复读 Cursor「已改路由」长文当交付
      const empty = createJob({ workspace, requirement: '空跑结论' })
      patchJob(empty.id, {
        assistant_text:
          '## 说明方案\n**结论**\n已补路由与菜单\n\n**改动文件**\n- frontend/src/router/index.js\n\n**验收**\n1. 打开页面\n',
        changed_files: ['backend/erp.db'],
        synced_files: [],
        last_synced_files: [],
      })
      setStatus(loadJob(empty.id)!, 'failed', '写码空跑已拦截')
      const emptyBody = formatChatConclusion(loadJob(empty.id)!)
      assert(emptyBody.indexOf('未向目标工程交付新代码') >= 0, '空跑须明示未交付')
      assert(emptyBody.indexOf('写码空跑已拦截') >= 0, 'failed 空跑须标注拦截')
      assert(emptyBody.indexOf('同步文件数：0') >= 0, '空跑须写明 0 同步')
      assert(emptyBody.indexOf('已补路由与菜单') < 0, '空跑不得把 Cursor 改动话术当已落盘')
    }
    {
      assert(
        isTransientBootError(
          'Error: 启动 Cursor Local超时（>45s）。请检查网络/代理与 Cursor API Key 后重试。',
        ),
        '启动超时要自动重试',
      )
      assert(!isTransientBootError('已取消'), '取消不重试')
      assert(!isTransientBootError('Invalid API key'), '密钥错误不重试')
      assert(
        !shouldRetryBoot('Invalid API key（retryable=true）', true),
        'SDK 标了可重试也不能重试密钥错误',
      )
      assert(BOOT_ATTEMPTS >= 3, '启动至少自动重试三轮')
      const bootFail = createJob({ workspace, requirement: '看板管理新增设备OEE看板' })
      patchJob(bootFail.id, {
        assistant_text: '',
        changed_files: [],
        synced_files: [],
        last_synced_files: [],
      })
      setStatus(
        loadJob(bootFail.id)!,
        'failed',
        'Error: 启动 Cursor Local超时（>45s）。请检查网络/代理与 Cursor API Key 后重试。 已自动重试 3 次，仍未开始写码。',
      )
      const bootBody = formatChatConclusion(loadJob(bootFail.id)!)
      assert(bootBody.indexOf('写码没有开始') >= 0, '启动失败不得伪装成写码完成')
      assert(bootBody.indexOf('写码空跑已拦截') < 0, '启动失败不得写成空跑')
      assert(bootBody.indexOf('相关修复已存在') < 0, '启动失败不得编造本机已有修复')
      assert(bootBody.indexOf('已自动重试 3 次') >= 0, '结论要写明已经自动重试')
      const genericFail = createJob({ workspace, requirement: '看板管理新增设备OEE看板' })
      patchJob(genericFail.id, { assistant_text: '', synced_files: [], changed_files: [] })
      setStatus(loadJob(genericFail.id)!, 'failed', 'Cursor 执行失败')
      const genericBody = formatChatConclusion(loadJob(genericFail.id)!)
      assert(genericBody.indexOf('写码没有开始') < 0, '普通执行失败不得写成启动超时')
    }
    {
      const gate = mkdtempSync(join(tmpdir(), 'cc-audit-path-'))
      try {
        const ws = join(gate, 'ws')
        mkdirSync(ws)
        writeFileSync(
          join(gate, 'test_secret.py'),
          "from fastapi import APIRouter\nrouter = APIRouter()\n@router.get('/api/should-not-leak')\n",
        )
        const leaked = collectRoutePaths(ws, ['../test_secret.py'])
        assert(leaked.length === 0, '审计读文件不得越出工程')
      } finally {
        rmSync(gate, { recursive: true, force: true })
      }
    }
    {
      const listed = createJob({
        workspace,
        requirement: '删除设备OEE看板。本轮只做定位和清单输出，不要修改任何文件。',
      })
      const listBody =
        '## 说明方案\n**结论**\n已定位设备OEE看板，本轮未改文件。\n\n' +
        '页面：frontend/src/views/kanban/EquipmentOeeKanbanView.vue\n' +
        '路由：frontend/src/router/index.js\n菜单：frontend/src/layouts/AppLayout.vue\n'
      patchJob(listed.id, {
        assistant_text: listBody,
        changed_files: [],
        synced_files: [],
        last_synced_files: [],
      })
      setStatus(loadJob(listed.id)!, 'succeeded', '本轮按要求只输出清单，未改文件。')
      const listedOut = formatChatConclusion(loadJob(listed.id)!)
      assert(listedOut.indexOf('清单已给出') >= 0, '清单轮须交付清单')
      assert(listedOut.indexOf('EquipmentOeeKanbanView.vue') >= 0, '清单轮须保留定位到的文件')
      assert(listedOut.indexOf('写码空跑已拦截') < 0, '清单轮不得当成空跑')
    }
    {
      const root = mkdtempSync(join(tmpdir(), 'cc-del-unknown-'))
      const view = 'frontend/src/views/kanban/EquipmentOeeKanbanView.vue'
      const report = 'frontend/src/views/reports/EquipmentOeeReportView.vue'
      const api = 'frontend/src/api/kanbanEquipmentOee.js'
      const back = 'backend/app/routers/kanban_equipment_oee.py'
      mkdirSync(join(root, 'frontend/src/views/kanban'), { recursive: true })
      mkdirSync(join(root, 'frontend/src/views/reports'), { recursive: true })
      mkdirSync(join(root, 'frontend/src/api'), { recursive: true })
      mkdirSync(join(root, 'frontend/src/layouts'), { recursive: true })
      mkdirSync(join(root, 'frontend/src/router'), { recursive: true })
      mkdirSync(join(root, 'backend/app/routers'), { recursive: true })
      writeFileSync(join(root, view), '<template></template>\n', 'utf8')
      writeFileSync(join(root, report), '<template></template>\n', 'utf8')
      writeFileSync(join(root, api), 'export function fetchEquipmentOeeKanban() {}\n', 'utf8')
      writeFileSync(join(root, back), 'router = APIRouter()\n', 'utf8')
      const layout = [
        "{ path: '/kanban/production', title: '生产看板', icon: SetUp },",
        "{ path: '/kanban/equipment-oee', title: '设备OEE看板', icon: Cpu },",
      ].join('\n') + '\n'
      const router = [
        "import ProductionKanbanView from '../views/kanban/ProductionKanbanView.vue'",
        "import EquipmentOeeKanbanView from '../views/kanban/EquipmentOeeKanbanView.vue'",
        'path === \'production\' ? ProductionKanbanView',
        ': path === \'equipment-oee\' ? EquipmentOeeKanbanView',
      ].join('\n') + '\n'
      writeFileSync(join(root, 'frontend/src/layouts/AppLayout.vue'), layout, 'utf8')
      writeFileSync(join(root, 'frontend/src/router/index.js'), router, 'utf8')
      const requirement = '删除「设备OEE看板」的页面和菜单。不含后端接口，后端保留。'
      const note = [
        '看板页面 `' + view + '` ✅',
        '报表 `' + report + '` ❌ 不删',
        '后端 `' + back + '` ❌ 保留',
      ].join('\n')
      const plan = validateDeletePlan([view, report, api, back], requirement, root, {
        assistant_text: note,
      })
      assert(plan.approved.includes(view), '未登记的看板页面也要能删')
      assert(plan.approved.includes(api), '看板专用接口文件也要能删')
      assert(!plan.approved.includes(report), '标明不删的报表不得删')
      assert(!plan.approved.includes(back), '写明后端保留时不得删后端')
      const patched = patchMenuRouterInSandbox(root, root, [], ['设备OEE看板', 'EquipmentOeeKanbanView'])
      assert(patched.includes('frontend/src/layouts/AppLayout.vue'), '侧栏要去掉该菜单行')
      const layoutAfter = readFileSync(join(root, 'frontend/src/layouts/AppLayout.vue'), 'utf8')
      const routerAfter = readFileSync(join(root, 'frontend/src/router/index.js'), 'utf8')
      assert(!layoutAfter.includes('设备OEE看板'), '设备OEE看板菜单行应去掉')
      assert(layoutAfter.includes('生产看板'), '其它看板菜单要留着')
      assert(!routerAfter.includes('EquipmentOeeKanbanView'), '路由里该页面引用应去掉')
      assert(routerAfter.includes('ProductionKanbanView'), '其它看板路由要留着')
      rmSync(root, { recursive: true, force: true })
    }
    const live = snippetFromTextDiff('const a = 1\n', 'const a = 2\nconst b = 3\n')
    assert(live && live.includes('- const a = 1') && live.includes('+ const a = 2'), '沙箱 diff 片断应含 +/-')
    assert(live && live.includes('@@'), 'diff 片断应含 @@ 头以便行号')
    console.log('ok: progress tool snippets')
  }

  // 进度卡异常不得冒到宿主：keyed toolview 一崩就会注销，后续写码只剩结论
  {
    const clientSrc = readFileSync(fileURLToPath(new URL('../src/client.js', import.meta.url)), 'utf8')
    assert(clientSrc.includes('function CursorCodingCardBoundary'), '进度卡须自带错误边界')
    assert(
      clientSrc.includes('getDerivedStateFromError'),
      '错误边界须拦住渲染异常，避免宿主注销 zr_cchat_begin',
    )
    assert(
      clientSrc.includes('h(CursorCodingCardBoundary, null, h(CursorCodingBeginCardLive, props))'),
      '写码卡必须包在自己的边界里',
    )
    assert(clientSrc.includes('!isDoneView || !opsCard'), '写码卡终态仍展示过程，不收进折叠')
    console.log('ok: coding card error stays inside the toolview')
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
      job_id: 'cch-20260912-191312-37f8',
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
    const missingReq = detachStaleJobUi({
      ui: { job_id: oldUi.job_id, status: 'succeeded', kind: 'live' },
      argsMessage: '报表中心菜单新增设备点检报表\n澄清结论…',
    })
    assert(missingReq.stale === false, '刷新丢 ui.requirement 不得拆已完成 job')
    assert(String(missingReq.ui.job_id || '') === oldUi.job_id, '应保留 job_id 以便恢复 Diff/结论')
    assert(requirementsConflict('设备点检报表', '设备维修报表'), '点检/维修须冲突')
    assert(
      cardIdentity({ callId: 'call-new' }) !== cardIdentity({ callId: 'call-old' }),
      '不同 callId 须不同卡身份',
    )
    console.log('ok: card bootstrap anti-stale')
    {
      assert(preferJobStatus('running', 'succeeded') === 'succeeded', '工具终态须压过缓存 running')
      assert(preferJobStatus('succeeded', 'queued') === 'succeeded', '缓存终态须压过陈旧 queued')
      assert(preferJobStatus('running', '') === 'running', '仅缓存时保持 running')
      assert(preferJobStatus('pending_review', 'running') === 'pending_review', 'pending_review 优先于 running')
      assert(shouldApplyJobSnapshot({ sealedStatus: 'succeeded', incomingStatus: 'running' }) === false, '封口后忽略 running 快照')
      assert(shouldApplyJobSnapshot({ sealedStatus: 'succeeded', incomingStatus: 'succeeded' }) === true, '终态快照仍可刷新')
      assert(shouldApplyJobSnapshot({ sealedStatus: '', incomingStatus: 'running' }) === true, '未封口须吃 running')
      assert(sseMayForceRunning('succeeded') === false, '封口后禁止 review 打回 running')
      assert(sseMayForceRunning('') === true, '未封口允许 running')
      assert(
        cardVisiblePhase({
          phase: 'running',
          sealedStatus: '',
          uiStatus: 'succeeded',
          resultDone: true,
          resultStatus: 'succeeded',
        }) === 'done',
        '工具结果 succeeded 时进度卡不得继续转圈',
      )
      assert(
        cardVisiblePhase({
          phase: 'running',
          sealedStatus: 'succeeded',
          uiStatus: 'running',
        }) === 'done',
        '已封口后陈旧 ui.running 不得覆盖终态',
      )
      assert(
        cardVisiblePhase({ phase: 'running', resultDone: false, resultStatus: 'succeeded' }) === 'running',
        '无 done=true 不得把 status 当终态',
      )
      const parsed = readToolJobFields({
        result: { done: true, job_id: 'cch-x', status: 'succeeded', cursor_chat_ui: { status: 'succeeded' } },
      })
      assert(parsed.done === true && parsed.status === 'succeeded' && parsed.jobId === 'cch-x', '须从嵌套 result 取出权威 status')
      const stringDone = readToolJobFields({ done: 'true', job_id: 'cch-y', status: 'succeeded' })
      assert(stringDone.done === false, 'done 只认布尔 true，不认字符串')
      assert(
        cardVisiblePhase({
          phase: 'running',
          resultDone: true,
          resultStatus: 'succeeded',
          resultJobId: 'cch-other',
          liveJobId: 'cch-live',
        }) === 'running',
        '他人 job 终态不得封本卡',
      )
      assert(
        cardVisiblePhase({
          phase: 'running',
          resultDone: true,
          resultStatus: 'succeeded',
          resultJobId: 'cch-live',
          liveJobId: 'cch-live',
        }) === 'done',
        '本卡工具终态须停转圈',
      )
      assert(
        cardVisiblePhase({ phase: 'form', toolCancelled: true }) === 'done',
        '已停止/aborted 不得停留 form 转圈',
      )
      assert(
        cardVisiblePhase({ phase: 'form', idleSettled: true }) === 'done',
        '无 job 的已结算 begin 不得开工转圈',
      )
      assert(toolBlockCancelled({ error: { code: 'aborted' } }) === true, '须认 error.code=aborted')
      assert(
        toolBlockCancelled({ isError: true, error: { message: 'tool call aborted' } }) === true,
        '须认宿主停止产生的 aborted 消息',
      )
      assert(toolBlockCancelled({ isError: true, error: {} }) === false, '仅 isError 无 aborted 字段不得当取消')
      assert(
        toolBlockCancelled({ result: { detail: '用户说取消' } }) === false,
        '禁止扫结果正文当取消',
      )
      // —— 截图复现：已停止重开仍「正在开工/连接」——
      {
        const stoppedBoot = resolveCardBoot({
          viewPhase: 'start',
          jobId: '',
          jobStatus: '',
          aborted: false,
          settled: false,
          hostTurnLive: false,
        })
        assert(stoppedBoot.phase === 'done' && stoppedBoot.statusLabel === '已停止', '已停止+start 须封口')
        assert(
          shouldShowLiveChrome({
            visiblePhase: stoppedBoot.phase,
            cancelled: stoppedBoot.cancelled,
            toolCancelled: false,
            idleSettled: false,
            hostTurnLive: false,
          }) === false,
          '已停止禁止转圈',
        )
      }
      {
        const formStopped = resolveCardBoot({
          viewPhase: '',
          jobId: '',
          jobStatus: '',
          aborted: false,
          settled: false,
          hostTurnLive: false,
        })
        assert(formStopped.phase === 'done', '已停止+空相位也须封口（禁止 form 开工）')
        assert(
          shouldShowLiveChrome({
            visiblePhase: 'form',
            cancelled: false,
            toolCancelled: false,
            idleSettled: false,
            hostTurnLive: false,
          }) === false,
          'host 未 live 时 form 也不得转圈',
        )
      }
      {
        const withJobLive = resolveCardBoot({
          viewPhase: 'result',
          jobId: 'cch-x',
          jobStatus: 'running',
          aborted: false,
          settled: true,
          hostTurnLive: false,
        })
        assert(
          withJobLive.phase === 'running' && withJobLive.statusLabel === '写码中',
          '未终态 job 即使 host 未 live 也必须 running（禁止空等只出结论）',
        )
        assert(
          shouldShowLiveChrome({
            visiblePhase: 'running',
            cancelled: false,
            toolCancelled: false,
            idleSettled: false,
            hostTurnLive: false,
            hasActiveJob: true,
          }) === true,
          '未终态 job 必须展示过程 chrome',
        )
      }
      {
        const jobDoneStopped = resolveCardBoot({
          viewPhase: 'result',
          jobId: 'cch-x',
          jobStatus: 'succeeded',
          aborted: false,
          settled: true,
          hostTurnLive: false,
        })
        assert(jobDoneStopped.phase === 'done' && jobDoneStopped.statusLabel === '已完成', '终态 job 显示已完成')
      }
      {
        const liveStart = resolveCardBoot({
          viewPhase: 'start',
          jobId: '',
          jobStatus: '',
          aborted: false,
          settled: false,
          hostTurnLive: true,
        })
        assert(liveStart.phase === 'running', 'live start 允许 running')
        assert(
          shouldShowLiveChrome({
            visiblePhase: 'running',
            cancelled: false,
            toolCancelled: false,
            idleSettled: false,
            hostTurnLive: true,
          }) === true,
          'live running 允许转圈',
        )
      }
      {
        const abortedBoot = resolveCardBoot({
          viewPhase: 'result',
          jobId: '',
          jobStatus: '',
          aborted: true,
          settled: true,
          hostTurnLive: true,
        })
        assert(abortedBoot.phase === 'done' && abortedBoot.cancelled, 'aborted 须封口')
      }
      assert(toolViewPhase({ phase: 'start', block: {} }) === 'start', '须读 props.phase')
      assert(
        toolViewPhase({ block: { phase: 'preparing' } }) === 'preparing',
        '须读 block.phase',
      )
      {
        let seen = ''
        const off = onJobChange((id, st) => {
          seen = id + ':' + st
        })
        const noted = createJob({ workspace, requirement: '终态须立即通知 SSE' })
        setStatus(noted, 'succeeded', 'ok')
        off()
        assert(seen === noted.id + ':succeeded', 'succeeded 落盘须同步通知监听器')
        const card = jobCardView(loadJob(noted.id)!)
        assert(card.status === 'succeeded', '进度卡视图含 status')
        assert(!('events' in card), '进度卡视图不得带 events')
        assert(String(card.chat_conclusion || '').indexOf('## 本轮结论') === 0, '进度卡视图须带正文结论')
      }
      const ended = createJob({ workspace, requirement: '终态不可回写' })
      setStatus(ended, 'succeeded', 'ok')
      setStatus(loadJob(ended.id)!, 'running', '不得打回写码中')
      assert(loadJob(ended.id)?.status === 'succeeded', 'succeeded 后禁止再写 running')
    }
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
    const part = partitionChangedPaths(
      ['backend/app/routers/reports.py', 'backend/erp.db', 'backend/erp.db-wal'],
      ['backend/'],
    )
    assert(part.inScope.includes('backend/app/routers/reports.py'), '代码须进同步范围')
    assert(!part.inScope.includes('backend/erp.db'), 'erp.db 不得进同步范围（防 EPERM 整单失败）')
    assert(!part.deferred.includes('backend/erp.db'), 'erp.db 亦不得进 deferred')
    assert(isLocalDbRel('backend/erp.db'), 'erp.db 须识别为本地库')
    assert(isLocalDbRel('backend/erp.db-wal'), 'wal 须识别为本地库')
    assert(!isLocalDbRel('backend/app/db.py'), 'db.py 源码不得当库文件')
    assert(!isLocalDbRel('backend/app/database.py'), 'database.py 不得当库文件')
    console.log('ok: scope companions')
  }

  // 复现现场：目标 erp.db 被占用时，同批 reports.py 仍须落盘且不得整单抛错
  {
    const root = mkdtempSync(join(tmpdir(), 'cc-db-sync-'))
    const sb = join(root, 'sandbox')
    const tg = join(root, 'target')
    mkdirSync(join(sb, 'backend/app/routers'), { recursive: true })
    mkdirSync(join(tg, 'backend/app/routers'), { recursive: true })
    writeFileSync(join(sb, 'backend/app/routers/reports.py'), '# new routes\n', 'utf8')
    writeFileSync(join(sb, 'backend/erp.db'), 'SANDBOX-DB', 'utf8')
    writeFileSync(join(tg, 'backend/erp.db'), 'LOCKED-DB', 'utf8')
    writeFileSync(join(tg, 'backend/app/routers/reports.py'), '# old\n', 'utf8')
    const fd = openSync(join(tg, 'backend/erp.db'), 'r+')
    try {
      const written = syncChangedToTarget(sb, tg, [
        'backend/erp.db',
        'backend/app/routers/reports.py',
      ])
      assert(written.includes('backend/app/routers/reports.py'), '占用 db 时 reports.py 必须仍同步')
      assert(!written.includes('backend/erp.db'), 'erp.db 不得进入写入列表')
      assert(
        readFileSync(join(tg, 'backend/app/routers/reports.py'), 'utf8') === '# new routes\n',
        '目标 reports.py 内容须更新',
      )
      assert(
        readFileSync(join(tg, 'backend/erp.db'), 'utf8') === 'LOCKED-DB',
        '占用中的目标 erp.db 不得被覆盖',
      )
    } finally {
      closeSync(fd)
      rmSync(root, { recursive: true, force: true })
    }
    console.log('ok: sync skips locked local db')
  }

  // 空跑拦截：相对开工快照无 diff 时，沙箱↔目标漂移须可检出并补同步；纯噪音不得当 meaningful
  {
    const root = mkdtempSync(join(tmpdir(), 'cc-drift-'))
    const sb = join(root, 'sandbox')
    const tg = join(root, 'target')
    mkdirSync(join(sb, 'frontend/src'), { recursive: true })
    mkdirSync(join(tg, 'frontend/src'), { recursive: true })
    mkdirSync(join(sb, 'backend'), { recursive: true })
    mkdirSync(join(tg, 'backend'), { recursive: true })
    writeFileSync(join(sb, 'frontend/src/App.vue'), '<template>new</template>\n', 'utf8')
    writeFileSync(join(tg, 'frontend/src/App.vue'), '<template>old</template>\n', 'utf8')
    writeFileSync(join(sb, 'backend/erp.db'), 'SB-DB', 'utf8')
    writeFileSync(join(tg, 'backend/erp.db'), 'TG-DB', 'utf8')
    const drift = listSandboxTargetDrift(sb, tg, ['frontend/', 'backend/'])
    assert(drift.includes('frontend/src/App.vue'), '内容不一致须检出漂移')
    assert(!drift.includes('backend/erp.db'), '本地库不得进漂移同步清单')
    const meaningful = filterMeaningfulRels([...drift, 'backend/erp.db', 'backend/erp.db-wal'])
    assert(meaningful.includes('frontend/src/App.vue'), '源码漂移须保留')
    assert(!meaningful.some((p) => isLocalDbRel(p)), 'meaningful 不得含本地库')
    const synced = syncChangedToTarget(sb, tg, meaningful)
    assert(synced.includes('frontend/src/App.vue'), '漂移补同步须落盘')
    assert(
      readFileSync(join(tg, 'frontend/src/App.vue'), 'utf8') === '<template>new</template>\n',
      '目标须被沙箱内容覆盖',
    )
    // 内容已对齐后应无漂移
    assert(
      listSandboxTargetDrift(sb, tg, ['frontend/', 'backend/']).length === 0,
      '对齐后不得再报漂移',
    )
    rmSync(root, { recursive: true, force: true })
    console.log('ok: sandbox↔target drift gate')
  }

  // 菜单验尸：报表走 catalog；看板/其它页面走路由+侧栏，不得拿报表目录误杀
  {
    const root = mkdtempSync(join(tmpdir(), 'cc-menu-'))
    const tg = join(root, 'target')
    mkdirSync(join(tg, 'frontend/src/config'), { recursive: true })
    mkdirSync(join(tg, 'frontend/src/layouts'), { recursive: true })
    mkdirSync(join(tg, 'frontend/src/router'), { recursive: true })
    mkdirSync(join(tg, 'frontend/src/views/kanban'), { recursive: true })
    mkdirSync(join(tg, 'frontend/src/views/sales'), { recursive: true })
    mkdirSync(join(tg, 'frontend/src/views/reports'), { recursive: true })
    writeFileSync(join(tg, 'frontend/src/views/kanban/EquipmentOeeKanbanView.vue'), '<template></template>\n', 'utf8')
    writeFileSync(join(tg, 'frontend/src/views/sales/SalesOrdersView.vue'), '<template></template>\n', 'utf8')
    writeFileSync(join(tg, 'frontend/src/views/reports/WipReportView.vue'), '<template></template>\n', 'utf8')
    writeFileSync(join(tg, 'frontend/src/views/reports/HiddenReportView.vue'), '<template></template>\n', 'utf8')
    writeFileSync(join(tg, 'frontend/src/views/reports/OffReportView.vue'), '<template></template>\n', 'utf8')
    writeFileSync(
      join(tg, 'frontend/src/config/reportFeatures.js'),
      [
        'export const REPORT_CATALOG = [',
        "  { id: 'wip', viewFile: 'WipReportView.vue', title: '在制品报表', menu: true, enabled: true },",
        "  { id: 'hidden', viewFile: 'HiddenReportView.vue', title: '隐藏报表', menu: false, enabled: true },",
        "  { id: 'off', viewFile: 'OffReportView.vue', title: '下线报表', menu: true, enabled: false },",
        ']',
      ].join('\n'),
      'utf8',
    )
    const routerOk = [
      "import EquipmentOeeKanbanView from '../views/kanban/EquipmentOeeKanbanView.vue'",
      "import SalesOrdersView from '../views/sales/SalesOrdersView.vue'",
      'const kanbanRoutes = [',
      "  { path: 'equipment-oee', title: '设备OEE看板' },",
      ']',
      'path === \'equipment-oee\' ? EquipmentOeeKanbanView : null',
      'path: `kanban/${path}`,',
      '{',
      "  path: 'sales/orders',",
      '  component: SalesOrdersView,',
      "  meta: { title: '销售订单' },",
      '}',
    ].join('\n')
    const layoutOk = [
      "{ path: '/kanban/equipment-oee', title: '设备OEE看板', icon: Cpu },",
      "{ path: '/sales/orders', title: '销售订单', icon: ShoppingCart },",
    ].join('\n')
    writeFileSync(join(tg, 'frontend/src/router/index.js'), routerOk, 'utf8')
    writeFileSync(join(tg, 'frontend/src/layouts/AppLayout.vue'), layoutOk, 'utf8')
    const wired = verifyAddMenuOnTarget(tg, '看板管理菜单新增设备OEE看板', {
      synced_files: [
        'frontend/src/views/kanban/EquipmentOeeKanbanView.vue',
        'frontend/src/router/index.js',
        'frontend/src/layouts/AppLayout.vue',
      ],
    })
    assert(wired.ok, '看板已挂路由和侧栏时不得因报表目录未登记而失败')
    assert(!wired.detail.includes('reportFeatures'), '看板通过时不得提报表目录')
    const direct = verifyAddMenuOnTarget(tg, '销售菜单新增销售订单', {
      synced_files: ['frontend/src/views/sales/SalesOrdersView.vue'],
    })
    assert(direct.ok && direct.detail === '', '本轮没改路由和侧栏时，不打开工程里的旧文件')
    writeFileSync(
      join(tg, 'frontend/src/layouts/AppLayout.vue'),
      "{ path: '/sales/orders', title: '销售订单', icon: ShoppingCart },\n",
      'utf8',
    )
    const noMenu = verifyAddMenuOnTarget(tg, '看板管理菜单新增设备OEE看板', {
      synced_files: [
        'frontend/src/views/kanban/EquipmentOeeKanbanView.vue',
        'frontend/src/router/index.js',
        'frontend/src/layouts/AppLayout.vue',
      ],
    })
    assert(!noMenu.ok, '路由挂了但侧栏没有入口不得通过')
    assert(noMenu.detail.includes('侧栏'), '缺菜单时应指出侧栏')
    assert(!noMenu.detail.includes('reportFeatures'), '缺侧栏时不得改口去怪报表目录')
    writeFileSync(join(tg, 'frontend/src/router/index.js'), 'export default {}\n', 'utf8')
    writeFileSync(join(tg, 'frontend/src/layouts/AppLayout.vue'), layoutOk, 'utf8')
    const noRoute = verifyAddMenuOnTarget(tg, '看板管理菜单新增设备OEE看板', {
      synced_files: [
        'frontend/src/views/kanban/EquipmentOeeKanbanView.vue',
        'frontend/src/router/index.js',
        'frontend/src/layouts/AppLayout.vue',
      ],
    })
    assert(!noRoute.ok && noRoute.detail.includes('路由'), '侧栏有字但路由没引用页面不得通过')
    assert(!noRoute.detail.includes('reportFeatures'), '缺路由时不得改口去怪报表目录')
    writeFileSync(
      join(tg, 'frontend/src/router/index.js'),
      [
        "import MissingReportView from '../views/reports/MissingReportView.vue'",
        '{',
        "  path: 'reports/missing',",
        '  component: MissingReportView,',
        "  meta: { title: '停机报表' },",
        '}',
      ].join('\n'),
      'utf8',
    )
    writeFileSync(
      join(tg, 'frontend/src/layouts/AppLayout.vue'),
      "{ path: '/reports/missing', title: '停机报表', icon: Document },\n",
      'utf8',
    )
    const either = verifyAddMenuOnTarget(tg, '报表中心菜单新增停机报表', {
      synced_files: [
        'frontend/src/views/reports/MissingReportView.vue',
        'frontend/src/router/index.js',
        'frontend/src/layouts/AppLayout.vue',
      ],
    })
    assert(either.ok, '报表目录没有登记时，路由和侧栏已经挂上不得判未完成')
    assert(either.detail.includes('路由') || either.detail.includes('侧栏'), '通过时要写明是哪一路证据')
    writeFileSync(join(tg, 'frontend/src/router/index.js'), routerOk, 'utf8')
    writeFileSync(join(tg, 'frontend/src/layouts/AppLayout.vue'), layoutOk, 'utf8')
    const untouched = verifyAddMenuOnTarget(tg, '报表中心菜单新增停机报表', {
      synced_files: ['frontend/src/views/reports/MissingReportView.vue'],
    })
    assert(untouched.ok && untouched.detail === '', '本轮没改报表目录时，不拿磁盘上的旧目录判未完成')
    const missingReport = verifyAddMenuOnTarget(tg, '报表中心菜单新增停机报表', {
      synced_files: [
        'frontend/src/views/reports/MissingReportView.vue',
        'frontend/src/config/reportFeatures.js',
      ],
    })
    assert(!missingReport.ok, '本轮改了报表目录但没登记该页面仍须失败')
    assert(missingReport.detail.includes('reportFeatures.js'), '报表失败要指出 catalog 文件名')
    assert(!/[A-Za-z]:\\/.test(missingReport.detail), '失败原因只用文件名，不写本机绝对路径')
    const reportOk = verifyAddMenuOnTarget(tg, '报表中心菜单新增在制品报表', {
      synced_files: [
        'frontend/src/views/reports/WipReportView.vue',
        'frontend/src/config/reportFeatures.js',
      ],
    })
    assert(reportOk.ok && reportOk.detail.includes('报表目录'), '本轮改过的 catalog 已 menu:true 才通过')
    const hidden = verifyAddMenuOnTarget(tg, '报表中心菜单新增内部报表', {
      synced_files: [
        'frontend/src/views/reports/HiddenReportView.vue',
        'frontend/src/config/reportFeatures.js',
      ],
    })
    assert(!hidden.ok && hidden.detail.includes('menu:false'), 'menu:false 仍禁止假成功')
    const disabled = verifyAddMenuOnTarget(tg, '报表中心菜单新增停用报表', {
      synced_files: [
        'frontend/src/views/reports/OffReportView.vue',
        'frontend/src/config/reportFeatures.js',
      ],
    })
    assert(!disabled.ok && disabled.detail.includes('enabled:false'), 'enabled:false 的报表菜单不会出现')
    rmSync(root, { recursive: true, force: true })
    console.log('ok: menu registry follows the real sidebar')
  }

  // 交付审计：同步后目标盘须与沙箱一致；未挂载 APIRouter 禁止假完成
  {
    const root = mkdtempSync(join(tmpdir(), 'cc-audit-'))
    const sb = join(root, 'sandbox')
    const tg = join(root, 'target')
    mkdirSync(join(sb, 'backend/app/routers'), { recursive: true })
    mkdirSync(join(tg, 'backend/app/routers'), { recursive: true })
    mkdirSync(join(tg, 'backend/app'), { recursive: true })
    writeFileSync(
      join(sb, 'backend/app/routers/work_hours.py'),
      'from fastapi import APIRouter\nrouter = APIRouter()\n',
      'utf8',
    )
    // 目标未写入 → 指纹验尸失败
    const fpMiss = verifySyncedFingerprints(sb, tg, ['backend/app/routers/work_hours.py'])
    assert(!fpMiss.ok && fpMiss.missing.includes('backend/app/routers/work_hours.py'), '未落盘须失败')
    // 同步后指纹通过，但 main 未挂载 → 交付审计失败
    syncChangedToTarget(sb, tg, ['backend/app/routers/work_hours.py'])
    writeFileSync(join(tg, 'backend/app/main.py'), 'from fastapi import FastAPI\napp = FastAPI()\n', 'utf8')
    const fpOk = verifySyncedFingerprints(sb, tg, ['backend/app/routers/work_hours.py'])
    assert(fpOk.ok, '同步后指纹须通过')
    const bad = runDeliveryAudit({
      workspace: tg,
      sandbox: sb,
      requirement: '新增工时报表接口',
      synced_files: ['backend/app/routers/work_hours.py'],
    })
    assert(!bad.ok, '未挂载 router 交付审计须失败')
    assert(bad.detail.indexOf('交付审计未通过') >= 0, '须明示禁止假完成')
    assert(bad.checks.some((c) => c.name === 'api_mount' && !c.ok), '须含 api_mount 失败项')
    // 挂载后通过
    writeFileSync(
      join(tg, 'backend/app/main.py'),
      'from fastapi import FastAPI\nfrom backend.app.routers import work_hours\napp = FastAPI()\napp.include_router(work_hours.router)\n',
      'utf8',
    )
    const good = runDeliveryAudit({
      workspace: tg,
      sandbox: sb,
      requirement: '新增工时报表接口',
      synced_files: ['backend/app/routers/work_hours.py'],
    })
    assert(good.ok, '挂载后交付审计须通过')
    assert(good.completion?.percent === 100, '全部检查通过时完成度须为 100')
    const pageMiss = requirementEvidenceChecks('做一个带筛选的列表页面', [])
    assert(pageMiss.length === 1 && pageMiss[0]?.ok === false, '要页面但没同步页面文件不得算完成')
    const pageHit = requirementEvidenceChecks('做一个带筛选的列表页面', [
      'frontend/src/views/A.vue',
    ])
    assert(pageHit.length === 1 && pageHit[0]?.ok === true, '同步了页面文件才算页面需求有着落')
    assert(
      requirementEvidenceChecks('新增工时报表接口', ['backend/app/routers/work_hours.py']).length === 0,
      '没写页面/列表/筛选时不编造页面需求',
    )
    const deletedPage = requirementEvidenceChecks(
      '删除设备OEE看板的页面和菜单',
      ['frontend/src/router/index.js', 'frontend/src/layouts/AppLayout.vue'],
      ['frontend/src/views/kanban/EquipmentOeeKanbanView.vue'],
    )
    assert(
      deletedPage.length === 1 && deletedPage[0]?.ok === true,
      '删掉的页面文件就是这一轮的页面结果',
    )
    assert(
      requirementEvidenceChecks('删除设备OEE看板的页面和菜单', [
        'frontend/src/router/index.js',
      ]).length === 0,
      '删除任务没有新页面文件时，不得再记一条缺页面',
    )
    const skippedLive = await probeLiveAudit({
      workspace: tg,
      requirement: '新增工时报表接口',
      synced: ['backend/app/routers/work_hours.py'],
    })
    assert(skippedLive.length === 0, '自检模式不探测端口、不把没跑的检查写成通过')
    // 结论：文件已落盘时结果算完成；挂载没对上只写在审计行
    const auditJob = createJob({ workspace: tg, requirement: '审计结论' })
    patchJob(auditJob.id, {
      synced_files: ['backend/app/routers/work_hours.py'],
      last_synced_files: ['backend/app/routers/work_hours.py'],
      delivery_audit: bad,
      assistant_text: '## 说明方案\n**结论**\n已完成接口挂载\n',
    })
    setStatus(loadJob(auditJob.id)!, 'succeeded', '已同步 1 个文件')
    const body = formatChatConclusion(loadJob(auditJob.id)!)
    const resultLine = body.split('\n').find((line) => line.startsWith('结果：')) || ''
    assert(resultLine.indexOf('✅ 已完成') >= 0, '文件已落盘时结果须完成')
    assert(resultLine.indexOf('已同步 1 个文件') >= 0, '结果只写落盘数量')
    assert(resultLine.indexOf('交付审计未通过') < 0, '结果行不得搬审计失败')
    assert(body.indexOf('审计：❌ 未通过') >= 0, '审计失败须带未通过图标')
    assert(body.indexOf('完成度') >= 0, '失败也要写出完成度')
    assert(body.indexOf('结果：') < body.indexOf('审计：❌ 未通过'), '失败审计须紧挨在结果下方')
    assert(body.indexOf('审计：❌ 未通过') < body.indexOf('改动：'), '失败审计须在改动之前')
    const missed = createJob({ workspace: tg, requirement: '指纹没对上' })
    patchJob(missed.id, {
      synced_files: ['backend/app/routers/work_hours.py'],
      last_synced_files: ['backend/app/routers/work_hours.py'],
      delivery_audit: {
        ok: false,
        detail: '落盘不一致',
        checks: [{ name: 'synced_bytes', ok: false, detail: '落盘指纹与沙箱不一致' }],
        completion: { passed: 0, total: 1, percent: 0 },
      },
    })
    setStatus(loadJob(missed.id)!, 'failed', '落盘不一致')
    const missedBody = formatChatConclusion(loadJob(missed.id)!)
    assert(missedBody.indexOf('结果：❌ 未完成') >= 0, '指纹没对上时结果仍是未完成')
    assert(missedBody.indexOf('✅ 已完成') < 0, '没落盘不得显示已完成')
    const cancelled = createJob({ workspace: tg, requirement: '中途取消' })
    patchJob(cancelled.id, {
      synced_files: ['backend/app/routers/work_hours.py'],
      last_synced_files: ['backend/app/routers/work_hours.py'],
    })
    setStatus(loadJob(cancelled.id)!, 'cancelled', '用户取消')
    const cancelledBody = formatChatConclusion(loadJob(cancelled.id)!)
    assert(cancelledBody.indexOf('结果：⏹ 已取消') >= 0, '取消后不得改写成已完成')
    assert(cancelledBody.indexOf('✅ 已完成') < 0, '已取消的任务不得打绿勾')
    const passJob = createJob({ workspace: tg, requirement: '审计通过结论' })
    patchJob(passJob.id, {
      synced_files: ['backend/app/routers/work_hours.py'],
      last_synced_files: ['backend/app/routers/work_hours.py'],
      delivery_audit: good,
      assistant_text:
        '## 说明方案\n**结论**\n已完成\n\n**改动**\n' + '很长的改动说明。\n'.repeat(6),
    })
    setStatus(loadJob(passJob.id)!, 'succeeded', '已同步 1 个文件；交付审计通过')
    const passBody = formatChatConclusion(loadJob(passJob.id)!)
    const auditAt = passBody.indexOf('审计：✅ 通过')
    const resultAt = passBody.indexOf('结果：')
    const changeAt = passBody.indexOf('改动：')
    const verifyAt = passBody.indexOf('请你验收：')
    assert(resultAt >= 0 && auditAt > resultAt && changeAt > auditAt && verifyAt > changeAt, '审计通过须紧挨在结果下方、改动之前')
    assert(passBody.indexOf('完成度 100%') >= 0, '通过时须写出完成度')
    assert(passBody.indexOf('后端接口文件') >= 0, '落盘范围须按实际同步文件归类')
    assert(passBody.indexOf('后端接口挂载') >= 0, '挂载检查跑过才可写后端接口')
    assert(passBody.indexOf('前端页面文件') < 0, '未同步页面不得写成审计了前端页面')
    assert(passBody.indexOf('未做：') < 0, '审计只写查过的项，不列举没做的事')
    const honest = createJob({ workspace: tg, requirement: '如实审计' })
    const honestFiles = [
      'frontend/src/views/reports/EmployeeWorkHoursReportView.vue',
      'frontend/src/config/reportFeatures.js',
      'backend/tests/test_employee_work_hours_report.py',
    ]
    patchJob(honest.id, {
      synced_files: honestFiles,
      last_synced_files: honestFiles,
      delivery_audit: {
        ok: true,
        detail: '交付审计通过',
        checks: [
          { name: 'synced_bytes', ok: true, detail: '落盘指纹与沙箱一致' },
          { name: 'menu', ok: true, detail: '本机菜单验尸通过' },
        ],
      },
      assistant_text: '## 说明方案\n**结论**\n已完成\n\n**验收**\n1. 打开页面\n',
    })
    setStatus(loadJob(honest.id)!, 'succeeded', '已同步 3 个文件；交付审计通过')
    const honestBody = formatChatConclusion(loadJob(honest.id)!)
    assert(honestBody.indexOf('前端页面文件') >= 0, '有页面文件才写前端页面')
    assert(honestBody.indexOf('菜单配置') >= 0, '有配置文件才写菜单配置')
    assert(honestBody.indexOf('后端测试') >= 0, '有测试文件才写后端测试')
    assert(honestBody.indexOf('菜单注册') >= 0, '菜单检查跑过才写菜单注册')
    assert(honestBody.indexOf('后端接口挂载') < 0, '没跑挂载检查不得写后端接口挂载')
    assert(
      honestBody.indexOf('结果：') < honestBody.indexOf('审计：✅ 通过') &&
        honestBody.indexOf('审计：✅ 通过') < honestBody.indexOf('改动：'),
      '如实审计紧挨在结果下方',
    )
    assert(honestBody.indexOf('未做：') < 0, '如实审计也不列举没做的事')
    rmSync(root, { recursive: true, force: true })
    console.log('ok: delivery audit gate')
  }

  try {
    _resetHitlStoreForTests()
    _resetPendingConfirmForTests()
    saveConfig({
      listen: '127.0.0.1',
      port: 18797,
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

    {
      const j = createJob({ workspace, requirement: 'sse-replay-done' })
      patchJob(j.id, {
        transcript: [
          {
            id: 'tr-1',
            kind: 'assistant',
            at: new Date().toISOString(),
            text: '过程片段',
          },
        ],
      })
      setStatus(loadJob(j.id)!, 'succeeded', 'ok')
      appendEvent(loadJob(j.id)!, { type: 'done', status: 'succeeded', message: '已同步 1 个文件' })
      const ac = new AbortController()
      const killer = setTimeout(() => ac.abort(), 4000)
      const streamRes = await fetch(base + '/api/cursor-chat/jobs/' + encodeURIComponent(j.id) + '/stream', {
        signal: ac.signal,
      })
      const raw = await streamRes.text()
      clearTimeout(killer)
      const payloads: { type?: string; job_id?: string; transcript?: unknown[] }[] = []
      for (const block of raw.split('\n\n')) {
        const line = block.trim()
        if (!line.startsWith('data:')) continue
        try {
          payloads.push(JSON.parse(line.slice(5).trim()) as (typeof payloads)[number])
        } catch {
          /* skip */
        }
      }
      const dones = payloads.filter((p) => p.type === 'done')
      assert(
        dones.length >= 1 && dones.every((d) => d.job_id === j.id),
        'SSE 不得回放无 job_id 的账本 done，实际=' + JSON.stringify(dones),
      )
      const snap = payloads.find((p) => p.type === 'snapshot')
      assert(snap && Array.isArray(snap.transcript) && snap.transcript.length === 1, 'snapshot 须带回过程片段')
      const snapAt = payloads.findIndex((p) => p.type === 'snapshot')
      const termAt = payloads.findIndex((p) => p.type === 'done' && p.job_id === j.id)
      assert(snapAt >= 0 && termAt > snapAt, '封口 done 必须在 snapshot 之后')
      console.log('ok: sse replay skips ledger done')
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
      bindPendingJob(a.id, 'cch-old-from-a')
      const hitB = findPendingForCard({
        workspace,
        call_id: 'call-b',
        session_id: 'sess-b',
        requirement: '会话B改按钮',
      })
      assert(hitB && hitB.id === b.id, 'call-b 应对上自己的 waiting pending')
      assert(!hitB.job_id, 'B 卡不应拿到 A 的 job_id')
      const hitA = findPendingForCard({ workspace, call_id: 'call-a' })
      assert(hitA && hitA.job_id === 'cch-old-from-a', 'call-a 刷新后仍应对上已开工 job')
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
          '/api/cursor-chat/pending-latest?workspace=' +
          encodeURIComponent(workspace),
      )
      assert(resBare.status === 400, '仅 workspace 的 pending-latest 应 400，实际 ' + resBare.status)
      const resA = await fetch(
        base +
          '/api/cursor-chat/pending-latest?workspace=' +
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

    // begin 阻塞：call_id → jobs-by-call 对账
    {
      const wsCall = workspace + '-by-call'
      mkdirSync(wsCall, { recursive: true })
      const jc = createJob({
        workspace: wsCall,
        requirement: '停机报表',
        dsh_call_id: 'call-block-1',
      })
      setStatus(jc, 'running', '写码中')
      const hit = findLatestJobByCallId('call-block-1')
      assert(hit && hit.id === jc.id, 'findLatestJobByCallId 应对上 running job')
      assert(!findLatestJobByCallId('call-missing'), '未知 call_id 应空')
      const resCall = await fetch(
        base + '/api/cursor-chat/jobs-by-call?call_id=' + encodeURIComponent('call-block-1'),
      )
      const bodyCall = (await resCall.json()) as {
        ok?: boolean
        found?: boolean
        job_id?: string
        status?: string
        stream?: string
      }
      assert(resCall.status === 200 && bodyCall.ok && bodyCall.found, 'jobs-by-call 应 200 found')
      assert(bodyCall.job_id === jc.id, 'jobs-by-call 应对上 job_id')
      assert(bodyCall.status === 'running', 'jobs-by-call 应带回 running')
      assert(
        String(bodyCall.stream || '').includes('/stream'),
        'jobs-by-call 应带回 stream 路径',
      )
      const resMiss = await fetch(base + '/api/cursor-chat/jobs-by-call?call_id=nope')
      const bodyMiss = (await resMiss.json()) as { found?: boolean }
      assert(resMiss.status === 200 && bodyMiss.found === false, '未知 call 应 found:false')
      console.log('ok: jobs-by-call for blocking begin')
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
          action: 'cursor-chat.confirm',
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
        action: 'cursor-chat.confirm',
        workspace,
        requirement: '改一下标题',
        confirm_token: pending.id,
      })
      const res = await fetch(base + '/api/cursor-chat/confirm', {
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
      const res = await fetch(base + '/api/cursor-chat/confirm', {
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
          action: 'cursor-chat.confirm',
          workspace,
          requirement: '改一下标题',
        }),
      })
      assert(res.status === 400, 'HTTP confirm 无 confirm_token 应 400，实际 ' + res.status)
    }

    // 无 confirm_token：400
    {
      const issued = issue({
        action: 'cursor-chat.confirm',
        workspace,
        requirement: '改一下标题',
      })
      const res = await fetch(base + '/api/cursor-chat/confirm', {
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
        action: 'cursor-chat.confirm',
        workspace,
        requirement: '阶段 B 自检写码',
      })
      const res = await fetch(base + '/api/cursor-chat/confirm', {
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
        action: 'cursor-chat.confirm',
        workspace,
        requirement: '阶段 B 自检写码',
      })
      assert(!again.ok, 'nonce 不得复用')

      const terminal = await waitJobStatus(base, jobId, ['succeeded', 'failed', 'pending_review'])
      assert(terminal.status === 'succeeded', '默认应自动同步为 succeeded，实际 ' + terminal.status + ' ' + terminal.detail)
      assert(
        existsSync(join(workspace, '.cursor-chat-mock.md')),
        '自动同步后真工程应出现 mock 文件',
      )
      const body = readFileSync(join(workspace, '.cursor-chat-mock.md'), 'utf8')
      assert(body.includes('阶段 B 自检'), '同步内容应含诉求摘要')
      const jobRes = await fetch(base + '/api/cursor-chat/jobs/' + encodeURIComponent(jobId))
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
          base + '/api/cursor-chat/jobs/' + encodeURIComponent(jobId) + '/cancel',
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
        action: 'cursor-chat.confirm',
        workspace,
        requirement: contReq,
      })
      const res = await fetch(base + '/api/cursor-chat/confirm', {
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
      const jobRes = await fetch(base + '/api/cursor-chat/jobs/' + encodeURIComponent(childId))
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
        action: 'cursor-chat.confirm',
        workspace,
        requirement: '再改一下',
      })
      const res = await fetch(base + '/api/cursor-chat/confirm', {
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
      process.env.CURSOR_CHAT_AUTO_APPLY = '0'
      const reboot = await startServer()
      assert(reboot.ok, '重启服务失败: ' + reboot.detail)
      _resetHitlStoreForTests()
      const issued = issue({
        action: 'cursor-chat.confirm',
        workspace,
        requirement: '手工审同步',
      })
      const res = await fetch(base + '/api/cursor-chat/confirm', {
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
      const issued2 = issue({ action: 'cursor-chat.apply', job_id: mid })
      const applyRes = await fetch(base + '/api/cursor-chat/jobs/' + encodeURIComponent(mid) + '/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nonce: issued2.nonce, accept: files }),
      })
      const applyData = (await applyRes.json()) as { ok?: boolean }
      assert(applyRes.ok && applyData.ok, '手工 apply 应成功')
      await stopServer()
      delete process.env.CURSOR_CHAT_AUTO_APPLY
      const back = await startServer()
      assert(back.ok, '恢复 AUTO_APPLY 后重启失败: ' + back.detail)
    }

    console.log('[self-test] 阶段 B+C 全部通过（Mock Cursor + 自动同步 + 手工回退）')
    console.log('[self-test] port=', 18797)

    // 续改复用父沙箱（AUTO_APPLY 开）
    {
      _resetHitlStoreForTests()
      const issued = issue({
        action: 'cursor-chat.confirm',
        workspace,
        requirement: '复用沙箱续改',
      })
      const res = await fetch(base + '/api/cursor-chat/confirm', {
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
      const jobRes = await fetch(base + '/api/cursor-chat/jobs/' + encodeURIComponent(childId))
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
        const meta = await prepareSandboxSparse(home, 'cch-sparse-thicken', sparseWs, ['src/a.ts'])
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
        const parentMeta = await prepareSandboxSparse(parentHome, 'cch-parent-sb', reuseWs, ['src/a.ts'])
        writeFileSync(join(parentMeta.sandbox, 'src', 'only-in-parent.ts'), 'parent-only\n', 'utf8')
        writeFileSync(join(reuseWs, 'src', 'a.ts'), 'export const a = 2\n', 'utf8') // 真工程已更新
        const child = await prepareSandboxReuse(
          parentHome,
          'cch-child-reuse',
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
        const disabled = await prepareSandboxForJob({
          dataRoot: parentHome,
          jobId: 'cch-child-noreuse',
          targetWorkspace: reuseWs,
          writeScope: ['src/a.ts'],
          parentSandbox: parentMeta.sandbox,
          onProgress: () => undefined,
        })
        // 默认开启时仍是 reuse；临时关开关测回退
        process.env.CURSOR_CHAT_REUSE_PARENT = '0'
        const fallback = await prepareSandboxForJob({
          dataRoot: parentHome,
          jobId: 'cch-child-fallback',
          targetWorkspace: reuseWs,
          writeScope: ['src/a.ts'],
          parentSandbox: parentMeta.sandbox,
        })
        delete process.env.CURSOR_CHAT_REUSE_PARENT
        assert(fallback.mode === 'sparse', '开关关闭应回退 sparse，实际=' + fallback.mode)
        assert(!existsSync(join(fallback.sandbox, 'src/only-in-parent.ts')), '回退新建不应带父独有文件')
        assert(disabled.mode === 'reuse', '开启时应 reuse')
        console.log('[self-test] 父沙箱复用 + 开关回退 OK', child.copied_files, fallback.mode)
      } finally {
        delete process.env.CURSOR_CHAT_REUSE_PARENT
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
    if (prevHome === undefined) delete process.env.CURSOR_CHAT_HOME
    else process.env.CURSOR_CHAT_HOME = prevHome
    delete process.env.CURSOR_CHAT_PORT
    delete process.env.CURSOR_CHAT_MOCK
  }
}

main().catch((err) => {
  console.error('[self-test] 失败', err)
  process.exit(1)
})
