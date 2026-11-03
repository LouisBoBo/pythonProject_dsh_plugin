/** 第 10 步：部署上线。命令与健康检查都来自配置，不内置任何业务地址。 */

import { runCommand } from '../exec.js'
import { redactSecrets } from '../workspace.js'
import type { DeployState, StepContext, StepResult } from '../types.js'
import { fail, pass, skip } from './helpers.js'

const HEALTH_POLL_MS = 60_000

async function healthOnce(url: string, signal: AbortSignal): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5_000)
  const onAbort = () => controller.abort()
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: '*/*' } })
    return res.ok || (res.status >= 200 && res.status < 400)
  } catch {
    return false
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}

async function waitHealthy(url: string, signal: AbortSignal): Promise<boolean> {
  const deadline = Date.now() + HEALTH_POLL_MS
  while (Date.now() < deadline) {
    if (signal.aborted) throw new Error('已取消')
    if (await healthOnce(url, signal)) return true
    await new Promise((r) => setTimeout(r, 2000))
  }
  return false
}

export async function runStep10(sc: StepContext): Promise<StepResult> {
  const command = String(sc.cfg.deploy.command || '').trim()
  if (!command) {
    const state: DeployState = {
      attempts: 0,
      command: '',
      exit_code: null,
      health_ok: null,
      status: 'skipped',
      summary: '未配置 deploy.command，跳过部署',
    }
    sc.epic.artifacts.deploy = state
    sc.save()
    return skip(
      '跳过部署：未配置部署命令',
      '在 ~/.dsh/dev-pipeline/config.json 或工程 .dsh/dev-pipeline.json 里配置 deploy.command（可选 healthUrl）',
    )
  }

  const maxAttempts = Math.max(1, sc.cfg.maxDeployAttempts)
  const healthUrl = String(sc.cfg.deploy.healthUrl || '').trim()
  if (healthUrl) {
    try {
      const parsed = new URL(healthUrl)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`不支持的协议 ${parsed.protocol}`)
      }
    } catch (err) {
      return fail('deploy.healthUrl 无效', `${healthUrl}：${String(err)}`, {
        fatal: true,
        evidence: { healthUrl },
      })
    }
  }
  let lastExit: number | null = null
  let lastOutput = ''
  let healthOk: boolean | null = healthUrl ? false : null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (sc.signal.aborted) throw new Error('已取消')
    sc.log(`部署第 ${attempt}/${maxAttempts} 次：${command}`)
    const out = await runCommand(command, {
      cwd: sc.epic.workspace,
      timeoutMs: sc.cfg.deploy.timeoutMs,
      signal: sc.signal,
    })
    lastExit = out.exit_code
    lastOutput = redactSecrets(out.output).slice(-4000)
    if (out.exit_code !== 0 || out.timed_out) {
      sc.log(`部署命令失败（exit=${out.exit_code ?? 'null'}${out.timed_out ? '，超时' : ''}）`)
      continue
    }
    if (healthUrl) {
      sc.log(`等待健康检查：${healthUrl}`)
      healthOk = await waitHealthy(healthUrl, sc.signal)
      if (!healthOk) {
        sc.log('健康检查未通过')
        continue
      }
    }
    const state: DeployState = {
      attempts: attempt,
      command,
      exit_code: out.exit_code,
      health_ok: healthOk,
      status: 'pass',
      summary: healthUrl ? `部署完成，健康检查通过（第 ${attempt} 次）` : `部署命令成功（第 ${attempt} 次）`,
    }
    sc.epic.artifacts.deploy = state
    sc.save()
    return pass(state.summary, '', { attempts: attempt, health_ok: healthOk })
  }

  const state: DeployState = {
    attempts: maxAttempts,
    command,
    exit_code: lastExit,
    health_ok: healthOk,
    status: 'fail',
    summary: `部署失败（已尝试 ${maxAttempts} 次）`,
  }
  sc.epic.artifacts.deploy = state
  sc.save()
  return fail(state.summary, lastOutput, {
    fatal: true,
    evidence: { attempts: maxAttempts, exit_code: lastExit, health_ok: healthOk },
  })
}
