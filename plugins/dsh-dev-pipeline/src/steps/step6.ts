/** 第 6 步：机器验证 · 只认 PASS/FAIL。 */

import { runCommand } from '../exec.js'
import { redactSecrets } from '../workspace.js'
import type { StepContext, StepResult, ValidateCommandResult } from '../types.js'
import { fail, pass, skip } from './helpers.js'

const COMMAND_TIMEOUT = 15 * 60 * 1000

export async function runStep6(sc: StepContext): Promise<StepResult> {
  const plan = sc.epic.plan
  const commands = (plan?.validations || []).filter(Boolean).slice(0, 6)
  if (commands.length === 0) {
    const state = { commands: [], verdict: 'skipped' as const, summary: '没有可执行的验证命令' }
    sc.epic.artifacts.validate = state
    sc.save()
    return skip('跳过机器验证：计划里没有验证命令', '可在工程 .dsh/dev-pipeline.json 配置 validateCommands')
  }

  const results: ValidateCommandResult[] = []
  for (const command of commands) {
    if (sc.signal.aborted) throw new Error('已取消')
    sc.log(`验证：${command}`)
    const out = await runCommand(command, {
      cwd: sc.epic.workspace,
      timeoutMs: COMMAND_TIMEOUT,
      signal: sc.signal,
    })
    const record: ValidateCommandResult = {
      command,
      exit_code: out.exit_code,
      timed_out: out.timed_out,
      output: redactSecrets(out.output).slice(0, 20_000),
    }
    results.push(record)
    const ok = out.exit_code === 0 && !out.timed_out
    sc.log(`${ok ? 'PASS' : 'FAIL'}：${command}（exit=${out.exit_code ?? 'null'}）`)
  }

  const failed = results.filter((r) => r.exit_code !== 0 || r.timed_out)
  const verdict = failed.length === 0 ? 'pass' : 'fail'
  const summary =
    verdict === 'pass'
      ? `全部 ${results.length} 条验证通过`
      : `${failed.length}/${results.length} 条验证失败：${failed.map((f) => f.command).join('；')}`

  sc.epic.artifacts.validate = { commands: results, verdict, summary }
  sc.save()

  if (verdict === 'pass') {
    return pass(summary, '', { commands: commands.length, results: results.map((r) => ({ command: r.command, exit_code: r.exit_code })) })
  }

  const detail = failed
    .map((f) => {
      const tail = f.output.slice(-3000)
      return `### ${f.command}（exit=${f.exit_code ?? 'null'}${f.timed_out ? '，超时' : ''}）\n${tail}`
    })
    .join('\n\n')
    .slice(0, 6000)

  return fail(summary, detail, {
    evidence: { failed: failed.map((f) => f.command) },
  })
}
