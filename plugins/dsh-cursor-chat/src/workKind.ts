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
  if (/(安装|装).{0,4}依赖/.test(t)) return true
  if (/npminstall|pnpminstall|yarninstall|pipinstall/i.test(t)) return true
  if (/(看|查|查看|读).{0,6}日志/.test(t)) return true
  if (/(查|看|检查).{0,4}环境/.test(t)) return true
  if (/排障|排查(一下|下)?(问题|报错|服务|启动|原因)/.test(t)) return true
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

export function opsWantsRunningService(message: string): boolean {
  return /(重启|重新启动|重开|拉起|启动)/.test(compact(message))
}

export function buildOpsPrompt(opts: { requirement: string; workspace: string }): string {
  const req = String(opts.requirement || '').trim()
  return (
    `你是 Cursor IDE 里的 Agent，工作目录就是用户正在用的真实项目：${opts.workspace}\n` +
    `本轮没有要求改代码。按 Cursor IDE 处理这类开发任务：先看仓库已有的脚本、配置和正在跑的终端，沿用项目自己的命令，不要另起一套工具链。\n` +
    `可以做的事包括：启动或重启前后端、把项目跑起来、跑测试、安装依赖、看日志、查环境、排障。只做这句诉求里的那一件，做完就停。\n` +
    `启动或重启时：读配置确认现有端口和启动命令；停掉占用该端口、且工作目录在本项目里的进程；用原来的命令和端口在后台拉起。要前后端就两边都处理。\n` +
    `跑测试、装依赖、看日志、查环境、排障：用项目现有脚本和日志，不要为了看结果去改文件。排障时写清根因；若必须改代码，只在结论里说明该改什么，本轮不要改。\n` +
    `禁止修改、创建、删除任何源代码或配置。禁止 git commit / push。\n` +
    `长驻进程必须后台启动并立刻把终端还回来。禁止前台挂住 uvicorn 或 npm run dev。禁止换端口，禁止再起第二套服务。\n\n` +
    `【用户诉求】\n` +
    `<USER_REQUEST>\n${req}\n</USER_REQUEST>\n\n` +
    `终稿第一行恰好是：## 说明方案\n` +
    `说明方案须含：**结论**（结果一句话）、**做了什么**（按 Cursor 实际执行了什么，未改代码）、**验收**（用户怎么确认，2～4 步）。不要列改动文件。\n`
  )
}
