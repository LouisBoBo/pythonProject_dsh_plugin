/**
 * 不改文件的开发需求，按 Cursor IDE 在真实项目里做：启动/重启、测试、装依赖、看日志、查环境、排障。
 * 一旦要改代码，整轮仍走写码沙箱，避免直接改真实项目。
 */

import { isDeleteIntent } from './deleteIntent.js'

export type WorkKind = 'code' | 'ops'

function compact(message: string): string {
  return String(message || '').replace(/\s+/g, '')
}

/** 去掉「不要改代码」这类否定，避免把约束句当成改码诉求 */
function withoutNegatedEdits(message: string): string {
  return compact(message).replace(
    /不要改代码|不改代码|别改代码|无需改代码|不要改文件|别改文件|不要改任何文件/g,
    '',
  )
}

export function looksLikeCodeChange(message: string): boolean {
  const t = withoutNegatedEdits(message)
  if (!t) return false
  if (/(新增|增加|添加|新建|修改|修复|实现|重构|优化)/.test(t)) return true
  if (/(改|修)(一下|下|成|为|掉|这个|页面|接口|代码|样式|按钮|字段|文案|bug)/i.test(t)) return true
  if (/(删除|去掉|移除|下线)/.test(t) && /(页面|菜单|接口|文件|代码|字段|路由|函数|组件)/.test(t)) {
    return true
  }
  if (/(新增一列|加一列|增加一列|多一列|加列|增列)/.test(t)) return true
  return false
}

/**
 * 不改代码、Cursor IDE 会在真实项目终端里做的事。
 * 改页面、修 bug 由 looksLikeCodeChange 先拦住，不会进这里。
 */
export function looksLikeDevOps(message: string): boolean {
  const t = compact(message)
  if (!t) return false
  if (/(重启|重新启动|重开|拉起|启动).{0,8}(前端|后端|服务|前后端|项目|dev)/i.test(t)) return true
  if (/(前端|后端|前后端|服务).{0,6}(重启|重新启动|重开|拉起)/.test(t)) return true
  if (/^(请|帮我|帮忙|麻烦)?(把)?(前端|后端|前后端|服务|项目)?(重启|重新启动|重开|启动|拉起)(一下|下|前后端|前端|后端|服务|项目)?$/.test(t)) {
    return true
  }
  if (/把(项目|服务|前后端|前端|后端)跑起来/.test(t)) return true
  if (/(跑|执行|运行).{0,4}(测试|单测)/.test(t)) return true
  if (opsLooksLikeInstall(t)) return true
  if (/(看|查|查看|读).{0,6}日志/.test(t)) return true
  if (/(查|看|检查).{0,4}环境/.test(t)) return true
  if (opsLooksLikeTroubleshoot(t)) return true
  return false
}

/** 装依赖口令（已 compact）。勿把「安装一个报表」等写码句收进来。 */
function opsLooksLikeInstall(t: string): boolean {
  if (/(安装|装).{0,6}(依赖|deps|packages?|包)/i.test(t)) return true
  if (/依赖.{0,6}(安装|装上|装一下|没装|缺失|不全)/.test(t)) return true
  if (/npminstall|npmi|pnpminstall|pnpmi|yarninstall|yarnadd|pipinstall|uvsync|poetryinstall/i.test(t)) {
    return true
  }
  if (
    /(requirements\.txt|pyproject\.toml|package-lock|pnpm-lock|yarn\.lock)/i.test(t) &&
    /(安装|装|install)/i.test(t)
  ) {
    return true
  }
  return false
}

/**
 * 排障/诊断口令（已 compact）。
 * 「排查并修复」仍由 looksLikeCodeChange 先拦；此处只收不改代码的定位。
 */
function opsLooksLikeTroubleshoot(t: string): boolean {
  if (/排障/.test(t)) return true
  if (/排查/.test(t)) return true
  if (/(定位|诊断).{0,6}(问题|报错|错误|异常|原因)/.test(t)) return true
  if (/为什么.{0,10}(报错|失败|起不来|挂了|不行)/.test(t)) return true
  if (/(启动|重启).{0,8}(失败|报错|错误|异常|不了)/.test(t)) return true
  if (/起不来/.test(t)) return true
  return false
}

