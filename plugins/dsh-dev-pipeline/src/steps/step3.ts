/** 第 3 步：读库上下文 · Prime（只读）。 */

import type { StepContext, StepResult } from '../types.js'
import { profileWorkspace } from '../workspace.js'
import { fail, pass } from './helpers.js'

export async function runStep3(sc: StepContext): Promise<StepResult> {
  try {
    const pack = profileWorkspace(sc.epic.workspace)
    sc.epic.context_pack = pack
    sc.save()

    sc.log(`扫描目录：${sc.epic.workspace}`)
    sc.log(`顶层目录：${pack.dirs.slice(0, 12).join(', ') || '无'}`)
    sc.log(`技术栈：${pack.stack.join(' / ') || '未识别'}`)
    for (const risk of pack.risks) sc.log(`风险：${risk}`)

    return pass(pack.summary, pack.risks.join('\n'), {
      dirs: pack.dirs.length,
      key_files: pack.key_files.length,
      risks: pack.risks,
    })
  } catch (err) {
    return fail(`工程目录不可读：${String(err)}`, '', { fatal: true })
  }
}
