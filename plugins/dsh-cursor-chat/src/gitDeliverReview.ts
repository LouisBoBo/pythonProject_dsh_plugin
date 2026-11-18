/**
 * Git 交付 · 本批审码闸：只审勾选待提交文件，认引擎结构化 high_count / findings。
 * 不改写码主路径；引擎地址只读环境 / 本机既有约定，不进插件推送配置。
 * 后端开关：off | workbuddy | embedded（默认 embedded，公司网关审码）。
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './config.js'

export type GitDeliverReviewBackend = 'off' | 'workbuddy' | 'embedded'

/** 默认 embedded：公司网关本批审码；可用 CURSOR_CHAT_GIT_REVIEW_BACKEND=off 关闸 */
export function resolveGitDeliverReviewBackend(): GitDeliverReviewBackend {
  try {
    const v = loadConfig().gitDeliverReviewBackend
    if (v === 'off' || v === 'workbuddy' || v === 'embedded') return v
  } catch {
    /* ignore */
  }
  return 'embedded'
}

export type ReviewFinding = {
  file: string
  line?: number
  severity: string
  title: string
  description?: string
  fix_suggestion?: string
}

export type BatchReviewResult = {
  /** 审码 HTTP/引擎可达且拿到可判定结果 */
  ran: boolean
  /** 无高危可继续提交（含有中低危） */
  passed: boolean
  /** 引擎不可用或技术失败 → 闭门不提交 */
  unavailable: boolean
  high_count: number
  medium_count: number
  low_count: number
  report_id: string
  summary: string
  reply: string
  findings: ReviewFinding[]
  high_findings: ReviewFinding[]
  detail: string
  engine: string
  /** files_skipped=勾选路径读不到；空=引擎/配置故障。只认该字段，不扫 detail 正文。 */
  unavailable_code?: 'files_skipped' | ''
}

const HIGH_SEV = new Set(['critical', 'high', 'p0', 'blocker', 'block'])

export function isHighSeverity(raw: unknown): boolean {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
  return HIGH_SEV.has(s)
}

export function normalizeFindings(raw: unknown): ReviewFinding[] {
  if (!Array.isArray(raw)) return []
  const out: ReviewFinding[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    const file = String(o.file || o.path || '').trim()
    const title = String(o.title || o.message || '').trim()
    if (!file && !title) continue
    const lineN = Number(o.line)
    out.push({
      file: file || '(unknown)',
      line: Number.isFinite(lineN) && lineN > 0 ? lineN : undefined,
      severity: String(o.severity || '').trim().toLowerCase() || 'medium',
      title: title || '(untitled)',
      description: String(o.description || '').trim() || undefined,
      fix_suggestion: String(o.fix_suggestion || o.fix || '').trim() || undefined,
    })
  }
  return out
}

export function countHighFindings(findings: ReviewFinding[]): number {
  return findings.filter((f) => isHighSeverity(f.severity)).length
}

/** 从引擎 JSON 判定是否通过闸（只认权威字段，不扫 reply 正文） */
export function evaluateBatchReviewPayload(raw: Record<string, unknown>): {
  passed: boolean
  high_count: number
  medium_count: number
  low_count: number
  findings: ReviewFinding[]
  high_findings: ReviewFinding[]
} {
  const findings = normalizeFindings(raw.findings)
  const highFromFindings = countHighFindings(findings)
  const highField = Number(raw.high_count ?? raw.blocker_count ?? NaN)
  const high_count = Number.isFinite(highField) && highField >= 0 ? Math.max(highField, highFromFindings) : highFromFindings
  const medField = Number(raw.medium_count ?? NaN)
  const lowField = Number(raw.low_count ?? NaN)
  const medium_count = Number.isFinite(medField)
    ? medField
    : findings.filter((f) => {
        const s = f.severity
        return s === 'medium' || s === 'p1'
      }).length
  const low_count = Number.isFinite(lowField)
    ? lowField
    : findings.filter((f) => {
        const s = f.severity
        return s === 'low' || s === 'p2' || s === 'info'
      }).length
  const high_findings = findings.filter((f) => isHighSeverity(f.severity))
  // ok===true 且无高危 → 通过；ok===false 且有高危 → 不通过；ok===false 但无高危计数时仍以 high_count 为准
  const passed = high_count <= 0
  return { passed, high_count, medium_count, low_count, findings, high_findings }
}