/**
 * 写码续做继承父任务时用。
 * 启动服务那一轮的 cwd 是真实项目，不能当父沙箱，也不能 resume 那个 Agent。
 */
export function codingParentLink(parent: {
  work_kind?: string | null
  sandbox_path?: string | null
  agent_id?: string | null
  workspace?: string | null
} | null | undefined): { parentSandbox: string | null; resumeAgentId: string | null } {
  if (!parent || parent.work_kind === 'ops') {
    return { parentSandbox: null, resumeAgentId: null }
  }
  const sandbox = String(parent.sandbox_path || '').trim()
  const workspace = String(parent.workspace || '').trim()
  const same = sandbox && workspace && sandbox.replace(/[\\/]+$/, '').toLowerCase() === workspace.replace(/[\\/]+$/, '').toLowerCase()
  if (same) return { parentSandbox: null, resumeAgentId: null }
  return {
    parentSandbox: sandbox || null,
    resumeAgentId: parent.agent_id || null,
  }
}

/**
 * 本轮合同写明只出清单、不改文件。零 diff 是这一轮的正常结果，不是写码空跑。
 * 必须同时出现「不改文件」和「清单」，避免把普通删除误放行。
 */
export function isInventoryOnlyRequirement(message: string): boolean {
  if (isDeleteIntent(message)) return false
  const t = compact(message)
  if (!t.includes('清单')) return false
  if (/不要修改任何文件(?!以外)/.test(t)) return true
  if (/不要改动任何文件(?!以外)/.test(t)) return true
  if (t.includes('本轮只做定位和清单') || t.includes('只做定位和清单输出')) return true
  return false
}

export function classifyWork(message: string): WorkKind {
  if (looksLikeCodeChange(message)) return 'code'
  if (looksLikeDevOps(message)) return 'ops'
  return 'code'
}

/** 重启/启动要核对哪一侧端口。没点名时两侧都看，识别不到端口就不作为失败条件。 */
export function opsPortExpectation(message: string): { frontend: boolean; backend: boolean } {
  const t = compact(message)
  const both = /前后端/.test(t) || (/前端/.test(t) && /后端/.test(t))
  const frontend = both || /前端/.test(t)
  const backend = both || /后端/.test(t)
  if (!frontend && !backend) return { frontend: true, backend: true }
  return { frontend, backend }
}

/**
 * 用户要「把服务拉起来」时走项目命令重启。
 * 诊断口令（启动失败 / 排查 / 起不来）不得进这里，否则会误杀排障。
 */
export function opsWantsRunningService(message: string): boolean {
  const t = compact(message)
  if (!t) return false
  if (/(排障|排查|为什么|根因)/.test(t)) return false
  if (/(启动|重启).{0,8}(失败|报错|错误|异常|不了)/.test(t)) return false
  if (/起不来/.test(t) && !/(重启|重新启动|重开|拉起|跑起来)/.test(t)) return false
  if (/(重启|重新启动|重开|拉起)/.test(t)) return true
  // 「把项目/服务跑起来」与启动同义，须走项目命令拉起，不能再交给 Cursor 搜仓库
  if (/(把|让)?(项目|服务|前后端|前端|后端)?跑起来/.test(t)) return true
  if (
    /^(请|帮我|帮忙|麻烦)?(把)?(前端|后端|前后端|服务|项目)?(重启|重新启动|重开|启动|拉起)(一下|下|前后端|前端|后端|服务|项目)?$/.test(
      t,
    )
  ) {
    return true
  }
  // 「启动」须带服务对象；失败诊断已在上方排除
  if (/(启动).{0,8}(前端|后端|服务|前后端|项目|dev)/i.test(t)) return true
  if (/(前端|后端|前后端|服务|项目).{0,6}启动/.test(t)) return true
  return false
}

/**
 * 已判定为 ops 后的细类。只影响提示词、进度文案和验收兜底。
 * 不改变 code/ops 分流；带改码的句子仍由 looksLikeCodeChange 先拦住。
 */
export type OpsTerminalKind = 'restart' | 'test' | 'install' | 'logs' | 'env' | 'troubleshoot' | 'generic'

export function classifyOpsTerminal(message: string): OpsTerminalKind {
  const t = compact(message)
  if (!t) return 'generic'
  if (opsWantsRunningService(t)) return 'restart'
  if (/(跑|执行|运行).{0,4}(测试|单测)/.test(t) || /pytest|vitest|jest|unittest/i.test(t)) return 'test'
  if (opsLooksLikeInstall(t)) return 'install'
  if (/(看|查|查看|读).{0,6}日志/.test(t)) return 'logs'
  if (/(查|看|检查).{0,4}环境/.test(t)) return 'env'
  if (opsLooksLikeTroubleshoot(t)) return 'troubleshoot'
  return 'generic'
}

export function opsRunningStatus(kind: OpsTerminalKind): string {
  switch (kind) {
    case 'restart':
      return '正在按项目命令重启，不改代码…'
    case 'test':
      return '正在项目终端跑测试，不改代码…'
    case 'install':
      return '正在项目终端安装依赖，不改代码…'
    case 'logs':
      return '正在项目终端查看日志，不改代码…'
    case 'env':
      return '正在项目终端检查环境，不改代码…'
    case 'troubleshoot':
      return '正在项目终端排障，不改代码…'
    default:
      return '正在项目终端处理，不改代码…'
  }
}

/** 从进度/详情里抠已在听的端口；只认 1～65535。 */
export function parseOpsListenPorts(text: string): { frontend?: number; backend?: number } {
  const t = String(text || '')
  const out: { frontend?: number; backend?: number } = {}
  const take = (side: 'frontend' | 'backend', re: RegExp) => {
    if (out[side]) return
    const m = t.match(re)
    if (!m) return
    const n = Number(m[1])
    if (Number.isInteger(n) && n >= 1 && n <= 65535) out[side] = n
  }
  // 允许 app.main:app 一类模块名里的点号；只在同一行内找「:端口」
  take('frontend', /前端[^\n]{0,80}?:(\d{2,5})/)
  take('frontend', /前端\s+(\d{2,5})\s*(?:已在听|在听|未监听)/)
  take('backend', /后端[^\n]{0,80}?:(\d{2,5})/)
  take('backend', /后端\s+(\d{2,5})\s*(?:已在听|在听|未监听)/)
  return out
}

/**
 * 重启验收：有端口就写成「标签 + 本机 URL」行，结论壳会收成可点击链接（非纯文本）。
 * 没有端口才退回笼统文案。
 */
export function opsRestartVerifySteps(ports: { frontend?: number; backend?: number }): string[] {
  const steps: string[] = []
  if (ports.frontend || ports.backend) {
    if (ports.frontend) steps.push(`前端：http://127.0.0.1:${ports.frontend}/`)
    if (ports.backend) {
      steps.push(`后端：http://127.0.0.1:${ports.backend}/docs`)
      steps.push(`健康检查：http://127.0.0.1:${ports.backend}/api/health`)
    }
  } else {
    steps.push('打开原来的前端地址，确认页面能打开')
    steps.push('打开后端健康检查或接口文档，确认仍在原端口')
  }
  steps.push('若没起来，把项目 .dev-logs 里的报错发回本对话')
  return steps
}

export function opsVerifyDefaults(kind: OpsTerminalKind): string[] {
  switch (kind) {
    case 'restart':
      return opsRestartVerifySteps({})
    case 'test':
      return [
        '对照进度卡里的测试命令与退出码',
        '失败时把失败用例名和报错贴回本对话',
        '需要修代码时另说具体要改什么',
      ]
    case 'install':
      return [
        '对照结论里的安装目录、包管理器命令与退出结果',
        '需要时再单独说启动或重启服务验证',
        '若 lock 有变动或不该改的文件被碰了，把现象发回本对话',
      ]
    case 'logs':
      return [
        '对照结论里摘出的关键日志行',
        '若日志路径不对，说明实际日志位置后续再查',
        '需要继续排障或改代码时直接说下一步',
      ]
    case 'env':
      return [
        '对照结论里的 Node/Python/端口/虚拟环境结果',
        '缺项再说明要装什么或要查哪一侧',
        '不要在本轮结论里默认已经改过配置',
      ]
    case 'troubleshoot':
      return [
        '对照结论里的现象、证据与根因是否说得通',
        '若同意改代码，另发具体修改诉求（本轮应未改文件）',
        '若还要查日志、环境或再装依赖，直接说下一步',
      ]
    default:
      return [
        '看进度卡里的终端命令是否已经执行',
        '确认结果是否符合这句诉求',
        '若要改代码，另说具体要改什么',
      ]
  }
}