function candidateEngineBases(): string[] {
  const out: string[] = []
  const push = (raw: string) => {
    const e = String(raw || '').trim().replace(/\/+$/, '')
    if (!e || out.includes(e)) return
    out.push(e)
  }
  push(process.env.WORKBUDDY_ENGINE || '')
  push(process.env.REMOTE_REVIEW_ENGINE || '')
  try {
    const p = join(homedir(), '.zhongruan', 'remote-review', 'config.json')
    if (existsSync(p)) {
      const j = JSON.parse(readFileSync(p, 'utf8')) as { engine?: string }
      push(String(j.engine || ''))
    }
  } catch {
    /* ignore */
  }
  // 常见本机引擎口（探测用；默认仍以 8000 为主）
  push('http://127.0.0.1:8000')
  push('http://127.0.0.1:8001')
  push('http://127.0.0.1:8787')
  return out
}

async function probeEngineBase(base: string): Promise<boolean> {
  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/api/code-review/status`, {
      signal: AbortSignal.timeout(2500),
    })
    if (!res.ok) return false
    const raw = await readJson(res)
    const lane = raw.code_review && typeof raw.code_review === 'object' ? (raw.code_review as Record<string, unknown>) : raw
    return raw.ok !== false && lane.ok !== false
  } catch {
    return false
  }
}

/** 解析可用引擎基址：环境 / remote-review 配置 / 本机探测；都失败则回落 8000（由调用方处理不可达） */
export async function resolveWorkbuddyEngineBase(): Promise<string> {
  const cands = candidateEngineBases()
  for (const base of cands) {
    if (await probeEngineBase(base)) return base
  }
  return cands[0] || 'http://127.0.0.1:8000'
}

/** 同步回落（仅测试/展示）；正式审码走 async resolve */
export function resolveWorkbuddyEngineBaseSync(): string {
  const env = String(process.env.WORKBUDDY_ENGINE || process.env.REMOTE_REVIEW_ENGINE || '').trim()
  if (env) return env.replace(/\/+$/, '')
  try {
    const p = join(homedir(), '.zhongruan', 'remote-review', 'config.json')
    if (existsSync(p)) {
      const j = JSON.parse(readFileSync(p, 'utf8')) as { engine?: string }
      const e = String(j.engine || '').trim()
      if (e) return e.replace(/\/+$/, '')
    }
  } catch {
    /* ignore */
  }
  return 'http://127.0.0.1:8000'
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text()
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return { ok: false, detail: text.slice(0, 400) || `HTTP ${res.status}` }
  }
}

/** 旁路包根目录：env → 插件内 vendor（市场包）→ 开发仓同级。 */
export function resolveBatchReviewRoot(): string {
  const env = String(process.env.DSH_BATCH_REVIEW_ROOT || '').trim()
  if (env && existsSync(join(env, 'src', 'dsh_batch_review'))) return env
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    // 市场/安装版：…/dsh-cursor-chat/lib → ../vendor/dsh-batch-review
    const bundled = join(here, '..', 'vendor', 'dsh-batch-review')
    if (existsSync(join(bundled, 'src', 'dsh_batch_review'))) return bundled
    // 开发仓：…/plugins/dsh-cursor-chat/lib → ../../dsh-batch-review
    const sibling = join(here, '..', '..', 'dsh-batch-review')
    if (existsSync(join(sibling, 'src', 'dsh_batch_review'))) return sibling
  } catch {
    /* ignore */
  }
  return ''
}

/**
 * 桌面宿主 PATH 常缺 nvm/homebrew/Frameworks；给审码子进程补常见 Python 目录。
 * Windows / macOS 路径分开，禁止混用。
 * macOS：Frameworks / Homebrew 须排在 /usr/bin 之前，避免命中无 PyYAML 的 CLT python3。
 */
export function batchReviewPythonPathEnv(): string {
  const home = process.env.HOME || process.env.USERPROFILE || ''
  const local = process.env.LOCALAPPDATA || ''
  const extras =
    process.platform === 'win32'
      ? [
          local ? join(local, 'Programs', 'Python', 'Python313') : '',
          local ? join(local, 'Programs', 'Python', 'Python312') : '',
          local ? join(local, 'Programs', 'Python', 'Python311') : '',
          'C:\\Python313',
          'C:\\Python312',
          'C:\\Python311',
        ]
      : [
          '/Library/Frameworks/Python.framework/Versions/Current/bin',
          '/Library/Frameworks/Python.framework/Versions/3.13/bin',
          '/Library/Frameworks/Python.framework/Versions/3.12/bin',
          '/Library/Frameworks/Python.framework/Versions/3.11/bin',
          '/opt/homebrew/bin',
          '/usr/local/bin',
          home ? join(home, '.local', 'bin') : '',
          home ? join(home, '.pyenv', 'shims') : '',
          '/usr/bin',
          '/bin',
        ]
  const cur = String(process.env.PATH || '')
  const parts = [...extras.filter(Boolean), ...cur.split(delimiter).filter(Boolean)]
  const seen = new Set<string>()
  return parts
    .filter((p) => {
      if (!p || seen.has(p)) return false
      seen.add(p)
      return true
    })
    .join(delimiter)
}

/** 旁路要求 Python≥3.10 + PyYAML；CLT /usr/bin/python3 常缺 yaml，须探针剔除。 */
function pythonUsableForBatchReview(bin: string, pathEnv: string): boolean {
  if (!bin) return false
  try {
    const r = spawnSync(
      bin,
      ['-c', 'import sys; assert sys.version_info >= (3, 10); import yaml'],
      {
        encoding: 'utf8',
        timeout: 8000,
        windowsHide: true,
        env: { ...process.env, PATH: pathEnv },
      },
    )
    return !r.error && r.status === 0
  } catch {
    return false
  }
}

function listWherePython(name: string, pathEnv: string): string[] {
  const n = String(name || '').trim()
  if (!n) return []
  if (isAbsolute(n) || /^[A-Za-z]:[\\/]/.test(n)) return existsSync(n) ? [n] : []
  if (process.platform === 'win32') {
    try {
      const out = execFileSync('where.exe', [n], {
        encoding: 'utf8',
        timeout: 4000,
        windowsHide: true,
        env: { ...process.env, PATH: pathEnv },
      })
      return out
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s && !/\\windowsapps\\/i.test(s))
        .map((line) => {
          if (existsSync(line)) return line
          if (existsSync(`${line}.exe`)) return `${line}.exe`
          return ''
        })
        .filter(Boolean)
    } catch {
      return []
    }
  }
  try {
    // type -a：列出 PATH 上全部 python3，便于跳过无依赖的 CLT
    const out = execFileSync('/usr/bin/env', ['bash', '-lc', 'type -a -p -- "$1" 2>/dev/null || true', 'bash', n], {
      encoding: 'utf8',
      timeout: 4000,
      env: { ...process.env, PATH: pathEnv },
    })
    return String(out || '')
      .split(/\n/)
      .map((s) => s.trim())
      .filter((s) => s && existsSync(s))
  } catch {
    return []
  }
}

/**
 * 解析本批审码子进程用的 Python 可执行文件。
 * - 认 DSH_BATCH_REVIEW_PYTHON / PYTHON（存在且探针通过才用）
 * - macOS/Linux：优先 Frameworks/Homebrew 的 python3；禁止默认裸名 python（ENOENT）
 * - Windows：优先 python.exe（跳过 WindowsApps 商店占位）
 * - 须 Python≥3.10 且已装 PyYAML（旁路依赖）；否则返回空串
 */
export function resolveBatchReviewPython(): string {
  const pathEnv = batchReviewPythonPathEnv()
  const fromEnv = String(process.env.DSH_BATCH_REVIEW_PYTHON || process.env.PYTHON || '').trim()
  const candidates: string[] = []
  const push = (p: string) => {
    const x = String(p || '').trim()
    if (!x || candidates.includes(x)) return
    candidates.push(x)
  }
  push(fromEnv)
  if (process.platform === 'win32') {
    for (const name of ['python', 'python3']) {
      for (const hit of listWherePython(name, pathEnv)) push(hit)
    }
    const local = process.env.LOCALAPPDATA || ''
    for (const c of [
      local ? join(local, 'Programs', 'Python', 'Python313', 'python.exe') : '',
      local ? join(local, 'Programs', 'Python', 'Python312', 'python.exe') : '',
      local ? join(local, 'Programs', 'Python', 'Python311', 'python.exe') : '',
      'C:\\Python313\\python.exe',
      'C:\\Python312\\python.exe',
      'C:\\Python311\\python.exe',
    ]) {
      push(c)
    }
  } else {
    // 绝对路径优先于 PATH 上的 /usr/bin/python3（CLT 常无 yaml）
    for (const c of [
      '/Library/Frameworks/Python.framework/Versions/Current/bin/python3',
      '/Library/Frameworks/Python.framework/Versions/3.13/bin/python3',
      '/Library/Frameworks/Python.framework/Versions/3.12/bin/python3',
      '/Library/Frameworks/Python.framework/Versions/3.11/bin/python3',
      '/opt/homebrew/bin/python3',
      '/usr/local/bin/python3',
    ]) {
      push(c)
    }
    for (const name of ['python3', 'python']) {
      for (const hit of listWherePython(name, pathEnv)) push(hit)
    }
    push('/usr/bin/python3')
  }
  for (const c of candidates) {
    if (!existsSync(c) && !(isAbsolute(c) || /^[A-Za-z]:[\\/]/.test(c))) {
      // 裸名：再 where 一次
      for (const hit of listWherePython(c, pathEnv)) {
        if (pythonUsableForBatchReview(hit, pathEnv)) return hit
      }
      continue
    }
    if (existsSync(c) && pythonUsableForBatchReview(c, pathEnv)) return c
  }
  return ''
}

function runEmbeddedBatchReview(opts: {
  workspace: string
  files: string[]
  focus?: string
  onProgress?: (done: number, total: number) => void
}): Promise<BatchReviewResult> {
  const empty = (detail: string): BatchReviewResult => ({
    ran: false,
    passed: false,
    unavailable: true,
    high_count: 0,
    medium_count: 0,
    low_count: 0,
    report_id: '',
    summary: '',
    reply: '',
    findings: [],
    high_findings: [],
    detail,
    engine: 'embedded',
    unavailable_code: '',
  })
  const root = resolveBatchReviewRoot()
  if (!root) {
    return Promise.resolve(
      empty(
        '未找到审码旁路 dsh-batch-review（插件包应含 vendor/；或设 DSH_BATCH_REVIEW_ROOT）',
      ),
    )
  }
  if (!opts.workspace || !opts.files.length) {
    return Promise.resolve(empty(opts.workspace ? '本批无可审文件' : '缺少工作区路径'))
  }
  const pathEnv = batchReviewPythonPathEnv()
  const py = resolveBatchReviewPython()
  if (!py) {
    return Promise.resolve(
      empty(
        process.platform === 'win32'
          ? '未找到可用 Python（需 ≥3.10 且已装 PyYAML；或设 DSH_BATCH_REVIEW_PYTHON 指向该解释器）'
          : '未找到可用 python3（需 ≥3.10 且已装 PyYAML；macOS 勿用无依赖的 CLT /usr/bin/python3；或设 DSH_BATCH_REVIEW_PYTHON）',
      ),
    )
  }
  const srcPath = join(root, 'src')
  const args = [
    '-m',
    'dsh_batch_review',
    'review',
    '--workspace',
    opts.workspace,
    '--files',
    opts.files.join(','),
  ]
  // focus 仅短提示；禁止把整段 commit message 当指令注入
  const focus = String(opts.focus || '')
    .trim()
    .replace(/\x00/g, '')
    .slice(0, 120)
  if (focus && !/ignore previous|system prompt|跳过审码|忽略以上/i.test(focus)) {
    args.push('--focus', focus)
  }
  // 最小环境：避免把 CURSOR_API_KEY 等一并灌进审码子进程；PATH 用补齐后的，避免桌面宿主缺 python3
  // macOS 混合布局：部分壳把 dsh-home 落在 ~/AppData/Local；未设 LOCALAPPDATA 时补上，便于读 .credentials.yaml
  const homeDir = process.env.HOME || homedir()
  const macLocalApp = join(homeDir, 'AppData', 'Local')
  const localAppData =
    process.env.LOCALAPPDATA ||
    (process.platform === 'darwin' && existsSync(macLocalApp) ? macLocalApp : undefined)
  const dshHome =
    process.env.DSH_HOME ||
    (localAppData && existsSync(join(localAppData, 'ZR_DSH', 'dsh-home'))
      ? join(localAppData, 'ZR_DSH', 'dsh-home')
      : undefined)
  const childEnv: NodeJS.ProcessEnv = {
    PATH: pathEnv,
    SYSTEMROOT: process.env.SYSTEMROOT,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    LANG: process.env.LANG,
    PYTHONPATH: srcPath,
    PYTHONIOENCODING: 'utf-8',
    DSH_HOME: dshHome,
    LOCALAPPDATA: localAppData,
    APPDATA: process.env.APPDATA,
    HOME: homeDir,
    USERPROFILE: process.env.USERPROFILE,
    ZR_GATEWAY_TOKEN: process.env.ZR_GATEWAY_TOKEN,
    ZR_MODEL_GATEWAY_URL: process.env.ZR_MODEL_GATEWAY_URL,
    DSH_BATCH_REVIEW_MODEL: process.env.DSH_BATCH_REVIEW_MODEL,
    DSH_BATCH_REVIEW_GATEWAY_HOSTS: process.env.DSH_BATCH_REVIEW_GATEWAY_HOSTS,
    DSH_BATCH_REVIEW_ALLOW_ANY_GATEWAY: process.env.DSH_BATCH_REVIEW_ALLOW_ANY_GATEWAY,
    WORKBUDDY_CONFIG: process.env.WORKBUDDY_CONFIG,
    DSH_WORKBUDDY_CONFIG: process.env.DSH_WORKBUDDY_CONFIG,
  }
  return new Promise((resolve) => {
    const child = spawn(py, args, {
      env: childEnv,
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let progressBuf = ''
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      resolve(empty('embedded 审码超时'))
    }, 900_000)
    child.stdout?.on('data', (b) => {
      stdout += String(b || '')
    })
    child.stderr?.on('data', (b) => {
      const chunk = String(b || '')
      stderr += chunk
      if (!opts.onProgress) return
      progressBuf += chunk
      const lines = progressBuf.split(/\r?\n/)
      progressBuf = lines.pop() || ''
      for (const line of lines) {
        const m = /^DSH_REVIEW_PROGRESS\t(\d+)\t(\d+)$/.exec(line.trim())
        if (!m) continue
        const done = Number(m[1])
        const total = Number(m[2])
        if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) continue
        try {
          opts.onProgress(done, total)
        } catch {
          /* 进度失败不打断审码 */
        }
      }
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve(empty(`embedded 启动失败：${String(err?.message || err).slice(0, 160)}`))
    })
    child.on('close', () => {
      clearTimeout(timer)
      let raw: Record<string, unknown> = {}
      try {
        raw = JSON.parse(stdout.trim() || '{}') as Record<string, unknown>
      } catch {
        // 不回显 stderr/stdout 原文，避免敏感信息进进度卡
        void stderr
        resolve(empty('embedded 输出无法解析（审码子进程未返回合法 JSON）'))
        return
      }
      if (raw.unavailable === true || raw.ran === false) {
        const missed = raw.unavailable_code === 'files_skipped'
        resolve({
          ...empty(String(raw.detail || raw.reply || 'embedded 审码不可用').slice(0, 300)),
          unavailable_code: missed ? 'files_skipped' : '',
        })
        return
      }
      const judged = evaluateBatchReviewPayload(raw)
      resolve({
        ran: true,
        passed: judged.passed,
        unavailable: false,
        high_count: judged.high_count,
        medium_count: judged.medium_count,
        low_count: judged.low_count,
        report_id: String(raw.report_id || '').trim(),
        summary: String(raw.summary || '').trim(),
        reply: String(raw.reply || '').trim(),
        findings: judged.findings,
        high_findings: judged.high_findings,
        detail: String(raw.detail || '').trim() || (judged.passed ? '本批审码通过' : '存在高危'),
        engine: 'embedded',
      })
    })
  })
}

/**
 * 对本批相对路径跑审码。files 为空则 unavailable。
 * 注意：引擎在有高危时可能 HTTP 400 但仍返回 findings — 须解析 body。
 */
export async function runBatchCodeReview(opts: {
  workspace: string
  files: string[]
  focus?: string
  /** 已审文件数 / 本批文件数。只用于进度条文案。 */
  onProgress?: (done: number, total: number) => void
}): Promise<BatchReviewResult> {
  const backend = resolveGitDeliverReviewBackend()
  const workspace = String(opts.workspace || '').trim()
  const files = (opts.files || []).map((f) => String(f || '').trim().replace(/\\/g, '/')).filter(Boolean)
  // 关闸：不调用任何引擎，视为本批通过（仅 git_deliver；写码主路径不走此函数）
  if (backend === 'off') {
    return {
      ran: true,
      passed: true,
      unavailable: false,
      high_count: 0,
      medium_count: 0,
      low_count: 0,
      report_id: '',
      summary: '审码闸已关闭',
      reply: '',
      findings: [],
      high_findings: [],
      detail: '本批审码闸已关闭（gitDeliverReviewBackend=off），跳过审码',
      engine: 'off',
    }
  }
  if (backend === 'embedded') {
    return runEmbeddedBatchReview({
      workspace,
      files,
      focus: opts.focus,
      onProgress: opts.onProgress,
    })
  }
  const engine = await resolveWorkbuddyEngineBase()
  const empty = (detail: string, unavailable = true): BatchReviewResult => ({
    ran: false,
    passed: false,
    unavailable,
    high_count: 0,
    medium_count: 0,
    low_count: 0,
    report_id: '',
    summary: '',
    reply: '',
    findings: [],
    high_findings: [],
    detail,
    engine,
  })
  if (!workspace) return empty('缺少工作区路径')
  if (!files.length) return empty('本批无可审文件', true)

  try {
    const listRes = await fetch(`${engine}/api/code-review/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ local_path: workspace, scope: '' }),
      signal: AbortSignal.timeout(120_000),
    })
    const listJson = await readJson(listRes)
    const ticket = String(listJson.path_ticket || '').trim()
    if (!listRes.ok || !ticket) {
      return empty(
        String(listJson.detail || listJson.reply || `审码 list 失败（HTTP ${listRes.status}）`),
        true,
      )
    }

    const runRes = await fetch(`${engine}/api/code-review/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        local_path: workspace,
        scope: '',
        files,
        focus:
          String(opts.focus || '').trim() ||
          `Git 交付本批审码闸：仅审待提交 ${files.length} 个文件，有高危须挡提交`,
        path_ticket: ticket,
      }),
      signal: AbortSignal.timeout(900_000),
    })
    const runJson = await readJson(runRes)
    const hasReport =
      Boolean(String(runJson.report_id || runJson.id || '').trim()) ||
      Boolean(String(runJson.reply || '').trim()) ||
      Array.isArray(runJson.findings)

    // 插件未开 / 路径闸失败等：无 findings 且无报告 → 不可用
    if (!hasReport && !runRes.ok) {
      return empty(String(runJson.detail || runJson.reply || `审码 run 失败（HTTP ${runRes.status}）`), true)
    }

    const judged = evaluateBatchReviewPayload(runJson)
    const report_id = String(runJson.report_id || runJson.id || '').trim()
    const summary = String(runJson.summary || '').trim()
    const reply = String(runJson.reply || '').trim()
    const detail = judged.passed
      ? judged.high_count === 0
        ? `本批审码通过（高危 0 · 中危 ${judged.medium_count} · 低危 ${judged.low_count}）`
        : '本批审码通过'
      : String(runJson.detail || '').trim() ||
        `存在 ${judged.high_count} 处高危，审核不通过`

    return {
      ran: true,
      passed: judged.passed,
      unavailable: false,
      high_count: judged.high_count,
      medium_count: judged.medium_count,
      low_count: judged.low_count,
      report_id,
      summary,
      reply,
      findings: judged.findings,
      high_findings: judged.high_findings,
      detail,
      engine,
    }
  } catch (err) {
    return empty(`审码引擎不可达 ${engine}：${String((err as Error)?.message || err).slice(0, 200)}`, true)
  }
}

export function formatHighFindingsForFix(high: ReviewFinding[], max = 12): string {
  const lines: string[] = [
    '【Git 交付审码闸】请仅修复下列高危问题，不要扩大改动范围，不要 git commit/push。',
    '',
  ]
  for (const f of high.slice(0, max)) {
    const loc = f.line ? `${f.file}:${f.line}` : f.file
    lines.push(`- [${f.severity}] ${loc} — ${f.title}`)
    if (f.description) lines.push(`  问题：${f.description.slice(0, 400)}`)
    if (f.fix_suggestion) lines.push(`  建议：${f.fix_suggestion.slice(0, 400)}`)
  }
  if (high.length > max) lines.push(`- …另有 ${high.length - max} 条高危未列出，请一并处理。`)
  lines.push('')
  lines.push('修完后停止；由交付闸再审本批文件。')
  return lines.join('\n')
}

/** 落盘用的本批审码报告。引擎已给出「代码审核汇总报告」时原样落盘。 */
export function renderBatchReviewMarkdown(
  review: BatchReviewResult,
  meta?: { jobId?: string; files?: string[] },
): string {
  const official = String(review.reply || '').trim()
  if (official.includes('代码审核汇总报告') && official.includes('审核人：')) {
    return official.endsWith('\n') ? official : `${official}\n`
  }
  const lines: string[] = [
    '#### 本批审码报告',
    '',
    `- 结果：${review.passed ? '无高危，已放行' : review.unavailable ? '未完成' : '存在高危，未放行'}`,
    `- 高危 ${review.high_count} · 中危 ${review.medium_count} · 低危 ${review.low_count}`,
  ]
  if (review.detail) lines.push(`- 说明：${review.detail}`)
  if (review.summary) lines.push(`- 摘要：${review.summary}`)
  if (meta?.jobId) lines.push(`- 任务：\`${meta.jobId}\``)
  const files = (meta?.files || []).filter(Boolean)
  if (files.length) {
    lines.push('', '#### 本批文件', '')
    for (const f of files.slice(0, 40)) lines.push(`- \`${f}\``)
  }
  const findings = review.findings || []
  lines.push('', '## 发现', '')
  if (!findings.length) {
    lines.push('无结构化条目。')
  } else {
    for (const f of findings.slice(0, 40)) {
      const loc = f.line ? `${f.file}:${f.line}` : f.file
      lines.push(`#### [${f.severity}] ${f.title}`)
      lines.push('')
      lines.push(`- 位置：\`${loc}\``)
      if (f.description) lines.push(`- 说明：${f.description}`)
      if (f.fix_suggestion) lines.push(`- 建议：${f.fix_suggestion}`)
      lines.push('')
    }
  }
  lines.push('---', '', '本文件由写码插件在 Git 交付时生成，供本轮结论预览；未纳入本次 commit。')
  return lines.join('\n') + '\n'
}