/** 写码与运维共用：终端必须有成败态，失败要根因并纠错；需确认则 ask_user_choice。 */
export function terminalProblemHandlingInstructions(): string {
  return (
    `【终端与问题处理】\n` +
    `- 凡执行 Shell/终端命令：必须留下明确成功或失败结果（认退出码与工具状态）；失败不得当成功。\n` +
    `- 失败后立刻根据 stderr/日志提炼根因，针对性纠错并继续处理，直到目标达成，或确认必须由用户拍板。\n` +
    `- 需要用户确认/选择时：调用 ask_user_choice，给出 2～4 个具体选项；用户选定后继续，禁止干等、禁止只抛原始报错。\n` +
    `- 禁止空等挂死；同一失败命令不得原样连打；长驻进程须后台启动并立刻还回终端。\n`
  )
}

function opsKindInstructions(
  kind: OpsTerminalKind,
  restartFallback: boolean,
  restartAttemptDetail?: string,
): string {
  if (restartFallback || kind === 'restart') {
    const prior = String(restartAttemptDetail || '').trim()
    const fallback = restartFallback
      ? prior
        ? `插件已按固定模板试过，未全部成功。已尝试结果：\n${prior.slice(0, 1200)}\n` +
          `从现在起完全按 Cursor IDE 方式接手：自己读仓库、终端与日志，灵活解决直到服务在听。\n`
        : `插件没有匹配到固定启动模板。从现在起完全按 Cursor IDE 方式处理这个启动/重启诉求。\n`
      : ''
    return (
      fallback +
      `目标：把本项目服务启动/重启到可访问。遇到问题很正常——要及时定位根因并针对性处理，想尽办法推进；禁止一遇错就卡死、空等或只把报错甩给用户。\n` +
      `正确节奏（对照 Cursor IDE / 专业排障）：\n` +
      `1) 先诊断：看 .dev-logs / 项目日志、端口是否在听、相关进程、上次启动命令与 ModuleNotFoundError / 权限 / 缺 .env 等；把「当前状态 + 根因」写进可见过程。\n` +
      `2) 能自解则自解：缺哪个包就装哪个（优先最小集，禁止无目标地整包盲装 torch 等大依赖）；可建项目内 .venv、写/改启动脚本、修挡启动的明显错误，再后台拉起。\n` +
      `3) 需要用户拍板时立刻互动：调用 ask_user_choice 给出 2～4 个具体选项，例如「项目内建 .venv（推荐）」「pip install --user 到用户目录」「只写启动命令由我自己装」「其它（用户自填）」。答完再执行，禁止干等、禁止用长文代替选择题。\n` +
      `4) 典型坑要换路：WinError 5 / Access is denied、全局 site-packages 污染、缺 API Key 导致 import 失败——不要重复同一条失败命令；换 venv/--user、或问用户补密钥/选方案。\n` +
      terminalProblemHandlingInstructions() +
      `长驻进程必须后台启动并立刻把终端还回来。装依赖要有输出；若长时间无进展，缩小依赖集、换源或改方案，不要空等挂死。\n` +
      `外部服务（远程库/Docker/云）本机实在起不来：结论写清根因 + 已尝试 + 用户可选下一步后收口，仍禁止只抛原始报错。\n` +
      `禁止 git commit / push；禁止与启动无关的大重构；尽量不换用户已在用的端口，禁止无必要地再起第二套同名服务。\n`
    )
  }
  if (kind === 'test') {
    return (
      `本轮只跑测试。先找项目已有的测试脚本（package.json scripts、pytest、unittest 等），用项目自己的命令执行，汇报通过/失败与关键输出。\n` +
      `不要为了跑测试去改源代码或测试文件。不要顺手重启前后端，除非测试命令本身会短时拉起再退出。\n`
    )
  }
  if (kind === 'install') {
    return (
      `本轮只安装依赖。先确认该装哪一侧（frontend / backend / 仓库根），再用目录里已有的包管理器与锁文件执行安装（npm/pnpm/yarn/pip/poetry/uv 等）。\n` +
      `结论须写清：安装目录、实际命令、退出是否成功；若 lock/venv 有变化，只如实记录，不要顺手提交。\n` +
      `不要升级无关大版本，不要改业务源代码，不要改启动端口或重写配置，不要顺手重启服务（除非用户本句明确要求重启）。\n`
    )
  }
  if (kind === 'logs') {
    return (
      `本轮只看日志。定位项目已有的日志文件或正在跑的终端输出，摘出与诉求相关的关键行并说明含义。\n` +
      `不要清空、轮转或删除日志，不要改配置，不要重启服务。\n`
    )
  }
  if (kind === 'env') {
    return (
      `本轮只查环境。核对本机/项目里的运行时、虚拟环境、关键端口和配置是否齐，把结果写清楚。\n` +
      `不要安装依赖（除非用户明确要求安装），不要改文件，不要重启服务。\n`
    )
  }
  if (kind === 'troubleshoot') {
    return (
      `本轮只排障定位，不修代码。按现象→证据→根因→下一步建议来写结论；证据优先来自项目日志、现有终端输出、配置与端口现状。\n` +
      `若根因是依赖缺失，只说明该装什么，不要本轮擅自安装（除非用户本句明确要求安装）。若必须改代码才能修好，只写建议改什么，本轮不要改文件。\n` +
      `不要为了验证去改端口、清日志、另起第二套服务，也不要在未确认前强行重启。\n`
    )
  }
  return (
    `只做这句诉求里的那一件，做完就停。用项目现有脚本、日志和终端，不要为了看结果去改文件。\n` +
    `排障时写清根因；若必须改代码，只在结论里说明该改什么，本轮不要改。\n` +
    `若诉求是启动/重启：长驻进程必须后台启动并立刻把终端还回来；禁止换端口，禁止再起第二套服务。\n`
  )
}