/**
 * 把审码报告写到工作区 `.dsh-cursor-chat/reviews/`，返回相对路径供右侧预览。
 * 路径只允许插件自己的文件名，禁止把用户字符串拼进目录。
 */
export function writeBatchReviewReport(opts: {
  workspace: string
  jobId: string
  review: BatchReviewResult
  files?: string[]
}): { ok: true; rel: string } | { ok: false; detail: string } {
  const root = String(opts.workspace || '').trim()
  if (!root || !existsSync(root)) return { ok: false, detail: '工作区不存在，未写审码报告' }
  const safeId = String(opts.jobId || 'review').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48) || 'review'
  const rel = `.dsh-cursor-chat/reviews/${safeId}-审码报告.md`
  const abs = join(root, '.dsh-cursor-chat', 'reviews', `${safeId}-审码报告.md`)
  try {
    mkdirSync(join(root, '.dsh-cursor-chat', 'reviews'), { recursive: true })
    writeFileSync(
      abs,
      renderBatchReviewMarkdown(opts.review, { jobId: opts.jobId, files: opts.files }),
      'utf8',
    )
  } catch (err) {
    return { ok: false, detail: `审码报告落盘失败：${String(err).slice(0, 120)}` }
  }
  return { ok: true, rel }
}

export function buildPrReviewComment(review: BatchReviewResult): string {
  const head = [
    '## DSH Git 交付 · 本批审码报告',
    '',
    `- 结果：${review.passed ? '✅ 无高危，已放行提交' : '❌ 存在高危'}`,
    `- 高危 ${review.high_count} · 中危 ${review.medium_count} · 低危 ${review.low_count}`,
  ]
  if (review.report_id) head.push(`- 报告 ID：\`${review.report_id}\``)
  if (review.summary) {
    head.push('', review.summary)
  }
  const body = (review.reply || '').trim()
  // PR 评论长度保护
  const clipped = body.length > 50_000 ? body.slice(0, 50_000) + '\n\n…(截断)' : body
  if (clipped) {
    head.push('', '---', '', clipped)
  }
  return head.join('\n')
}