export function buildOpsPrompt(opts: {
  requirement: string
  workspace: string
  /** 插件未认出启动命令 / 或已试但未起来后的降级：更贴近 Cursor IDE */
  restartFallback?: boolean
  /** 插件侧已尝试的结果摘要，写入降级提示供 Cursor 接着排障 */
  restartAttemptDetail?: string
  /** 已判定 ops 后的细类；缺省按诉求再判 */
  terminalKind?: OpsTerminalKind
}): string {
  const req = String(opts.requirement || '').trim()
  const kind = opts.terminalKind || classifyOpsTerminal(req)
  const restartMode = Boolean(opts.restartFallback) || kind === 'restart'
  const noEditLine = opts.restartFallback
    ? `本轮为启动/重启降级：允许为启动安装依赖、创建项目内 venv、编写/修改启动脚本，以及修复挡启动的明显错误；禁止 git commit / push；禁止与启动无关的大范围改动。\n\n`
    : `禁止修改、创建、删除任何源代码或配置。禁止 git commit / push。\n\n`
  const conclusionLine = restartMode
    ? `说明方案须含：**结论**（起来了 / 卡在哪）、**根因**（若未起来：缺包/权限/配置等一句话）、**做了什么**（诊断与处理步骤，含是否已 AskQuestion）、**验收或下一步**（已起来则给地址；未起来且需用户参与则写清已给出的选项或待用户补的信息——禁止只贴原始 traceback）。\n`
    : `说明方案须含：**结论**（结果一句话）、**做了什么**（实际执行了什么，含装依赖/写脚本若有）、**验收**（用户怎么确认，含可访问地址若已起来）。\n`
  return (
    `你是 Cursor IDE 里的 Agent，工作目录就是用户正在用的真实项目：${opts.workspace}\n` +
    `按 Cursor IDE 处理这类开发任务：先看仓库已有的脚本、配置和正在跑的终端，用项目自己的方式推进，不要死守某一种固定模板。\n` +
    opsKindInstructions(kind, Boolean(opts.restartFallback), opts.restartAttemptDetail) +
    (restartMode ? '' : terminalProblemHandlingInstructions()) +
    noEditLine +
    `【用户诉求】\n` +
    `<USER_REQUEST>\n${req}\n</USER_REQUEST>\n\n` +
    `终稿第一行恰好是：## 说明方案\n` +
    conclusionLine
  )
}
